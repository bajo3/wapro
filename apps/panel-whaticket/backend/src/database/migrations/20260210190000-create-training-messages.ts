import { QueryInterface, DataTypes } from "sequelize";

module.exports = {
  up: async (queryInterface: QueryInterface) => {
    await queryInterface.createTable("TrainingMessages", {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false
      },
      channel: {
        type: DataTypes.STRING,
        allowNull: false
      },
      direction: {
        type: DataTypes.STRING,
        allowNull: false
      },
      body: {
        type: DataTypes.TEXT,
        allowNull: true
      },
      externalMessageId: {
        type: DataTypes.STRING,
        allowNull: true
      },
      intent: {
        type: DataTypes.STRING,
        allowNull: true
      },
      approved: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false
      },
      suggestion: {
        type: DataTypes.TEXT,
        allowNull: true
      },
      meta: {
        type: DataTypes.JSONB,
        allowNull: true
      },
      contactId: {
        type: DataTypes.INTEGER,
        references: { model: "Contacts", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "SET NULL",
        allowNull: true
      },
      ticketId: {
        type: DataTypes.INTEGER,
        references: { model: "Tickets", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "SET NULL",
        allowNull: true
      },
      messageId: {
        type: DataTypes.STRING,
        references: { model: "Messages", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "SET NULL",
        allowNull: true
      },
      tenantId: {
        type: DataTypes.STRING,
        allowNull: true
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

    await queryInterface.addIndex("TrainingMessages", ["contactId"]);
    await queryInterface.addIndex("TrainingMessages", ["ticketId"]);
    await queryInterface.addIndex("TrainingMessages", ["channel"]);
    await queryInterface.addIndex("TrainingMessages", ["createdAt"]);
  },

  down: async (queryInterface: QueryInterface) => {
    await queryInterface.dropTable("TrainingMessages");
  }
};
