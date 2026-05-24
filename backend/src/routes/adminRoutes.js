const express = require("express");
const productsRepository = require("../repositories/productsRepository");
const requireAdmin = require("../middleware/requireAdmin");

const router = express.Router();

// requireAdmin applied to ALL routes in this file via router.use.
// Any new route added to this file is automatically protected —
// safer than applying per-route where a developer might forget.
router.use(requireAdmin);

router.post("/products", async (req, res, next) => {
  try {
    const { sku, name, description, price, stock } = req.body;
    if (!sku || !name || price == null || stock == null) {
      return res
        .status(400)
        .json({ error: "sku, name, price, stock are required" });
    }
    const product = await productsRepository.createProduct({
      sku,
      name,
      description,
      price,
      stock,
    });
    res.status(201).json(product);
  } catch (err) {
    next(err);
  }
});

router.patch("/products/:id", async (req, res, next) => {
  try {
    const { price, stock, description, name } = req.body;
    const product = await productsRepository.updateProduct(req.params.id, {
      price,
      stock,
      description,
      name,
    });
    if (!product) {
      return res.status(404).json({ error: "Product not found" });
    }
    res.json(product);
  } catch (err) {
    next(err);
  }
});

module.exports = router;