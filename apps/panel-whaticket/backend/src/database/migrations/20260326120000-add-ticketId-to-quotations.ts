import { QueryInterface, DataTypes } from "sequelize";

module.exports = {
  up: async (queryInterface: QueryInterface) => {
    await queryInterface.addColumn("Quotations", "ticketId", {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: { model: "Tickets", key: "id" },
      onUpdate: "CASCADE",
      onDelete: "SET NULL"
    });

    await queryInterface.addIndex("Quotations", ["ticketId"]);
  },

  down: async (queryInterface: QueryInterface) => {
    await queryInterface.removeIndex("Quotations", ["ticketId"]);
    await queryInterface.removeColumn("Quotations", "ticketId");
  }
};
