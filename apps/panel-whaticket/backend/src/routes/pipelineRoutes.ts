import express from "express";
import isAuth from "../middleware/isAuth";
import * as PipelineController from "../controllers/PipelineController";

const pipelineRoutes = express.Router();

pipelineRoutes.get("/pipeline/board", isAuth, PipelineController.board);

pipelineRoutes.get("/pipeline/stages", isAuth, PipelineController.listStages);
pipelineRoutes.post("/pipeline/stages", isAuth, PipelineController.createStage);
pipelineRoutes.put("/pipeline/stages/:id", isAuth, PipelineController.updateStage);
pipelineRoutes.delete("/pipeline/stages/:id", isAuth, PipelineController.deleteStage);

pipelineRoutes.patch(
  "/pipeline/tickets/:ticketId/stage",
  isAuth,
  PipelineController.updateTicketStage
);

pipelineRoutes.patch(
  "/pipeline/tickets/:ticketId/value",
  isAuth,
  PipelineController.updateTicketValue
);

export default pipelineRoutes;
