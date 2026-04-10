import { QueryInterface } from "sequelize";

module.exports = {
  up: async (queryInterface: QueryInterface) => {
    // IF NOT EXISTS: seguro si la migración 120000 ya corrió en este entorno
    await queryInterface.sequelize.query(`
      CREATE TABLE IF NOT EXISTS "ScheduledMessages" (
        "id"        SERIAL PRIMARY KEY,
        "ticketId"  INTEGER REFERENCES "Tickets"("id") ON UPDATE CASCADE ON DELETE SET NULL,
        "contactId" INTEGER REFERENCES "Contacts"("id") ON UPDATE CASCADE ON DELETE SET NULL,
        "userId"    INTEGER REFERENCES "Users"("id") ON UPDATE CASCADE ON DELETE SET NULL,
        "body"      TEXT NOT NULL,
        "mediaUrl"  TEXT,
        "sendAt"    TIMESTAMP WITH TIME ZONE NOT NULL,
        "status"    VARCHAR(255) NOT NULL DEFAULT 'PENDING',
        "lastError" TEXT,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL,
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL
      )
    `);

    await queryInterface.sequelize.query(`
      CREATE INDEX IF NOT EXISTS "scheduled_messages_send_at_idx"
        ON "ScheduledMessages" ("sendAt")
    `);
    await queryInterface.sequelize.query(`
      CREATE INDEX IF NOT EXISTS "scheduled_messages_status_idx"
        ON "ScheduledMessages" ("status")
    `);
  },

  down: async (queryInterface: QueryInterface) => {
    await queryInterface.dropTable("ScheduledMessages");
  }
};
