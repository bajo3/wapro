import { Router } from "express";

import { metaWebhook } from "../controllers/MetaWebhookController";

const metaWebhookRoutes = Router();

// Meta webhook (unauthenticated; optionally protected by X-Meta-Secret)
metaWebhookRoutes.post("/meta", metaWebhook);

export default metaWebhookRoutes;
