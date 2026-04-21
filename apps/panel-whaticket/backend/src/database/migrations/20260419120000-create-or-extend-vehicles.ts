import { QueryInterface, DataTypes, Sequelize } from "sequelize";

const TABLE_NAME = "vehicles";
const LEGACY_TABLE_NAME = "Vehicles";

const baseColumns = {
  id: {
    type: DataTypes.STRING,
    primaryKey: true,
    allowNull: false
  },
  slug: {
    type: DataTypes.STRING,
    allowNull: true,
    unique: true
  },
  source: {
    type: DataTypes.STRING,
    allowNull: false,
    defaultValue: "wapro"
  },
  internalStatus: {
    type: DataTypes.STRING,
    allowNull: false,
    defaultValue: "draft"
  },
  createdByUserId: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: { model: "Users", key: "id" },
    onUpdate: "CASCADE",
    onDelete: "SET NULL"
  },
  updatedByUserId: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: { model: "Users", key: "id" },
    onUpdate: "CASCADE",
    onDelete: "SET NULL"
  },
  title: {
    type: DataTypes.STRING,
    allowNull: true
  },
  brand: {
    type: DataTypes.STRING,
    allowNull: true
  },
  model: {
    type: DataTypes.STRING,
    allowNull: true
  },
  version: {
    type: DataTypes.STRING,
    allowNull: true
  },
  year: {
    type: DataTypes.INTEGER,
    allowNull: true
  },
  km: {
    type: DataTypes.INTEGER,
    allowNull: true
  },
  price: {
    type: DataTypes.DECIMAL(15, 2),
    allowNull: true
  },
  currency: {
    type: DataTypes.STRING,
    allowNull: true
  },
  condition: {
    type: DataTypes.STRING,
    allowNull: true
  },
  color: {
    type: DataTypes.STRING,
    allowNull: true
  },
  fuel: {
    type: DataTypes.STRING,
    allowNull: true
  },
  transmission: {
    type: DataTypes.STRING,
    allowNull: true
  },
  doors: {
    type: DataTypes.INTEGER,
    allowNull: true
  },
  engine: {
    type: DataTypes.STRING,
    allowNull: true
  },
  traction: {
    type: DataTypes.STRING,
    allowNull: true
  },
  bodyType: {
    type: DataTypes.STRING,
    allowNull: true
  },
  vehicleType: {
    type: DataTypes.STRING,
    allowNull: true
  },
  domain: {
    type: DataTypes.STRING,
    allowNull: true
  },
  patent: {
    type: DataTypes.STRING,
    allowNull: true
  },
  plate: {
    type: DataTypes.STRING,
    allowNull: true
  },
  vin: {
    type: DataTypes.STRING,
    allowNull: true
  },
  locationCity: {
    type: DataTypes.STRING,
    allowNull: true
  },
  locationState: {
    type: DataTypes.STRING,
    allowNull: true
  },
  description: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  images: {
    type: DataTypes.JSONB,
    allowNull: false,
    defaultValue: []
  },
  pictures: {
    type: DataTypes.JSONB,
    allowNull: false,
    defaultValue: []
  },
  permalink: {
    type: DataTypes.STRING,
    allowNull: true
  },
  publishToMeli: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false
  },
  meliItemId: {
    type: DataTypes.STRING,
    allowNull: true
  },
  meliStatus: {
    type: DataTypes.STRING,
    allowNull: true
  },
  meliPermalink: {
    type: DataTypes.STRING,
    allowNull: true
  },
  meliCategoryId: {
    type: DataTypes.STRING,
    allowNull: true
  },
  meliDomainId: {
    type: DataTypes.STRING,
    allowNull: true
  },
  meliListingTypeId: {
    type: DataTypes.STRING,
    allowNull: true
  },
  meliAttributes: {
    type: DataTypes.JSONB,
    allowNull: false,
    defaultValue: []
  },
  meliPayloadDraft: {
    type: DataTypes.JSONB,
    allowNull: true
  },
  meliLastSyncAt: {
    type: DataTypes.DATE,
    allowNull: true
  },
  meliLastError: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  meliValidationErrors: {
    type: DataTypes.JSONB,
    allowNull: false,
    defaultValue: []
  },
  createdAt: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: Sequelize.literal("CURRENT_TIMESTAMP")
  },
  updatedAt: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: Sequelize.literal("CURRENT_TIMESTAMP")
  }
};

const tableExists = async (queryInterface: QueryInterface, tableName: string): Promise<boolean> => {
  try {
    await queryInterface.describeTable(tableName);
    return true;
  } catch {
    return false;
  }
};

const addIndexIfPossible = async (
  queryInterface: QueryInterface,
  tableName: string,
  fields: string[],
  options: Record<string, any> = {}
) => {
  try {
    await queryInterface.addIndex(tableName, fields, options);
  } catch {
    // ignore duplicated indexes on existing installs
  }
};

module.exports = {
  up: async (queryInterface: QueryInterface) => {
    const hasCanonical = await tableExists(queryInterface, TABLE_NAME);
    const hasLegacy = await tableExists(queryInterface, LEGACY_TABLE_NAME);

    if (!hasCanonical && hasLegacy) {
      await queryInterface.renameTable(LEGACY_TABLE_NAME, TABLE_NAME);
    }

    if (!(await tableExists(queryInterface, TABLE_NAME))) {
      await queryInterface.createTable(TABLE_NAME, baseColumns);
    }

    const tableDefinition = await queryInterface.describeTable(TABLE_NAME) as Record<string, any>;
    for (const [columnName, config] of Object.entries(baseColumns)) {
      if (!tableDefinition[columnName]) {
        await queryInterface.addColumn(TABLE_NAME, columnName, config);
      }
    }

    await queryInterface.sequelize.query(`
      UPDATE "${TABLE_NAME}"
      SET "internalStatus" = COALESCE(NULLIF("internalStatus", ''), 'draft'),
          "source" = COALESCE(NULLIF("source", ''), 'wapro')
    `);

    if (!tableDefinition.createdAt && tableDefinition.created_at) {
      await queryInterface.sequelize.query(`
        UPDATE "${TABLE_NAME}"
        SET "createdAt" = COALESCE("createdAt", "created_at")
      `);
    }

    if (!tableDefinition.updatedAt && tableDefinition.updated_at) {
      await queryInterface.sequelize.query(`
        UPDATE "${TABLE_NAME}"
        SET "updatedAt" = COALESCE("updatedAt", "updated_at")
      `);
    }

    await addIndexIfPossible(queryInterface, TABLE_NAME, ["brand"]);
    await addIndexIfPossible(queryInterface, TABLE_NAME, ["model"]);
    await addIndexIfPossible(queryInterface, TABLE_NAME, ["year"]);
    await addIndexIfPossible(queryInterface, TABLE_NAME, ["internalStatus"]);
    await addIndexIfPossible(queryInterface, TABLE_NAME, ["meliStatus"]);
    await addIndexIfPossible(queryInterface, TABLE_NAME, ["publishToMeli"]);
    await addIndexIfPossible(queryInterface, TABLE_NAME, ["slug"], { unique: true });
  },

  down: async () => {
    // No-op on purpose.
    // This migration is additive and may run on an existing production
    // `vehicles` table. Rolling back by dropping the table or removing columns
    // would risk deleting productive inventory data.
  }
};
