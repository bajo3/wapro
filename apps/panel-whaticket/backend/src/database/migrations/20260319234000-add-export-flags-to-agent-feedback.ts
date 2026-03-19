import { QueryInterface, DataTypes } from "sequelize";

module.exports = {
  up: async (queryInterface: QueryInterface) => {
    await queryInterface.addColumn("AgentFeedbacks", "exportedToExample", {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false
    });

    await queryInterface.addColumn("AgentFeedbacks", "exportedAt", {
      type: DataTypes.DATE(6),
      allowNull: true
    });
  },

  down: async (queryInterface: QueryInterface) => {
    await queryInterface.removeColumn("AgentFeedbacks", "exportedAt");
    await queryInterface.removeColumn("AgentFeedbacks", "exportedToExample");
  }
};
