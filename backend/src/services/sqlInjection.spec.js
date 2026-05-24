const request = require("supertest");
const app = require("../app");
const pool = require("../db/postgres");

describe("B5 — SQL injection prevention in listProducts", () => {
  afterAll(async () => {
    await pool.end();
  });

  it("returns empty array for a search that matches nothing", async () => {
    const res = await request(app)
      .get("/products?q=zzznomatch")
      .set("Content-Type", "application/json");

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(0);
  });

  it("does not throw or leak data on SQL injection attempt", async () => {
    // A classic injection: if interpolated, this would break the ILIKE clause
    // and potentially return all rows or throw a syntax error.
    const maliciousInput = encodeURIComponent("' OR '1'='1");

    const res = await request(app)
      .get(`/products?q=${maliciousInput}`)
      .set("Content-Type", "application/json");

    // With parameterized query: treats the input as a literal search string,
    // finds no products with that name/sku, returns empty array cleanly.
    // Without the fix: would return all products (data leak) or throw 500.
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    // Should not return all products — injection did not widen the query
    expect(res.body.length).toBe(0);
  });

  it("does not crash on DROP TABLE injection attempt", async () => {
    const maliciousInput = encodeURIComponent("'; DROP TABLE products;--");

    const res = await request(app)
      .get(`/products?q=${maliciousInput}`)
      .set("Content-Type", "application/json");

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);

    // Confirm products table still exists and has data
    const { rows } = await pool.query(`SELECT COUNT(*) AS count FROM products`);
    expect(Number(rows[0].count)).toBeGreaterThan(0);
  });

  it("still returns correct results for a legitimate search", async () => {
    const res = await request(app)
      .get("/products?q=Headphones")
      .set("Content-Type", "application/json");

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
    expect(res.body[0].name).toMatch(/Headphones/i);
  });
});