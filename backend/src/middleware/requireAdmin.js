const { ADMIN_TOKEN } = require("../config/env");

function requireAdmin(req, res, next) {
  // Extract token from Authorization header.
  // Expected format: "Bearer <token>"
  const authHeader = req.headers["authorization"] || "";
  const token = authHeader.startsWith("Bearer ")
    ? authHeader.slice(7)          // strip "Bearer " prefix
    : null;

  if (!token || token !== ADMIN_TOKEN) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  next();
}

module.exports = requireAdmin;