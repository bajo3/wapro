import { Sequelize } from "sequelize-typescript";
import User from "../models/User";
import Setting from "../models/Setting";
import Contact from "../models/Contact";
import Ticket from "../models/Ticket";
import Whatsapp from "../models/Whatsapp";
import ContactCustomField from "../models/ContactCustomField";
import Message from "../models/Message";
import Queue from "../models/Queue";
import WhatsappQueue from "../models/WhatsappQueue";
import UserQueue from "../models/UserQueue";
import QuickAnswer from "../models/QuickAnswer";
import TicketTag from "../models/TicketTag";
import TicketNote from "../models/TicketNote";
import ScheduledMessage from "../models/ScheduledMessage";
import TrainingMessage from "../models/TrainingMessage";
import PipelineStage from "../models/PipelineStage";
import TicketStageHistory from "../models/TicketStageHistory";
import Quotation from "../models/Quotation";
import AgentFeedback from "../models/AgentFeedback";
import { resolveDatabaseUrl } from "../config/resolveDatabaseUrl";

// eslint-disable-next-line
const dbConfig = require("../config/database");

/**
 * If DATABASE_URL is set, use it directly (Supabase pooler, Railway, etc.).
 * Sequelize v5 doesn't support a top-level `url` key in config, so we
 * instantiate with the URI string when available.
 */
const rawDbUrl = resolveDatabaseUrl();
const sequelize = rawDbUrl
  ? new Sequelize(rawDbUrl, {
      dialect: "postgres",
      dialectOptions: { ssl: { rejectUnauthorized: false } },
      logging: false,
      pool: dbConfig.pool
    })
  : new Sequelize(dbConfig);

const models = [
  User,
  Contact,
  Ticket,
  Message,
  Whatsapp,
  ContactCustomField,
  Setting,
  Queue,
  WhatsappQueue,
  UserQueue,
  QuickAnswer,
  TicketTag,
  TicketNote,
  ScheduledMessage,
  TrainingMessage,
  PipelineStage,
  TicketStageHistory,
  Quotation,
  AgentFeedback
];

sequelize.addModels(models);

export default sequelize;
