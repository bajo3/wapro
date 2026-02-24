import {
  Table,
  Column,
  CreatedAt,
  UpdatedAt,
  Model,
  PrimaryKey,
  AutoIncrement,
  Default,
  HasMany
} from "sequelize-typescript";

import Ticket from "./Ticket";

export type PipelineStageCategory = "OPEN" | "WON" | "LOST";

@Table
class PipelineStage extends Model<PipelineStage> {
  @PrimaryKey
  @AutoIncrement
  @Column
  id: number;

  @Column
  name: string;

  @Default("OPEN")
  @Column
  category: PipelineStageCategory;

  @Default(0)
  @Column
  order: number;

  @Default(false)
  @Column
  isDefault: boolean;

  @CreatedAt
  createdAt: Date;

  @UpdatedAt
  updatedAt: Date;

  @HasMany(() => Ticket)
  tickets: Ticket[];
}

export default PipelineStage;
