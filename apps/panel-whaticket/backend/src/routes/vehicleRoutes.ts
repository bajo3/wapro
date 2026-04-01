import { Router } from "express";
import isAuth from "../middleware/isAuth";
import * as VehiclesController from "../controllers/VehiclesController";

const vehicleRoutes = Router();

vehicleRoutes.get("/vehicles", isAuth, VehiclesController.index);
vehicleRoutes.delete("/vehicles/:id", isAuth, VehiclesController.remove);

// Endpoint de depuración del catálogo. Expone el conteo de vehículos,
// si se está usando Supabase y los detalles de la tabla detectada.
vehicleRoutes.get("/admin/catalog-debug", isAuth, VehiclesController.debug);

export default vehicleRoutes;
