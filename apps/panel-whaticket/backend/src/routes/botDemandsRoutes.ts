import { Router } from "express";
import isAuth from "../middleware/isAuth";
import AppError from "../errors/AppError";
import { forwardBotAdmin } from "../services/BotServices/forwardBotAdmin";

function normalizeListPayload(data: any) {
  if (Array.isArray(data)) return { demands: data };
  if (data && Array.isArray(data.demands)) return data;
  return { demands: [] };
}

function normalizeMatchesPayload(data: any) {
  if (Array.isArray(data)) return { matches: data };
  if (data && Array.isArray(data.matches)) return data;
  return { matches: [] };
}

function normalizeRecontactsPayload(data: any) {
  if (Array.isArray(data)) return { recontacts: data };
  if (data && Array.isArray(data.recontacts)) return data;
  return { recontacts: [] };
}

async function forwardCompat(
  req: any,
  paths: string[],
  query?: Record<string, string | number | boolean | undefined>,
  method?: string
) {
  let lastResponse: any = null;

  for (const path of paths) {
    const response = await forwardBotAdmin({
      path,
      method: method ?? req.method,
      body: req.body,
      query,
      context: "botDemandsRoutes"
    });

    if (response.status !== 404) return response;
    lastResponse = response;
  }

  return lastResponse;
}

const botDemandsRoutes = Router();

botDemandsRoutes.use(isAuth);
botDemandsRoutes.use((req, _res, next) => {
  if (req.user?.profile !== "admin") {
    throw new AppError("ERR_NO_PERMISSION", 403);
  }
  return next();
});

// List demands
botDemandsRoutes.get("/bot/demands", async (req, res) => {
  const r = await forwardCompat(req, ["/admin/demands", "/admin/vehicle-demands"], {
    status: String(req.query.status ?? "open"),
    limit: String(req.query.limit ?? "100")
  });
  return res.status(r.status).json(normalizeListPayload(r.data));
});

// Create demand
botDemandsRoutes.post("/bot/demands", async (req, res) => {
  const r = await forwardCompat(req, ["/admin/demands", "/admin/vehicle-demands"]);
  return res.status(r.status).json(r.data);
});

// Update demand
botDemandsRoutes.put("/bot/demands/:id", async (req, res) => {
  const id = encodeURIComponent(String(req.params.id));
  const r = await forwardCompat(req, [`/admin/demands/${id}`, `/admin/vehicle-demands/${id}`], undefined, "PATCH");
  return res.status(r.status).json(r.data);
});

// Close demand
botDemandsRoutes.post("/bot/demands/:id/close", async (req, res) => {
  const id = encodeURIComponent(String(req.params.id));
  const r = await forwardCompat(req, [`/admin/demands/${id}/close`, `/admin/vehicle-demands/${id}/close`]);
  return res.status(r.status).json(r.data);
});

// Matches
botDemandsRoutes.get("/bot/demands/:id/matches", async (req, res) => {
  const id = encodeURIComponent(String(req.params.id));
  const r = await forwardCompat(req, [`/admin/demands/${id}/matches`, `/admin/vehicle-demands/${id}/matches`], {
    limit: String(req.query.limit ?? "20")
  });
  return res.status(r.status).json(normalizeMatchesPayload(r.data));
});

// Recontact history
botDemandsRoutes.get("/bot/demands/:id/recontacts", async (req, res) => {
  const id = encodeURIComponent(String(req.params.id));
  const r = await forwardCompat(req, [`/admin/demands/${id}/recontacts`, `/admin/vehicle-demands/${id}/recontacts`], {
    limit: String(req.query.limit ?? "50")
  });
  return res.status(r.status).json(normalizeRecontactsPayload(r.data));
});

// Manual scan
botDemandsRoutes.post("/bot/demands/scan", async (req, res) => {
  const r = await forwardCompat(req, ["/admin/demands/scan", "/admin/vehicle-demands/scan"]);
  return res.status(r.status).json(r.data);
});

// Manual recontact run
botDemandsRoutes.post("/bot/demands/recontact/run", async (req, res) => {
  const r = await forwardCompat(req, ["/admin/demands/recontact", "/admin/vehicle-demands/recontact/run"]);
  return res.status(r.status).json(r.data);
});

export default botDemandsRoutes;
