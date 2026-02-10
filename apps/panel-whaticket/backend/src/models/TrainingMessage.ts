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
import Message from "./Message";

export type TrainingDirection = "IN" | "OUT";
export type TrainingChannel = "whatsapp" | "instagram" | "facebook" | "web";

@Table
class TrainingMessage extends Model<TrainingMessage> {
  @PrimaryKey
  @AutoIncrement
  @Column
  id: number;

  @Column(DataType.STRING)
  channel: TrainingChannel;

  @Column(DataType.STRING)
  direction: TrainingDirection;

  @Column(DataType.TEXT)
  body: string;

  @Column(DataType.STRING)
  externalMessageId: string;

  @Column(DataType.STRING)
  intent: string;

  @Column(DataType.BOOLEAN)
  approved: boolean;

  @Column(DataType.TEXT)
  suggestion: string;

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

  @ForeignKey(() => Message)
  @Column
  messageId: string;

  @BelongsTo(() => Message)
  message: Message;

  // Multi-tenant groundwork (nullable for now)
  @Column(DataType.STRING)
  tenantId: string;

  @CreatedAt
  @Column(DataType.DATE(6))
  createdAt: Date;

  @UpdatedAt
  @Column(DataType.DATE(6))
  updatedAt: Date;
}

export default TrainingMessage;
