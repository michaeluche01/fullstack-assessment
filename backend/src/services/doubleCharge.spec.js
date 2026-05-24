const request = require("supertest");
const app = require("../app");
const pool = require("../db/postgres");

describe("B2 — Double-charge prevention", () => {
  let productId;
  let orderId;

  beforeAll(async () => {
    // Create a product
    const { rows: productRows } = await pool.query(
      `INSERT INTO products (sku, name, description, price, stock)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [`CHARGE-TEST-${Date.now()}`, "Charge Test Widget", "Test", "50.00", 10],
    );
    productId = productRows[0].id;

    // Create an order directly in DB (bypasses stock logic, keeps test focused)
    const { rows: orderRows } = await pool.query(
      `INSERT INTO orders (customer_id, total_amount, status)
       VALUES ($1, $2, 'PENDING') RETURNING id`,
      ["customer_charge_test", "50.00"],
    );
    orderId = orderRows[0].id;
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM payments WHERE order_id = $1`, [orderId]);
    await pool.query(`DELETE FROM orders WHERE id = $1`, [orderId]);
    await pool.query(`DELETE FROM products WHERE id = $1`, [productId]);
    await pool.end();
  });

  it("allows exactly one charge when two requests fire concurrently", async () => {
    const CONCURRENCY = 2;

    const responses = await Promise.all(
      Array.from({ length: CONCURRENCY }, () =>
        request(app)
          .post("/payments/charge")
          .set("Content-Type", "application/json")
          .set("Idempotency-Key", `charge-${orderId}`)
          .send({ orderId }),
      ),
    );

    const successes = responses.filter((r) => r.status === 200);
    const failures  = responses.filter((r) => r.status === 409);

    // Exactly one charge should succeed
    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(CONCURRENCY - 1);

    // Exactly one payment record in DB
    const { rows } = await pool.query(
      `SELECT COUNT(*) AS count FROM payments WHERE order_id = $1`,
      [orderId],
    );
    expect(Number(rows[0].count)).toBe(1);

    // Order status is PAID
    const { rows: orderRows } = await pool.query(
      `SELECT status FROM orders WHERE id = $1`,
      [orderId],
    );
    expect(orderRows[0].status).toBe("PAID");
  });

  it("returns cached response on retry with same idempotency key", async () => {
    // The order is now PAID from the previous test.
    // A retry with the same key should return the cached result, not 409.
    const response = await request(app)
      .post("/payments/charge")
      .set("Content-Type", "application/json")
      .set("Idempotency-Key", `charge-${orderId}`)
      .send({ orderId });

    // Redis cache hit — returns 200 with the original result
    expect(response.status).toBe(200);
    expect(response.body.order.status).toBe("PAID");

    // Still only one payment in DB — gateway was not called again
    const { rows } = await pool.query(
      `SELECT COUNT(*) AS count FROM payments WHERE order_id = $1`,
      [orderId],
    );
    expect(Number(rows[0].count)).toBe(1);
  });
});