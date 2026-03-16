import { QueryInterface, DataTypes } from "sequelize";

module.exports = {
  up: async (queryInterface: QueryInterface) => {
    await queryInterface.createTable("PipelineStages", {
      id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true
      },
      name: {
        type: DataTypes.STRING,
        allowNull: false
      },
      category: {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: "OPEN"
      },
      order: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0
      },
      isDefault: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false
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

    // Seed default stages (single migration to keep installs simple)
    const now = new Date();
    await queryInterface.bulkInsert(
      "PipelineStages",
      [
        { name: "Nuevo", category: "OPEN", order: 0, isDefault: true, createdAt: now, updatedAt: now },
        { name: "Contactado", category: "OPEN", order: 1, isDefault: false, createdAt: now, updatedAt: now },
        { name: "Interesado", category: "OPEN", order: 2, isDefault: false, createdAt: now, updatedAt: now },
        { name: "Negociando", category: "OPEN", order: 3, isDefault: false, createdAt: now, updatedAt: now },
        { name: "Reserva", category: "OPEN", order: 4, isDefault: false, createdAt: now, updatedAt: now },
        { name: "Vendido", category: "WON", order: 5, isDefault: false, createdAt: now, updatedAt: now },
        { name: "Perdido", category: "LOST", order: 6, isDefault: false, createdAt: now, updatedAt: now }
      ],
      {}
    );
  },

  down: async (queryInterface: QueryInterface) => {
    await queryInterface.dropTable("PipelineStages");
  }
};
