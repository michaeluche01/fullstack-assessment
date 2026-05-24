const request = require("supertest");
const app = require("../app");
const pool = require("../db/postgres");

describe("B3 — Webhook deduplication", () => {
  let orderId;

  beforeAll(async () => {
    const { rows } = await pool.query(
      `INSERT INTO orders (customer_id, total_amount, status)
       VALUES ($1, $2, 'PENDING') RETURNING id`,
      ["customer_webhook_test", "99.00"],
    );
    orderId = rows[0].id;
  });

  afterAll(async () => {
    await pool.query(
      `DELETE FROM payment_events WHERE order_id = $1`,
      [orderId],
    );
    await pool.query(`DELETE FROM orders WHERE id = $1`, [orderId]);
    await pool.end();
  });

  it("processes a webhook event exactly once", async () => {
    const providerEventId = `evt-dedup-test-${Date.now()}`;

    const first = await request(app)
      .post("/payments/webhook")
      .set("Content-Type", "application/json")
      .send({ providerEventId, orderId, eventType: "payment_succeeded", payload: {} });

    expect(first.status).toBe(200);
    expect(first.body.accepted).toBe(true);

    // Order should now be PAID
    const { rows: orderRows } = await pool.query(
      `SELECT status FROM orders WHERE id = $1`,
      [orderId],
    );
    expect(orderRows[0].status).toBe("PAID");
  });

  it("returns accepted on duplicate webhook without processing again", async () => {
    const providerEventId = `evt-dedup-test-duplicate-${Date.now()}`;

    // First webhook
    await request(app)
      .post("/payments/webhook")
      .set("Content-Type", "application/json")
      .send({ providerEventId, orderId, eventType: "payment_succeeded", payload: {} });

    // Reset order to PENDING to prove the duplicate doesn't re-mark it PAID
    await pool.query(
      `UPDATE orders SET status = 'PENDING' WHERE id = $1`,
      [orderId],
    );

    // Duplicate webhook — same providerEventId
    const duplicate = await request(app)
      .post("/payments/webhook")
      .set("Content-Type", "application/json")
      .send({ providerEventId, orderId, eventType: "payment_succeeded", payload: {} });

    expect(duplicate.status).toBe(200);
    expect(duplicate.body.accepted).toBe(true);
    expect(duplicate.body.duplicate).toBe(true);

    // Order should still be PENDING — duplicate did not call markOrderAsPaid
    const { rows } = await pool.query(
      `SELECT status FROM orders WHERE id = $1`,
      [orderId],
    );
    expect(rows[0].status).toBe("PENDING");
  });

  it("handles concurrent duplicate webhooks without double-processing", async () => {
    const providerEventId = `evt-dedup-concurrent-${Date.now()}`;

    const responses = await Promise.all([
      request(app)
        .post("/payments/webhook")
        .set("Content-Type", "application/json")
        .send({ providerEventId, orderId, eventType: "payment_succeeded", payload: {} }),
      request(app)
        .post("/payments/webhook")
        .set("Content-Type", "application/json")
        .send({ providerEventId, orderId, eventType: "payment_succeeded", payload: {} }),
    ]);

    // Both return 200 accepted — idempotent
    responses.forEach((r) => {
      expect(r.status).toBe(200);
      expect(r.body.accepted).toBe(true);
    });

    // Exactly one event record in DB
    const { rows } = await pool.query(
      `SELECT COUNT(*) AS count FROM payment_events
       WHERE provider_event_id = $1`,
      [providerEventId],
    );
    expect(Number(rows[0].count)).toBe(1);
  });
});