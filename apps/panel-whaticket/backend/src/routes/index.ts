import { Router } from "express";

import userRoutes from "./userRoutes";
import authRoutes from "./authRoutes";
import settingRoutes from "./settingRoutes";
import contactRoutes from "./contactRoutes";
import ticketRoutes from "./ticketRoutes";
import whatsappRoutes from "./whatsappRoutes";
import messageRoutes from "./messageRoutes";
import whatsappSessionRoutes from "./whatsappSessionRoutes";
import queueRoutes from "./queueRoutes";
import quickAnswerRoutes from "./quickAnswerRoutes";
import apiRoutes from "./apiRoutes";
import evolutionWebhookRoutes from "./evolutionWebhookRoutes";
import metaWebhookRoutes from "./metaWebhookRoutes";
import botIntelligenceRoutes from "./botIntelligenceRoutes";
import scheduledMessageRoutes from "./scheduledMessageRoutes";
import trainingMessageRoutes from "./trainingMessageRoutes";
import campaignRoutes from "./campaignRoutes";

import sequelize from "../database";

const routes = Router();

routes.get("/health", async (req, res) => {
  let dbOk = false;
  try {
    await sequelize.authenticate();
    dbOk = true;
  } catch {
    dbOk = false;
  }
  res.json({
    ok: true,
    dbOk,
    provider: String(process.env.WHATSAPP_PROVIDER || "").toUpperCase() || "WWEBJS",
    evolutionConfigured: !!process.env.EVOLUTION_API_URL,
    metaConfigured: !!process.env.GATEWAY_META_URL,
    time: new Date().toISOString()
  });
});

// Webhooks (no auth)
routes.use("/webhooks", evolutionWebhookRoutes);
routes.use("/webhooks", metaWebhookRoutes);

routes.use(userRoutes);
routes.use("/auth", authRoutes);
routes.use(settingRoutes);
routes.use(contactRoutes);
routes.use(ticketRoutes);
routes.use(whatsappRoutes);
routes.use(messageRoutes);
routes.use(whatsappSessionRoutes);
routes.use(queueRoutes);
routes.use(quickAnswerRoutes);
routes.use(scheduledMessageRoutes);
routes.use(trainingMessageRoutes);
routes.use(campaignRoutes);
routes.use("/api/messages", apiRoutes);
routes.use(botIntelligenceRoutes);

export default routes;
