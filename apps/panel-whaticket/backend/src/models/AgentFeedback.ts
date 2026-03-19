import {
  Table,
  Column,
  CreatedAt,
  UpdatedAt,
  Model,
  DataType,
  PrimaryKey,
  AutoIncrement,
  ForeignKey,
  BelongsTo
} from "sequelize-typescript";

import Contact from "./Contact";
import Ticket from "./Ticket";
import User from "./User";

export type AgentFeedbackVerdict = "approved" | "rejected" | "edited" | "handoff";

@Table
class AgentFeedback extends Model<AgentFeedback> {
  @PrimaryKey
  @AutoIncrement
  @Column
  id: number;

  @Column(DataType.STRING)
  source: string;

  @Column(DataType.STRING)
  verdict: AgentFeedbackVerdict;

  @Column(DataType.TEXT)
  note: string;

  @Column(DataType.TEXT)
  suggestedReply: string;

  @Column(DataType.TEXT)
  finalReply: string;

  @Column(DataType.STRING)
  intent: string;

  @Column(DataType.STRING)
  action: string;

  @Column(DataType.FLOAT)
  confidence: number;

  @Column(DataType.JSONB)
  meta: any;

  @ForeignKey(() => Contact)
  @Column
  contactId: number;

  @BelongsTo(() => Contact)
  contact: Contact;

  @ForeignKey(() => Ticket)
  @Column
  ticketId: number;

  @BelongsTo(() => Ticket)
  ticket: Ticket;

  @ForeignKey(() => User)
  @Column
  userId: number;

  @BelongsTo(() => User)
  user: User;

  @CreatedAt
  @Column(DataType.DATE(6))
  createdAt: Date;

  @UpdatedAt
  @Column(DataType.DATE(6))
  updatedAt: Date;
}

export default AgentFeedback;
