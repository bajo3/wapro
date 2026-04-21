import {
  Table,
  Column,
  CreatedAt,
  UpdatedAt,
  Model,
  DataType,
  PrimaryKey,
  ForeignKey,
  BelongsTo
} from "sequelize-typescript";

import User from "./User";

@Table({ tableName: "vehicles" })
class Vehicle extends Model<Vehicle> {
  @PrimaryKey
  @Column(DataType.STRING)
  id: string;

  @Column(DataType.STRING)
  slug: string | null;

  @Column(DataType.STRING)
  source: string;

  @Column(DataType.STRING)
  internalStatus: string;

  @ForeignKey(() => User)
  @Column(DataType.INTEGER)
  createdByUserId: number | null;

  @BelongsTo(() => User, { foreignKey: "createdByUserId", as: "createdBy" })
  createdBy: User;

  @ForeignKey(() => User)
  @Column(DataType.INTEGER)
  updatedByUserId: number | null;

  @BelongsTo(() => User, { foreignKey: "updatedByUserId", as: "updatedBy" })
  updatedBy: User;

  @Column(DataType.STRING)
  title: string | null;

  @Column(DataType.STRING)
  brand: string | null;

  @Column(DataType.STRING)
  model: string | null;

  @Column(DataType.STRING)
  version: string | null;

  @Column(DataType.INTEGER)
  year: number | null;

  @Column(DataType.INTEGER)
  km: number | null;

  @Column(DataType.DECIMAL(15, 2))
  price: string | null;

  @Column(DataType.STRING)
  currency: string | null;

  @Column(DataType.STRING)
  condition: string | null;

  @Column(DataType.STRING)
  color: string | null;

  @Column(DataType.STRING)
  fuel: string | null;

  @Column(DataType.STRING)
  transmission: string | null;

  @Column(DataType.INTEGER)
  doors: number | null;

  @Column(DataType.STRING)
  engine: string | null;

  @Column(DataType.STRING)
  traction: string | null;

  @Column(DataType.STRING)
  bodyType: string | null;

  @Column(DataType.STRING)
  vehicleType: string | null;

  @Column(DataType.STRING)
  domain: string | null;

  @Column(DataType.STRING)
  patent: string | null;

  @Column(DataType.STRING)
  plate: string | null;

  @Column(DataType.STRING)
  vin: string | null;

  @Column(DataType.STRING)
  locationCity: string | null;

  @Column(DataType.STRING)
  locationState: string | null;

  @Column(DataType.TEXT)
  description: string | null;

  @Column(DataType.JSONB)
  images: Array<string | Record<string, any>>;

  @Column(DataType.JSONB)
  pictures: Array<Record<string, any>>;

  @Column(DataType.STRING)
  permalink: string | null;

  @Column(DataType.BOOLEAN)
  publishToMeli: boolean;

  @Column(DataType.STRING)
  meliItemId: string | null;

  @Column(DataType.STRING)
  meliStatus: string | null;

  @Column(DataType.STRING)
  meliPermalink: string | null;

  @Column(DataType.STRING)
  meliCategoryId: string | null;

  @Column(DataType.STRING)
  meliDomainId: string | null;

  @Column(DataType.STRING)
  meliListingTypeId: string | null;

  @Column(DataType.JSONB)
  meliAttributes: Array<Record<string, any>>;

  @Column(DataType.JSONB)
  meliPayloadDraft: Record<string, any> | null;

  @Column(DataType.DATE)
  meliLastSyncAt: Date | null;

  @Column(DataType.TEXT)
  meliLastError: string | null;

  @Column(DataType.JSONB)
  meliValidationErrors: string[];

  @CreatedAt
  @Column(DataType.DATE)
  createdAt: Date;

  @UpdatedAt
  @Column(DataType.DATE)
  updatedAt: Date;
}

export default Vehicle;
