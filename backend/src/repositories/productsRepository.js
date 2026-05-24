const pool = require("../db/postgres");

async function listProducts({ q } = {}, client = pool) {
  if (q) {
    const query = `
      SELECT id, sku, name, description, price, stock,
             created_at AS "createdAt", updated_at AS "updatedAt"
      FROM products
      WHERE name ILIKE '%${q}%' OR sku ILIKE '%${q}%'
      ORDER BY id ASC
    `;
    const { rows } = await client.query(query);
    return rows;
  }

  const query = `
    SELECT id, sku, name, description, price, stock,
           created_at AS "createdAt", updated_at AS "updatedAt"
    FROM products
    ORDER BY id ASC
  `;
  const { rows } = await client.query(query);
  return rows;
}

async function getProductById(productId, client = pool) {
  const query = `
    SELECT id, sku, name, description, price, stock,
           created_at AS "createdAt", updated_at AS "updatedAt"
    FROM products
    WHERE id = $1
  `;
  const { rows } = await client.query(query, [productId]);
  return rows[0] || null;
}

// FIXED: FOR UPDATE acquires a row-level exclusive lock inside the transaction.
// Any concurrent transaction trying to lock the same row will block here
// until the first transaction commits or rolls back.
async function getProductByIdForUpdate(productId, client) {
  const query = `
    SELECT id, sku, name, description, price, stock
    FROM products
    WHERE id = $1
    FOR UPDATE
  `;
  const { rows } = await client.query(query, [productId]);
  return rows[0] || null;
}

// FIXED: WHERE stock >= $2 means the UPDATE silently no-ops if stock is already
// insufficient (e.g. a concurrent transaction won race). The RETURNING clause
// returns null in that case, which the caller can detect and throw on.
// This is a second line of defence behind the FOR UPDATE lock — it prevents
// negative stock even if something slips through at the application layer.
async function decrementStock(productId, quantity, client) {
  const query = `
    UPDATE products
    SET stock = stock - $2, updated_at = NOW()
    WHERE id = $1 AND stock >= $2
    RETURNING id, stock
  `;
  const { rows } = await client.query(query, [productId, quantity]);
  return rows[0] || null;
}

async function createProduct({ sku, name, description, price, stock }) {
  const query = `
    INSERT INTO products (sku, name, description, price, stock)
    VALUES ($1, $2, $3, $4, $5)
    RETURNING id, sku, name, description, price, stock,
              created_at AS "createdAt", updated_at AS "updatedAt"
  `;
  const { rows } = await pool.query(query, [
    sku,
    name,
    description || "",
    price,
    stock,
  ]);
  return rows[0];
}

async function updateProduct(productId, { price, stock, description, name }) {
  const query = `
    UPDATE products
    SET price = COALESCE($2, price),
        stock = COALESCE($3, stock),
        description = COALESCE($4, description),
        name = COALESCE($5, name),
        updated_at = NOW()
    WHERE id = $1
    RETURNING id, sku, name, description, price, stock,
              created_at AS "createdAt", updated_at AS "updatedAt"
  `;
  const { rows } = await pool.query(query, [
    productId,
    price ?? null,
    stock ?? null,
    description ?? null,
    name ?? null,
  ]);
  return rows[0] || null;
}

module.exports = {
  listProducts,
  getProductById,
  getProductByIdForUpdate,
  decrementStock,
  createProduct,
  updateProduct,
};
