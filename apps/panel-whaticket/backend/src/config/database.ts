require("../bootstrap");

const pool = {
  max: Number(process.env.DB_POOL_MAX || 2),
  min: Number(process.env.DB_POOL_MIN || 0),
  acquire: Number(process.env.DB_POOL_ACQUIRE || 30000),
  idle: Number(process.env.DB_POOL_IDLE || 10000)
};

// Si DATABASE_URL está seteada (Railway, Supabase, Heroku, etc.),
// el CLI de Sequelize la usa directamente via use_env_variable.
// Esto garantiza que CLI y runtime apunten a la misma DB.
module.exports = process.env.DATABASE_URL
  ? {
      use_env_variable: "DATABASE_URL",
      dialect: "postgres",
      dialectOptions: { ssl: { rejectUnauthorized: false } },
      logging: false,
      pool
    }
  : {
      define: {
        charset: "utf8mb4",
        collate: "utf8mb4_bin"
      },
      dialect: process.env.DB_DIALECT || "postgres",
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
              ssl: { require: true, rejectUnauthorized: false }
            }
          }
        : {}),
      logging: false,
      pool
    };
