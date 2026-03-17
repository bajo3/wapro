import { QueryInterface, DataTypes } from "sequelize";

module.exports = {
  up: async (queryInterface: QueryInterface) => {
    await queryInterface.changeColumn("Quotations", "vehicleRefId", {
      type: DataTypes.STRING,
      allowNull: true
    });
  },

  down: async (queryInterface: QueryInterface) => {
    await queryInterface.changeColumn("Quotations", "vehicleRefId", {
      type: DataTypes.INTEGER,
      allowNull: true
    });
  }
};
