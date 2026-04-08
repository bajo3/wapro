import { Router } from "express";
import isAuth from "../middleware/isAuth";
import AppError from "../errors/AppError";
import { forwardBotAdmin } from "../services/BotServices/forwardBotAdmin";

async function forward(req: any, path: string, query?: Record<string, string | number | boolean | undefined>) {
  return forwardBotAdmin({
    path,
    method: req.method,
    body: req.body,
    query,
    context: "botIntelligenceRoutes"
  });
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
  const r = await forward(req, "/admin/intelligence/decisions", {
    limit: req.query.limit ? String(req.query.limit) : undefined
  });
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
  const r = await forward(req, "/admin/learning/captures", {
    status: req.query.status ? String(req.query.status) : undefined,
    limit: req.query.limit ? String(req.query.limit) : undefined,
    offset: req.query.offset ? String(req.query.offset) : undefined,
    intent: req.query.intent ? String(req.query.intent) : undefined
  });
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
  const r = await forward(req, "/admin/learning/examples/preview", {
    intent: req.query.intent ? String(req.query.intent) : undefined,
    max: req.query.max ? String(req.query.max) : undefined
  });
  return res.status(r.status).json(r.data);
});

// ─── Memoria Incremental de Patrones ─────────────────────────────────────────

// Listar patrones de memoria
botIntelligenceRoutes.get("/bot/learning/memory", async (req, res) => {
  const r = await forward(req, "/admin/learning/memory", {
    type: req.query.type ? String(req.query.type) : undefined,
    status: req.query.status ? String(req.query.status) : undefined,
    limit: req.query.limit ? String(req.query.limit) : undefined,
    offset: req.query.offset ? String(req.query.offset) : undefined
  });
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
  const r = await forward(req, "/admin/trace", {
    limit: req.query.limit ? String(req.query.limit) : undefined,
    remoteJid: req.query.remoteJid ? String(req.query.remoteJid) : undefined,
    onlyBlocked: req.query.onlyBlocked ? String(req.query.onlyBlocked) : undefined
  });
  return res.status(r.status).json(r.data);
});

botIntelligenceRoutes.get("/bot/trace/:messageId", async (req, res) => {
  const r = await forward(req, `/admin/trace/${encodeURIComponent(req.params.messageId)}`);
  return res.status(r.status).json(r.data);
});

// ─── Fase 5: Métricas ─────────────────────────────────────────────────────────

botIntelligenceRoutes.get("/bot/metrics/summary", async (req, res) => {
  const r = await forward(req, "/admin/metrics/summary", {
    windowHours: req.query.windowHours ? String(req.query.windowHours) : undefined
  });
  return res.status(r.status).json(r.data);
});

botIntelligenceRoutes.get("/bot/metrics/timeseries", async (req, res) => {
  const r = await forward(req, "/admin/metrics/timeseries", {
    hours: req.query.hours ? String(req.query.hours) : undefined
  });
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
  const r = await forward(req, "/admin/eval/runs", {
    limit: req.query.limit ? String(req.query.limit) : undefined
  });
  return res.status(r.status).json(r.data);
});

botIntelligenceRoutes.post("/bot/eval/run", async (req, res) => {
  const r = await forward(req, "/admin/eval/run");
  return res.status(r.status).json(r.data);
});

export default botIntelligenceRoutes;
