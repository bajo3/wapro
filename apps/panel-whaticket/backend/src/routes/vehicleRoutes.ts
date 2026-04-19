import { Router } from "express";

import isAuth from "../middleware/isAuth";
import * as VehiclesController from "../controllers/VehiclesController";

const vehicleRoutes = Router();

vehicleRoutes.get("/vehicles", isAuth, VehiclesController.index);
vehicleRoutes.get("/vehicles/ml/health", isAuth, VehiclesController.mlHealth);
vehicleRoutes.post("/vehicles/:id/ml/predict-category", isAuth, VehiclesController.predictMlCategory);
vehicleRoutes.get("/vehicles/:id/ml/category-requirements", isAuth, VehiclesController.categoryRequirementsMl);
vehicleRoutes.post("/vehicles/:id/ml/validate", isAuth, VehiclesController.validateMl);
vehicleRoutes.post("/vehicles/:id/ml/dry-run", isAuth, VehiclesController.dryRunMl);
vehicleRoutes.post("/vehicles/:id/ml/publish", isAuth, VehiclesController.publishMl);
vehicleRoutes.put("/vehicles/:id/ml/sync", isAuth, VehiclesController.syncMl);
vehicleRoutes.post("/vehicles/:id/ml/pause", isAuth, VehiclesController.pauseMl);
vehicleRoutes.post("/vehicles/:id/ml/reactivate", isAuth, VehiclesController.reactivateMl);
vehicleRoutes.get("/vehicles/:id", isAuth, VehiclesController.show);
vehicleRoutes.post("/vehicles", isAuth, VehiclesController.store);
vehicleRoutes.put("/vehicles/:id", isAuth, VehiclesController.update);
vehicleRoutes.patch("/vehicles/:id/status", isAuth, VehiclesController.updateStatus);
vehicleRoutes.delete("/vehicles/:id", isAuth, VehiclesController.remove);
vehicleRoutes.post("/vehicles/:id/validate-meli-payload", isAuth, VehiclesController.validateMeliPayload);
vehicleRoutes.get("/admin/catalog-debug", isAuth, VehiclesController.debug);

export default vehicleRoutes;
