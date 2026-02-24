import { Router } from "express";
import fetch from "node-fetch";
import isAuth from "../middleware/isAuth";
import AppError from "../errors/AppError";

const BOT_URL = String(process.env.BOT_URL || "").replace(/\/$/, "");
const BOT_ADMIN_TOKEN = String(process.env.BOT_ADMIN_TOKEN || "");

function ensureConfigured() {
  if (!BOT_URL || !BOT_ADMIN_TOKEN) {
    throw new AppError("ERR_BOT_NOT_CONFIGURED", 503);
  }
}

async function forward(req: any, path: string) {
  ensureConfigured();
  const url = `${BOT_URL}${path}`;
  const method = req.method;
  const body = method === "GET" || method === "HEAD" ? undefined : JSON.stringify(req.body ?? {});
  const timeoutMs = Number(process.env.BOT_HTTP_TIMEOUT_MS ?? "15000");
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), Math.max(1000, timeoutMs));

  let r: any;
  try {
    r = await fetch(url, {
      method,
      headers: {
        "content-type": "application/json",
        "x-admin-token": BOT_ADMIN_TOKEN
      } as any,
      body,
      signal: controller.signal as any
    } as any);
  } catch (err: any) {
    if (String(err?.name) === "AbortError") {
      throw new AppError("ERR_BOT_TIMEOUT", 504);
    }
    throw err;
  } finally {
    clearTimeout(t);
  }

  const text = await r.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: r.status, ok: r.ok, data };
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
  const status = String(req.query.status ?? "open");
  const limit = String(req.query.limit ?? "100");
  const r = await forward(req, `/admin/vehicle-demands?status=${encodeURIComponent(status)}&limit=${encodeURIComponent(limit)}`);
  return res.status(r.status).json(r.data);
});

// Create demand
botDemandsRoutes.post("/bot/demands", async (req, res) => {
  const r = await forward(req, "/admin/vehicle-demands");
  return res.status(r.status).json(r.data);
});

// Update demand
botDemandsRoutes.put("/bot/demands/:id", async (req, res) => {
  const id = encodeURIComponent(String(req.params.id));
  const r = await forward(req, `/admin/vehicle-demands/${id}`);
  return res.status(r.status).json(r.data);
});

// Close demand
botDemandsRoutes.post("/bot/demands/:id/close", async (req, res) => {
  const id = encodeURIComponent(String(req.params.id));
  const r = await forward(req, `/admin/vehicle-demands/${id}/close`);
  return res.status(r.status).json(r.data);
});

// Matches
botDemandsRoutes.get("/bot/demands/:id/matches", async (req, res) => {
  const id = encodeURIComponent(String(req.params.id));
  const limit = String(req.query.limit ?? "20");
  const r = await forward(req, `/admin/vehicle-demands/${id}/matches?limit=${encodeURIComponent(limit)}`);
  return res.status(r.status).json(r.data);
});

// Recontact history
botDemandsRoutes.get("/bot/demands/:id/recontacts", async (req, res) => {
  const id = encodeURIComponent(String(req.params.id));
  const limit = String(req.query.limit ?? "50");
  const r = await forward(req, `/admin/vehicle-demands/${id}/recontacts?limit=${encodeURIComponent(limit)}`);
  return res.status(r.status).json(r.data);
});

// Manual scan
botDemandsRoutes.post("/bot/demands/scan", async (req, res) => {
  const r = await forward(req, "/admin/vehicle-demands/scan");
  return res.status(r.status).json(r.data);
});

// Manual recontact run
botDemandsRoutes.post("/bot/demands/recontact/run", async (req, res) => {
  const r = await forward(req, "/admin/vehicle-demands/recontact/run");
  return res.status(r.status).json(r.data);
});

export default botDemandsRoutes;
