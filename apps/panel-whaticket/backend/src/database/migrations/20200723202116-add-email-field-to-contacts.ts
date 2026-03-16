import { QueryInterface, DataTypes } from "sequelize";

/**
 * Migration to add an `email` column to the Contacts table. In early versions the
 * column may already exist if migrations were run out of order or reapplied,
 * causing errors like `column "email" of relation "Contacts" already exists`.
 * To make this migration idempotent we inspect the table definition before
 * attempting to add or remove the column. If the column is already present on
 * `up` the operation is skipped; similarly, `down` only removes the column if
 * it exists. See: https://sequelize.org/master/class/lib/query-interface.js~QueryInterface.html
 */
module.exports = {
  up: async (queryInterface: QueryInterface) => {
    // Describe the Contacts table to check existing columns. `describeTable`
    // returns an object mapping column names to definitions.
    const table = await queryInterface.describeTable("Contacts");
    if (!Object.prototype.hasOwnProperty.call(table, "email")) {
      try {
        await queryInterface.addColumn("Contacts", "email", {
          type: DataTypes.STRING,
          allowNull: false,
          defaultValue: ""
        });
      } catch (err: any) {
        const message = String(err?.message || "").toLowerCase();
        // Be resilient across partial deploys / concurrent migrations.
        if (!message.includes("already exists") && !message.includes("duplicate")) {
          throw err;
        }
      }
    }
    return Promise.resolve();
  },

  down: async (queryInterface: QueryInterface) => {
    // Remove the column only if it exists to avoid throwing an error during
    // rollback. This mirrors the behaviour in `up`.
    const table = await queryInterface.describeTable("Contacts");
    if (Object.prototype.hasOwnProperty.call(table, "email")) {
      try {
        await queryInterface.removeColumn("Contacts", "email");
      } catch (err: any) {
        const message = String(err?.message || "").toLowerCase();
        if (!message.includes("does not exist") && !message.includes("unknown column")) {
          throw err;
        }
      }
    }
    return Promise.resolve();
  }
};
