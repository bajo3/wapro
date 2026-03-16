import { QueryInterface, DataTypes } from "sequelize";

module.exports = {
  up: async (queryInterface: QueryInterface) => {
    await queryInterface.addColumn("Tickets", "pipelineStageId", {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: { model: "PipelineStages", key: "id" },
      onUpdate: "CASCADE",
      onDelete: "SET NULL"
    });

    await queryInterface.addColumn("Tickets", "stageChangedAt", {
      type: DataTypes.DATE,
      allowNull: true
    });

    await queryInterface.addColumn("Tickets", "dealValue", {
      type: DataTypes.DECIMAL(15, 2),
      allowNull: true
    });

    await queryInterface.addColumn("Tickets", "dealCurrency", {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: "ARS"
    });

    // Backfill existing tickets to default stage
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [rows]: any = await queryInterface.sequelize.query(
      'SELECT id FROM "PipelineStages" WHERE "isDefault" = true ORDER BY "order" ASC LIMIT 1;'
    );
    const defaultId = rows?.[0]?.id;
    if (defaultId) {
      await queryInterface.sequelize.query(
        `UPDATE "Tickets" SET "pipelineStageId" = ${defaultId}, "stageChangedAt" = COALESCE("stageChangedAt", NOW()) WHERE "pipelineStageId" IS NULL;`
      );
    }
  },

  down: async (queryInterface: QueryInterface) => {
    await queryInterface.removeColumn("Tickets", "dealCurrency");
    await queryInterface.removeColumn("Tickets", "dealValue");
    await queryInterface.removeColumn("Tickets", "stageChangedAt");
    await queryInterface.removeColumn("Tickets", "pipelineStageId");
  }
};
