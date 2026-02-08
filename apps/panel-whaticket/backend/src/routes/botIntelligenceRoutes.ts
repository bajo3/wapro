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
  const r = await fetch(url, {
    method,
    headers: {
      "content-type": "application/json",
      "x-admin-token": BOT_ADMIN_TOKEN
    } as any,
    body
  });

  const text = await r.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: r.status, ok: r.ok, data };
}

const botIntelligenceRoutes = Router();

botIntelligenceRoutes.use(isAuth);

botIntelligenceRoutes.use((req, _res, next) => {
  if (req.user?.profile !== "admin") {
    throw new AppError("ERR_NO_PERMISSION", 403);
  }
  return next();
});

// Settings
botIntelligenceRoutes.get("/bot/intelligence/settings", async (req, res) => {
  const r = await forward(req, "/admin/intelligence/settings");
  return res.status(r.status).json(r.data);
});

// Policies
botIntelligenceRoutes.get("/bot/intelligence/policies", async (req, res) => {
  const r = await forward(req, "/admin/intelligence/policies");
  return res.status(r.status).json(r.data);
});

botIntelligenceRoutes.post("/bot/intelligence/policies", async (req, res) => {
  const r = await forward(req, "/admin/intelligence/policies");
  return res.status(r.status).json(r.data);
});

botIntelligenceRoutes.delete("/bot/intelligence/policies/:id", async (req, res) => {
  const r = await forward(req, `/admin/intelligence/policies/${encodeURIComponent(req.params.id)}`);
  return res.status(r.status).json(r.data);
});

botIntelligenceRoutes.put("/bot/intelligence/settings", async (req, res) => {
  const r = await forward(req, "/admin/intelligence/settings");
  return res.status(r.status).json(r.data);
});

// FAQs
botIntelligenceRoutes.get("/bot/intelligence/faqs", async (req, res) => {
  const r = await forward(req, "/admin/intelligence/faqs");
  return res.status(r.status).json(r.data);
});

botIntelligenceRoutes.post("/bot/intelligence/faqs", async (req, res) => {
  const r = await forward(req, "/admin/intelligence/faqs");
  return res.status(r.status).json(r.data);
});

botIntelligenceRoutes.delete("/bot/intelligence/faqs/:id", async (req, res) => {
  const r = await forward(req, `/admin/intelligence/faqs/${encodeURIComponent(req.params.id)}`);
  return res.status(r.status).json(r.data);
});

// Playbooks
botIntelligenceRoutes.get("/bot/intelligence/playbooks", async (req, res) => {
  const r = await forward(req, "/admin/intelligence/playbooks");
  return res.status(r.status).json(r.data);
});

botIntelligenceRoutes.post("/bot/intelligence/playbooks", async (req, res) => {
  const r = await forward(req, "/admin/intelligence/playbooks");
  return res.status(r.status).json(r.data);
});

botIntelligenceRoutes.delete("/bot/intelligence/playbooks/:id", async (req, res) => {
  const r = await forward(req, `/admin/intelligence/playbooks/${encodeURIComponent(req.params.id)}`);
  return res.status(r.status).json(r.data);
});

// Examples
botIntelligenceRoutes.get("/bot/intelligence/examples", async (req, res) => {
  const r = await forward(req, "/admin/intelligence/examples");
  return res.status(r.status).json(r.data);
});

botIntelligenceRoutes.post("/bot/intelligence/examples", async (req, res) => {
  const r = await forward(req, "/admin/intelligence/examples");
  return res.status(r.status).json(r.data);
});

botIntelligenceRoutes.delete("/bot/intelligence/examples/:id", async (req, res) => {
  const r = await forward(req, `/admin/intelligence/examples/${encodeURIComponent(req.params.id)}`);
  return res.status(r.status).json(r.data);
});

// Decisions
botIntelligenceRoutes.get("/bot/intelligence/decisions", async (req, res) => {
  const limit = req.query.limit ? `?limit=${encodeURIComponent(String(req.query.limit))}` : "";
  const r = await forward(req, `/admin/intelligence/decisions${limit}`);
  return res.status(r.status).json(r.data);
});

// Playground
botIntelligenceRoutes.post("/bot/playground/run", async (req, res) => {
  const r = await forward(req, "/admin/playground/run");
  return res.status(r.status).json(r.data);
});

// Tests
botIntelligenceRoutes.get("/bot/tests/cases", async (req, res) => {
  const r = await forward(req, "/admin/tests/cases");
  return res.status(r.status).json(r.data);
});

botIntelligenceRoutes.post("/bot/tests/cases", async (req, res) => {
  const r = await forward(req, "/admin/tests/cases");
  return res.status(r.status).json(r.data);
});

botIntelligenceRoutes.delete("/bot/tests/cases/:id", async (req, res) => {
  const r = await forward(req, `/admin/tests/cases/${encodeURIComponent(req.params.id)}`);
  return res.status(r.status).json(r.data);
});

botIntelligenceRoutes.post("/bot/tests/run", async (req, res) => {
  const r = await forward(req, "/admin/tests/run");
  return res.status(r.status).json(r.data);
});

export default botIntelligenceRoutes;
