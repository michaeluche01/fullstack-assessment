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

    // createOrder already accepts a client as second arg — pass it through.
    const order = await ordersRepository.createOrder(
      { customerId, totalAmount: Number(totalAmount), items: enrichedItems },
      client,
    );

    return order;
  });
}

async function chargeOrder({ orderId, idempotencyKey }) {
  if (idempotencyKey) {
    const cached = await redis.get(`idem:${idempotencyKey}`);
    if (cached) {
      return JSON.parse(cached);
    }
  }

  const order = await ordersRepository.getOrderById(orderId);
  if (!order) {
    const error = new Error("Order not found");
    error.status = 404;
    throw error;
  }

  if (order.status !== "PENDING") {
    const error = new Error("Only pending orders can be charged");
    error.status = 409;
    throw error;
  }

  const gatewayResponse = await paymentGateway.charge({
    orderId: order.id,
    amount: order.totalAmount,
  });

  const payment = await paymentsRepository.createPayment({
    orderId: order.id,
    amount: gatewayResponse.chargedAmount,
    providerTxnId: gatewayResponse.providerTxnId,
    status: "SUCCESS",
    idempotencyKey,
  });

  const updatedOrder = await ordersRepository.markOrderAsPaid(order.id);

  if (idempotencyKey) {
    await redis.set(
      `idem:${idempotencyKey}`,
      JSON.stringify({ order: updatedOrder, payment }),
      "EX",
      3600,
    );
  }

  return { order: updatedOrder, payment };
}

async function processPaymentWebhook({
  providerEventId,
  orderId,
  eventType,
  payload,
}) {
  await paymentsRepository.createWebhookEvent({
    providerEventId,
    orderId,
    eventType,
    payload,
  });

  if (eventType === "payment_succeeded") {
    await ordersRepository.markOrderAsPaid(orderId);
  }

  return { accepted: true };
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
