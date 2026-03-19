import { QueryInterface, DataTypes } from "sequelize";

module.exports = {
  up: async (queryInterface: QueryInterface) => {
    const table = "AgentFeedbacks";

    await queryInterface.addColumn(table, "exportedToTestCase", {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false
    });

    await queryInterface.addColumn(table, "exportedToTestCaseAt", {
      type: DataTypes.DATE,
      allowNull: true,
      defaultValue: null
    });
  },

  down: async (queryInterface: QueryInterface) => {
    const table = "AgentFeedbacks";
    await queryInterface.removeColumn(table, "exportedToTestCaseAt");
    await queryInterface.removeColumn(table, "exportedToTestCase");
  }
};
