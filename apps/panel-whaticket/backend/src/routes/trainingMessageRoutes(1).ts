import express from "express";
import isAuth from "../middleware/isAuth";

import * as TrainingMessagesController from "../controllers/TrainingMessagesController";

const trainingMessageRoutes = express.Router();

trainingMessageRoutes.get("/training-messages", isAuth, TrainingMessagesController.index);
trainingMessageRoutes.put("/training-messages/:id", isAuth, TrainingMessagesController.update);
trainingMessageRoutes.delete("/training-messages/:id", isAuth, TrainingMessagesController.remove);

export default trainingMessageRoutes;
