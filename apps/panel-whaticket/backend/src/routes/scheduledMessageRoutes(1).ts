import express from "express";
import isAuth from "../middleware/isAuth";

import * as ScheduledMessagesController from "../controllers/ScheduledMessagesController";

const scheduledMessageRoutes = express.Router();

scheduledMessageRoutes.get("/scheduled-messages", isAuth, ScheduledMessagesController.index);
scheduledMessageRoutes.post("/scheduled-messages", isAuth, ScheduledMessagesController.store);
scheduledMessageRoutes.post("/scheduled-messages/:id/cancel", isAuth, ScheduledMessagesController.cancel);
scheduledMessageRoutes.delete("/scheduled-messages/:id", isAuth, ScheduledMessagesController.remove);

export default scheduledMessageRoutes;
