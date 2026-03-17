import { QueryInterface, DataTypes } from "sequelize";

module.exports = {
  up: async (queryInterface: QueryInterface) => {
    await queryInterface.createTable("Quotations", {
      id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
        allowNull: false
      },
      number: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true
      },
      status: {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: "draft"
      },

      // Client
      clientRefId: {
        type: DataTypes.INTEGER,
        allowNull: true
      },
      clientName: {
        type: DataTypes.STRING,
        allowNull: false
      },
      clientPhone: {
        type: DataTypes.STRING,
        allowNull: true
      },
      contactId: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: "Contacts", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "SET NULL"
      },

      // Vehicle
      vehicleRefId: {
        type: DataTypes.STRING,
        allowNull: true
      },
      vehicleLabel: {
        type: DataTypes.STRING,
        allowNull: false
      },
      vehicleData: {
        type: DataTypes.JSONB,
        allowNull: true
      },

      currency: {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: "USD"
      },

      basePrice: {
        type: DataTypes.DECIMAL(15, 2),
        allowNull: false,
        defaultValue: 0
      },
      discount: {
        type: DataTypes.DECIMAL(15, 2),
        allowNull: false,
        defaultValue: 0
      },
      additionalCosts: {
        type: DataTypes.DECIMAL(15, 2),
        allowNull: false,
        defaultValue: 0
      },
      totalPrice: {
        type: DataTypes.DECIMAL(15, 2),
        allowNull: false,
        defaultValue: 0
      },

      financing: {
        type: DataTypes.JSONB,
        allowNull: true
      },
      tradeIn: {
        type: DataTypes.JSONB,
        allowNull: true
      },

      notes: {
        type: DataTypes.TEXT,
        allowNull: true
      },

      validUntil: {
        type: DataTypes.DATE,
        allowNull: true
      },

      sentAt: {
        type: DataTypes.DATE,
        allowNull: true
      },

      createdByUserId: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: "Users", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "SET NULL"
      },

      meta: {
        type: DataTypes.JSONB,
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

    // Helpful indexes
    await queryInterface.addIndex("Quotations", ["status"]);
    await queryInterface.addIndex("Quotations", ["clientPhone"]);
    await queryInterface.addIndex("Quotations", ["createdAt"]);
  },

  down: async (queryInterface: QueryInterface) => {
    await queryInterface.dropTable("Quotations");
  }
};
