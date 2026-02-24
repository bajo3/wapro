import { QueryInterface, DataTypes } from "sequelize";

module.exports = {
  up: async (queryInterface: QueryInterface) => {
    await queryInterface.createTable("TicketStageHistories", {
      id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true
      },
      ticketId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "Tickets", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE"
      },
      fromStageId: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: "PipelineStages", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "SET NULL"
      },
      toStageId: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: "PipelineStages", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "SET NULL"
      },
      changedByUserId: {
        type: DataTypes.INTEGER,
        allowNull: true
      },
      reason: {
        type: DataTypes.STRING,
        allowNull: true
      },
      createdAt: {
        type: DataTypes.DATE,
        allowNull: false
      },
      updatedAt: {
        type: DataTypes.DATE,
        allowNull: false
      }
    });

    await queryInterface.addIndex("TicketStageHistories", ["ticketId"]);
    await queryInterface.addIndex("PipelineStages", ["order"]);
  },

  down: async (queryInterface: QueryInterface) => {
    await queryInterface.dropTable("TicketStageHistories");
  }
};
