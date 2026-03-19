import { QueryInterface, DataTypes } from "sequelize";

module.exports = {
  up: async (queryInterface: QueryInterface) => {
    await queryInterface.createTable("AgentFeedbacks", {
      id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
        allowNull: false
      },
      source: {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: "ticket_agent_panel"
      },
      verdict: {
        type: DataTypes.STRING,
        allowNull: false
      },
      note: {
        type: DataTypes.TEXT,
        allowNull: true
      },
      suggestedReply: {
        type: DataTypes.TEXT,
        allowNull: true
      },
      finalReply: {
        type: DataTypes.TEXT,
        allowNull: true
      },
      intent: {
        type: DataTypes.STRING,
        allowNull: true
      },
      action: {
        type: DataTypes.STRING,
        allowNull: true
      },
      confidence: {
        type: DataTypes.FLOAT,
        allowNull: true
      },
      meta: {
        type: DataTypes.JSONB,
        allowNull: true
      },
      contactId: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: "Contacts", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "SET NULL"
      },
      ticketId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "Tickets", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE"
      },
      userId: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: "Users", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "SET NULL"
      },
      createdAt: {
        type: DataTypes.DATE(6),
        allowNull: false
      },
      updatedAt: {
        type: DataTypes.DATE(6),
        allowNull: false
      }
    });
  },

  down: async (queryInterface: QueryInterface) => {
    await queryInterface.dropTable("AgentFeedbacks");
  }
};
