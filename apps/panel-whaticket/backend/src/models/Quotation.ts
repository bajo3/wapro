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
import User from "./User";

export type QuotationStatus = "draft" | "sent" | "accepted" | "rejected" | "viewed";

@Table
class Quotation extends Model<Quotation> {
  @PrimaryKey
  @AutoIncrement
  @Column
  id: number;

  @Column(DataType.STRING)
  number: string;

  @Column(DataType.STRING)
  status: QuotationStatus;

  // Client
  @Column(DataType.INTEGER)
  clientRefId: number;

  @Column(DataType.STRING)
  clientName: string;

  @Column(DataType.STRING)
  clientPhone: string;

  @ForeignKey(() => Contact)
  @Column
  contactId: number;

  @BelongsTo(() => Contact)
  contact: Contact;

  // Vehicle
  @Column(DataType.INTEGER)
  vehicleRefId: number;

  @Column(DataType.STRING)
  vehicleLabel: string;

  @Column(DataType.JSONB)
  vehicleData: any;

  @Column(DataType.STRING)
  currency: string;

  @Column(DataType.DECIMAL(15, 2))
  basePrice: string;

  @Column(DataType.DECIMAL(15, 2))
  discount: string;

  @Column(DataType.DECIMAL(15, 2))
  additionalCosts: string;

  @Column(DataType.DECIMAL(15, 2))
  totalPrice: string;

  @Column(DataType.JSONB)
  financing: any;

  @Column(DataType.JSONB)
  tradeIn: any;

  @Column(DataType.TEXT)
  notes: string;

  @Column(DataType.DATE)
  validUntil: Date;

  @Column(DataType.DATE)
  sentAt: Date;

  @ForeignKey(() => User)
  @Column
  createdByUserId: number;

  @BelongsTo(() => User)
  createdBy: User;

  @Column(DataType.JSONB)
  meta: any;

  @CreatedAt
  @Column(DataType.DATE(6))
  createdAt: Date;

  @UpdatedAt
  @Column(DataType.DATE(6))
  updatedAt: Date;
}

export default Quotation;
