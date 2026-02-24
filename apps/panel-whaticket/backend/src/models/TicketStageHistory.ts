import {
  Table,
  Column,
  CreatedAt,
  UpdatedAt,
  Model,
  PrimaryKey,
  AutoIncrement,
  ForeignKey,
  BelongsTo
} from "sequelize-typescript";

import Ticket from "./Ticket";
import PipelineStage from "./PipelineStage";

@Table
class TicketStageHistory extends Model<TicketStageHistory> {
  @PrimaryKey
  @AutoIncrement
  @Column
  id: number;

  @ForeignKey(() => Ticket)
  @Column
  ticketId: number;

  @BelongsTo(() => Ticket)
  ticket: Ticket;

  @ForeignKey(() => PipelineStage)
  @Column
  fromStageId: number;

  @ForeignKey(() => PipelineStage)
  @Column
  toStageId: number;

  @Column
  changedByUserId: number;

  @Column
  reason: string;

  @CreatedAt
  createdAt: Date;

  @UpdatedAt
  updatedAt: Date;
}

export default TicketStageHistory;
