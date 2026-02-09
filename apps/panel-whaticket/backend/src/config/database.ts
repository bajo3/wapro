require("../bootstrap");

module.exports = {
  define: {
    charset: "utf8mb4",
    collate: "utf8mb4_bin"
  },
  dialect: process.env.DB_DIALECT || "mysql",
  timezone: "-03:00",
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 5432),
  database: process.env.DB_NAME,
  username: process.env.DB_USER,
  password: process.env.DB_PASS,
  ...(String(process.env.DB_SSL || "").toLowerCase() === "true" &&
  String(process.env.DB_DIALECT || "").toLowerCase() === "postgres"
    ? {
        dialectOptions: {
          ssl: {
            require: true,
            rejectUnauthorized: false
          }
        }
      }
    : {}),
  logging: false,

  // Railway/Supabase poolers suelen limitar conexiones concurrentes.
  // Exponer pool por ENV ayuda a evitar: "sorry, too many clients already".
  pool: {
    max: Number(process.env.DB_POOL_MAX || 2),
    min: Number(process.env.DB_POOL_MIN || 0),
    acquire: Number(process.env.DB_POOL_ACQUIRE || 30000),
    idle: Number(process.env.DB_POOL_IDLE || 10000)
  }
};
