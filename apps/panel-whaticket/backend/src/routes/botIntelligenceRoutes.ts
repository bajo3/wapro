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

// ─── Sistema de Aprendizaje Incremental ──────────────────────────────────────

// Estadísticas del sistema de aprendizaje
botIntelligenceRoutes.get("/bot/learning/stats", async (req, res) => {
  const r = await forward(req, "/admin/learning/stats");
  return res.status(r.status).json(r.data);
});

// Listar capturas de conversación para revisión
botIntelligenceRoutes.get("/bot/learning/captures", async (req, res) => {
  const params = new URLSearchParams();
  if (req.query.status) params.set("status", String(req.query.status));
  if (req.query.limit)  params.set("limit",  String(req.query.limit));
  if (req.query.offset) params.set("offset", String(req.query.offset));
  if (req.query.intent) params.set("intent", String(req.query.intent));
  const qs = params.toString() ? `?${params.toString()}` : "";
  const r = await forward(req, `/admin/learning/captures${qs}`);
  return res.status(r.status).json(r.data);
});

// Captura individual con feedback
botIntelligenceRoutes.get("/bot/learning/captures/:id", async (req, res) => {
  const r = await forward(req, `/admin/learning/captures/${encodeURIComponent(req.params.id)}`);
  return res.status(r.status).json(r.data);
});

// Registrar feedback humano
botIntelligenceRoutes.post("/bot/learning/feedback", async (req, res) => {
  const r = await forward(req, "/admin/learning/feedback");
  return res.status(r.status).json(r.data);
});

// Promover captura a bot_examples
botIntelligenceRoutes.post("/bot/learning/promote/:id", async (req, res) => {
  const r = await forward(req, `/admin/learning/promote/${encodeURIComponent(req.params.id)}`);
  return res.status(r.status).json(r.data);
});

// Registrar señal de outcome comercial
botIntelligenceRoutes.post("/bot/learning/outcome", async (req, res) => {
  const r = await forward(req, "/admin/learning/outcome");
  return res.status(r.status).json(r.data);
});

// Marcar error en captura
botIntelligenceRoutes.post("/bot/learning/flag/:id", async (req, res) => {
  const r = await forward(req, `/admin/learning/flag/${encodeURIComponent(req.params.id)}`);
  return res.status(r.status).json(r.data);
});

// Previsualizar ejemplos few-shot dinámicos
botIntelligenceRoutes.get("/bot/learning/examples/preview", async (req, res) => {
  const params = new URLSearchParams();
  if (req.query.intent) params.set("intent", String(req.query.intent));
  if (req.query.max)    params.set("max",    String(req.query.max));
  const qs = params.toString() ? `?${params.toString()}` : "";
  const r = await forward(req, `/admin/learning/examples/preview${qs}`);
  return res.status(r.status).json(r.data);
});

// ─── Memoria Incremental de Patrones ─────────────────────────────────────────

// Listar patrones de memoria
botIntelligenceRoutes.get("/bot/learning/memory", async (req, res) => {
  const params = new URLSearchParams();
  if (req.query.type)   params.set("type",   String(req.query.type));
  if (req.query.status) params.set("status", String(req.query.status));
  if (req.query.limit)  params.set("limit",  String(req.query.limit));
  if (req.query.offset) params.set("offset", String(req.query.offset));
  const qs = params.toString() ? `?${params.toString()}` : "";
  const r = await forward(req, `/admin/learning/memory${qs}`);
  return res.status(r.status).json(r.data);
});

// Resumen por tipo de patrón
botIntelligenceRoutes.get("/bot/learning/memory/summary", async (req, res) => {
  const r = await forward(req, "/admin/learning/memory/summary");
  return res.status(r.status).json(r.data);
});

// Actualizar estado/nota de un patrón
botIntelligenceRoutes.patch("/bot/learning/memory/:id", async (req, res) => {
  const r = await forward(req, `/admin/learning/memory/${encodeURIComponent(req.params.id)}`);
  return res.status(r.status).json(r.data);
});

// Disparar extracción manual de patrones
botIntelligenceRoutes.post("/bot/learning/memory/extract", async (req, res) => {
  const r = await forward(req, "/admin/learning/memory/extract");
  return res.status(r.status).json(r.data);
});

// Registrar patrón manualmente
botIntelligenceRoutes.post("/bot/learning/memory", async (req, res) => {
  const r = await forward(req, "/admin/learning/memory");
  return res.status(r.status).json(r.data);
});

// ─── Fase 5: Trazabilidad ─────────────────────────────────────────────────────

botIntelligenceRoutes.get("/bot/trace", async (req, res) => {
  const params = new URLSearchParams();
  if (req.query.limit) params.set("limit", String(req.query.limit));
  if (req.query.remoteJid) params.set("remoteJid", String(req.query.remoteJid));
  if (req.query.onlyBlocked) params.set("onlyBlocked", String(req.query.onlyBlocked));
  const qs = params.toString() ? `?${params.toString()}` : "";
  const r = await forward(req, `/admin/trace${qs}`);
  return res.status(r.status).json(r.data);
});

botIntelligenceRoutes.get("/bot/trace/:messageId", async (req, res) => {
  const r = await forward(req, `/admin/trace/${encodeURIComponent(req.params.messageId)}`);
  return res.status(r.status).json(r.data);
});

// ─── Fase 5: Métricas ─────────────────────────────────────────────────────────

botIntelligenceRoutes.get("/bot/metrics/summary", async (req, res) => {
  const qs = req.query.windowHours ? `?windowHours=${encodeURIComponent(String(req.query.windowHours))}` : "";
  const r = await forward(req, `/admin/metrics/summary${qs}`);
  return res.status(r.status).json(r.data);
});

botIntelligenceRoutes.get("/bot/metrics/timeseries", async (req, res) => {
  const qs = req.query.hours ? `?hours=${encodeURIComponent(String(req.query.hours))}` : "";
  const r = await forward(req, `/admin/metrics/timeseries${qs}`);
  return res.status(r.status).json(r.data);
});

botIntelligenceRoutes.get("/bot/metrics/alerts", async (req, res) => {
  const r = await forward(req, "/admin/metrics/alerts");
  return res.status(r.status).json(r.data);
});

botIntelligenceRoutes.post("/bot/metrics/alerts/:id/resolve", async (req, res) => {
  const r = await forward(req, `/admin/metrics/alerts/${encodeURIComponent(req.params.id)}/resolve`);
  return res.status(r.status).json(r.data);
});

// ─── Fase 5: Health check ─────────────────────────────────────────────────────

botIntelligenceRoutes.get("/bot/health/bot", async (req, res) => {
  const r = await forward(req, "/admin/health/bot");
  return res.status(r.status).json(r.data);
});

// ─── Fase 5: Evaluaciones ─────────────────────────────────────────────────────

botIntelligenceRoutes.get("/bot/eval/runs", async (req, res) => {
  const qs = req.query.limit ? `?limit=${encodeURIComponent(String(req.query.limit))}` : "";
  const r = await forward(req, `/admin/eval/runs${qs}`);
  return res.status(r.status).json(r.data);
});

botIntelligenceRoutes.post("/bot/eval/run", async (req, res) => {
  const r = await forward(req, "/admin/eval/run");
  return res.status(r.status).json(r.data);
});

export default botIntelligenceRoutes;
