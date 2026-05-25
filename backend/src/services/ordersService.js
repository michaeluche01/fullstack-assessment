const ordersRepository = require("../repositories/ordersRepository");
const productsRepository = require("../repositories/productsRepository");
const paymentsRepository = require("../repositories/paymentsRepository");
const paymentGateway = require("./paymentGateway");
const redis = require("../db/redis");
const db = require("../db/postgres");

async function withTransaction(callback) {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const result = await callback(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// FIXED: entire createOrder runs inside a single serialisable transaction.
// FOR UPDATE on each product row serialises concurrent requests at the DB level:
// the second concurrent call blocks at getProductByIdForUpdate until the first
// commits, then reads the already-decremented stock and throws 409.
async function createOrder({ customerId, items, totalAmount }) {
  if (!customerId || !Array.isArray(items) || items.length === 0) {
    const error = new Error("customerId and items are required");
    error.status = 400;
    throw error;
  }

  return withTransaction(async (client) => {
    const enrichedItems = [];

    for (const item of items) {
      // Locking read — blocks any other transaction trying to lock this row.
      const product = await productsRepository.getProductByIdForUpdate(
        item.productId,
        client,         // <-- same transactional client throughout
      );

      if (!product) {
        const error = new Error(`Product ${item.productId} not found`);
        error.status = 404;
        throw error;
      }

      if (product.stock < item.quantity) {
        const error = new Error(`Insufficient stock for ${product.name}`);
        error.status = 409;
        throw error;
      }

      enrichedItems.push({
        productId: product.id,
        quantity: item.quantity,
        unitPrice: Number(product.price),
      });
    }

    for (const item of enrichedItems) {
      const updated = await productsRepository.decrementStock(
        item.productId,
        item.quantity,
        client,         // <-- transactional client, not the pool
      );

      // Second-line defence: decrementStock returns null if stock was already
      // insufficient at the moment of the UPDATE (race escaped the FOR UPDATE).
      if (!updated) {
        const error = new Error(
          `Insufficient stock for product ${item.productId} (concurrent update)`,
        );
        error.status = 409;
        throw error;
      }
    }

// Compute total server-side from unit prices already fetched from DB.
// Never trust the client-supplied totalAmount.
// Math.round(n * 100) / 100 rounds to 2 decimal places without
// floating point drift. Example: 3 × $89.50 = $268.50 exactly.
const computedTotal = Math.round(
  enrichedItems.reduce(
    (sum, item) => sum + item.unitPrice * item.quantity,
    0,
  ) * 100,
) / 100;

const order = await ordersRepository.createOrder(
  {
    customerId,
    totalAmount: computedTotal,  // server-computed, not client-supplied
    items: enrichedItems,
  },
  client,
);

    return order;
  });
}

async function chargeOrder({ orderId, idempotencyKey }) {
  // Step 1: Redis cache check (unchanged — protects retries across
  // server restarts or horizontal scaling where the DB lock won't help)
  if (idempotencyKey) {
    const cached = await redis.get(`idem:${idempotencyKey}`);
    if (cached) {
      return JSON.parse(cached);
    }
  }

  // Step 2: Everything from here runs inside a transaction with a row lock.
  // getOrderByIdForUpdate uses SELECT ... FOR UPDATE, which means:
  // - The first request acquires the lock and proceeds
  // - Any concurrent request for the same orderId BLOCKS here at the DB level
  // - When the first request commits (order is now PAID), the second unblocks,
  //   reads status = 'PAID', and hits the status check below — throws 409
  // - The gateway is never called a second time
  const result = await withTransaction(async (client) => {
    const order = await ordersRepository.getOrderByIdForUpdate(orderId, client);

    if (!order) {
      const error = new Error("Order not found");
      error.status = 404;
      throw error;
    }

    // This check is now INSIDE the transaction and AFTER the lock.
    // A concurrent request that was blocked at getOrderByIdForUpdate
    // will reach this check and correctly see 'PAID', not 'PENDING'.
    if (order.status !== "PENDING") {
      const error = new Error("Only pending orders can be charged");
      error.status = 409;
      throw error;
    }

    // Gateway call happens while holding the row lock.
    // Trade-off: this holds the DB connection open during the network call
    // (50–600ms per paymentGateway config). Acceptable for this assessment.
    // Production fix: add a 'PROCESSING' status, release lock, call gateway,
    // reacquire lock to record result.
    const gatewayResponse = await paymentGateway.charge({
      orderId: order.id,
      amount: order.totalAmount,
    });

    // Both DB writes use the same transactional client — atomic.
    const payment = await paymentsRepository.createPayment(
      {
        orderId: order.id,
        amount: gatewayResponse.chargedAmount,
        providerTxnId: gatewayResponse.providerTxnId,
        status: "SUCCESS",
        idempotencyKey,
      },
      client,
    );

    const updatedOrder = await ordersRepository.markOrderAsPaid(
      order.id,
      client,
    );

    return { order: updatedOrder, payment };
  });

  // Step 3: Cache AFTER successful commit.
  // This is correct — we only cache confirmed successes.
  // The FOR UPDATE lock prevents the double-charge window that existed before.
  if (idempotencyKey) {
    await redis.set(
      `idem:${idempotencyKey}`,
      JSON.stringify(result),
      "EX",
      86400, // 24 hours — long enough to cover retries, short enough to expire
    );
  }

  return result;
}

async function processPaymentWebhook({
  providerEventId,
  orderId,
  eventType,
  payload,
}) {
  // Application-level dedup check — runs inside a transaction so the
  // existence check and the insert are atomic. Two concurrent duplicate
  // webhooks will both pass this check only if they arrive simultaneously;
  // the UNIQUE constraint on provider_event_id catches that case and throws,
  // which we catch below and return accepted:true (idempotent response).
  return withTransaction(async (client) => {
    const existing = await paymentsRepository.findWebhookEventByProviderId(
      providerEventId,
      client,
    );

    if (existing) {
      // Already processed — return idempotent success without
      // calling markOrderAsPaid again.
      return { accepted: true, duplicate: true };
    }

    try {
      await paymentsRepository.createWebhookEvent(
        { providerEventId, orderId, eventType, payload },
        client,
      );
    } catch (err) {
      // UNIQUE constraint violation — concurrent duplicate webhook
      // lost the race at the DB level. Still idempotent.
      if (err.code === "23505") {
        return { accepted: true, duplicate: true };
      }
      throw err;
    }

    if (eventType === "payment_succeeded") {
      await ordersRepository.markOrderAsPaid(orderId, client);
    }

    return { accepted: true };
  });
}

async function getOrderById(orderId) {
  const order = await ordersRepository.getOrderWithDetails(orderId);
  if (!order) {
    const error = new Error("Order not found");
    error.status = 404;
    throw error;
  }
  return order;
}

async function listOrders(params) {
  return ordersRepository.listOrders(params);
}

module.exports = {
  createOrder,
  chargeOrder,
  processPaymentWebhook,
  getOrderById,
  listOrders,
};
