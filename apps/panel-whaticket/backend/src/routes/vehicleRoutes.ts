import { Router } from "express";
import isAuth from "../middleware/isAuth";
import * as VehiclesController from "../controllers/VehiclesController";

const vehicleRoutes = Router();

vehicleRoutes.get("/vehicles", isAuth, VehiclesController.index);

export default vehicleRoutes;
