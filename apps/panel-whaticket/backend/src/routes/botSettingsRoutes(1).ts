import { Router } from "express";
import isAuth from "../middleware/isAuth";
import * as BotSettingsController from "../controllers/BotSettingsController";

const botSettingsRoutes = Router();

botSettingsRoutes.get("/bot/settings", isAuth, BotSettingsController.show);
botSettingsRoutes.put("/bot/settings", isAuth, BotSettingsController.update);

export default botSettingsRoutes;
