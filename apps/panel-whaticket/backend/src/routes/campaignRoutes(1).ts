import express from "express";
import isAuth from "../middleware/isAuth";

import * as CampaignsController from "../controllers/CampaignsController";

const campaignRoutes = express.Router();

// Instagram 1:1 campaigns filtered by tags/queues
campaignRoutes.post("/campaigns/instagram", isAuth, CampaignsController.sendInstagramCampaign);

export default campaignRoutes;
