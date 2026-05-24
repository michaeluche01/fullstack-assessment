const request = require("supertest");
const app = require("../app");           
const pool = require("../db/postgres");  

describe("B1 — Stock oversell race condition", () => {
  let productId;

  beforeAll(async () => {
    const { rows } = await pool.query(
      `INSERT INTO products (sku, name, description, price, stock)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [`RACE-TEST-${Date.now()}`, "Race Test Widget", "Test only", "9.99", 1],
    );
    productId = rows[0].id;
  });

  afterAll(async () => {
    // Clean up in correct FK order
    await pool.query(
      `DELETE FROM order_items WHERE product_id = $1`,
      [productId],
    );
    await pool.query(
      `DELETE FROM orders WHERE id IN (
         SELECT order_id FROM order_items WHERE product_id = $1
       )`,
      [productId],
    );
    await pool.query(`DELETE FROM products WHERE id = $1`, [productId]);
    await pool.end();
  });

  it("allows exactly one order when stock = 1 and N requests fire concurrently", async () => {
    const CONCURRENCY = 5;

    const responses = await Promise.all(
      Array.from({ length: CONCURRENCY }, () =>
        request(app)
          .post("/orders")
          .set("Content-Type", "application/json")
          .send({
            customerId: "customer_race_test",
            items: [{ productId, quantity: 1 }],
            totalAmount: 9.99,
          }),
      ),
    );

    const successes = responses.filter((r) => r.status === 201);
    const conflicts = responses.filter((r) => r.status === 409);

    // Exactly one request should win the lock race
    expect(successes).toHaveLength(1);
    expect(conflicts).toHaveLength(CONCURRENCY - 1);

    // Stock must be exactly 0 — never negative
    const { rows } = await pool.query(
      `SELECT stock FROM products WHERE id = $1`,
      [productId],
    );
    expect(rows[0].stock).toBe(0);
  });

  it("allows N orders when stock = N and N requests fire concurrently", async () => {
    const N = 3;

    // Reset stock to N
    await pool.query(
      `UPDATE products SET stock = $1 WHERE id = $2`,
      [N, productId],
    );

    const responses = await Promise.all(
      Array.from({ length: N + 2 }, () =>
        request(app)
          .post("/orders")
          .set("Content-Type", "application/json")
          .send({
            customerId: "customer_race_test",
            items: [{ productId, quantity: 1 }],
            totalAmount: 9.99,
          }),
      ),
    );

    const successes = responses.filter((r) => r.status === 201);

    expect(successes).toHaveLength(N);

    const { rows } = await pool.query(
      `SELECT stock FROM products WHERE id = $1`,
      [productId],
    );
    expect(rows[0].stock).toBe(0);
  });
});