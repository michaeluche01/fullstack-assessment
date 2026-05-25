const request = require("supertest");
const app = require("../app");
const pool = require("../db/postgres");

describe("B6 — totalAmount server-side computation", () => {
  let productId;
  const UNIT_PRICE = "49.95";

  beforeAll(async () => {
    const { rows } = await pool.query(
      `INSERT INTO products (sku, name, description, price, stock)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [`TOTAL-TEST-${Date.now()}`, "Total Test Widget", "Test", UNIT_PRICE, 20],
    );
    productId = rows[0].id;
  });

  afterAll(async () => {
    await pool.query(
      `DELETE FROM order_items WHERE order_id IN (
         SELECT id FROM orders WHERE customer_id = 'customer_total_test'
       )`,
    );
    await pool.query(
      `DELETE FROM orders WHERE customer_id = 'customer_total_test'`,
    );
    await pool.query(`DELETE FROM products WHERE id = $1`, [productId]);
    await pool.end();
  });

  it("ignores client-supplied totalAmount and computes server-side", async () => {
    const quantity = 2;
    const expectedTotal = Math.round(
      parseFloat(UNIT_PRICE) * quantity * 100,
    ) / 100; // 49.95 * 2 = 99.90

    const res = await request(app)
      .post("/orders")
      .set("Content-Type", "application/json")
      .send({
        customerId: "customer_total_test",
        items: [{ productId, quantity }],
        totalAmount: 0.01,  // client tries to cheat — sends 1 cent
      });

    expect(res.status).toBe(201);
    // Server must store the correct computed total, not 0.01
    expect(parseFloat(res.body.totalAmount)).toBe(expectedTotal);
    expect(parseFloat(res.body.totalAmount)).not.toBe(0.01);
  });

  it("computes correct total for multiple quantities", async () => {
    const quantity = 3;
    const expectedTotal = Math.round(
      parseFloat(UNIT_PRICE) * quantity * 100,
    ) / 100; // 49.95 * 3 = 149.85

    const res = await request(app)
      .post("/orders")
      .set("Content-Type", "application/json")
      .send({
        customerId: "customer_total_test",
        items: [{ productId, quantity }],
        totalAmount: 999.99,  // client sends wrong value
      });

    expect(res.status).toBe(201);
    expect(parseFloat(res.body.totalAmount)).toBe(expectedTotal);
  });
});