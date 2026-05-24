require("dotenv/config");

module.exports = {
  PORT: process.env.PORT || 3000,
  DATABASE_URL: process.env.DATABASE_URL,
  REDIS_URL: process.env.REDIS_URL,
  PAYMENT_FAILURE_RATE: Number(process.env.PAYMENT_FAILURE_RATE || 0.1),
  PAYMENT_DELAY_MIN_MS: Number(process.env.PAYMENT_DELAY_MIN_MS || 50),
  PAYMENT_DELAY_MAX_MS: Number(process.env.PAYMENT_DELAY_MAX_MS || 600),
  ADMIN_TOKEN: process.env.ADMIN_TOKEN || "change-me",
  FRONTEND_ORIGIN: process.env.FRONTEND_ORIGIN || "http://localhost:5173",
  WEBHOOK_SECRET: process.env.WEBHOOK_SECRET || "replace-me",
};
