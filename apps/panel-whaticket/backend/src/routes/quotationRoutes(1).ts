import express from "express";
import isAuth from "../middleware/isAuth";

import * as QuotationsController from "../controllers/QuotationsController";

const quotationRoutes = express.Router();

quotationRoutes.get("/quotations", isAuth, QuotationsController.index);
quotationRoutes.get("/quotations/:id", isAuth, QuotationsController.show);
quotationRoutes.post("/quotations", isAuth, QuotationsController.create);
quotationRoutes.put("/quotations/:id", isAuth, QuotationsController.update);
quotationRoutes.delete("/quotations/:id", isAuth, QuotationsController.remove);
quotationRoutes.post("/quotations/:id/send", isAuth, QuotationsController.send);

export default quotationRoutes;
