import { Router } from "express";

import { evolutionWebhook, persistBotMessageWebhook } from "../controllers/EvolutionWebhookController";

const evolutionWebhookRoutes = Router();

// Evolution webhook (unauthenticated; protected by EVOLUTION_WEBHOOK_SECRET)
evolutionWebhookRoutes.post("/evolution/:instanceName", evolutionWebhook);
// Internal bot -> panel message persistence webhook (protected by BOT_ADMIN_TOKEN)
evolutionWebhookRoutes.post("/bot/messages", persistBotMessageWebhook);

export default evolutionWebhookRoutes;
