const request = require("supertest");
const app = require("../app");
const pool = require("../db/postgres");

describe("B4 — Admin route authentication", () => {
  const VALID_TOKEN = process.env.ADMIN_TOKEN || "change-me";

  afterAll(async () => {
    await pool.end();
  });

  describe("POST /admin/products", () => {
    it("returns 401 with no token", async () => {
      const res = await request(app)
        .post("/admin/products")
        .set("Content-Type", "application/json")
        .send({ sku: "TEST-AUTH", name: "Test", price: 9.99, stock: 1 });

      expect(res.status).toBe(401);
      expect(res.body.error).toBe("Unauthorized");
    });

    it("returns 401 with wrong token", async () => {
      const res = await request(app)
        .post("/admin/products")
        .set("Authorization", "Bearer wrong-token")
        .set("Content-Type", "application/json")
        .send({ sku: "TEST-AUTH", name: "Test", price: 9.99, stock: 1 });

      expect(res.status).toBe(401);
      expect(res.body.error).toBe("Unauthorized");
    });

    it("returns 201 with correct token", async () => {
      const sku = `AUTH-TEST-${Date.now()}`;
      const res = await request(app)
        .post("/admin/products")
        .set("Authorization", `Bearer ${VALID_TOKEN}`)
        .set("Content-Type", "application/json")
        .send({ sku, name: "Auth Test Product", price: 9.99, stock: 5 });

      expect(res.status).toBe(201);
      expect(res.body.sku).toBe(sku);

      // Cleanup
      await pool.query(`DELETE FROM products WHERE sku = $1`, [sku]);
    });
  });

  describe("PATCH /admin/products/:id", () => {
    it("returns 401 with no token", async () => {
      const res = await request(app)
        .patch("/admin/products/1")
        .set("Content-Type", "application/json")
        .send({ price: 5.00 });

      expect(res.status).toBe(401);
      expect(res.body.error).toBe("Unauthorized");
    });

    it("returns 401 with wrong token", async () => {
      const res = await request(app)
        .patch("/admin/products/1")
        .set("Authorization", "Bearer wrong-token")
        .set("Content-Type", "application/json")
        .send({ price: 5.00 });

      expect(res.status).toBe(401);
      expect(res.body.error).toBe("Unauthorized");
    });
  });
});