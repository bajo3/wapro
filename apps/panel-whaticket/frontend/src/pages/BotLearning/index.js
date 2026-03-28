/**
 * BotLearning — Panel de revisión del Sistema de Aprendizaje Incremental
 *
 * Permite a los operadores:
 *  1. Ver estadísticas del sistema de aprendizaje
 *  2. Revisar capturas de conversaciones recientes
 *  3. Calificar respuestas del bot (-1 / 0 / 1 / 2)
 *  4. Corregir respuestas incorrectas
 *  5. Promover buenas capturas a bot_examples
 *  6. Previsualizar ejemplos few-shot actuales
 *
 * APIs: /bot/learning/stats | /captures | /feedback | /promote | /examples/preview
 */

import React, { useCallback, useEffect, useState } from "react";
import { toast } from "react-toastify";
import api from "../../services/api";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtTime(iso) {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    const now = new Date();
    const diff = Math.floor((now - d) / 1000);
    if (diff < 60)    return "hace un momento";
    if (diff < 3600)  return `hace ${Math.floor(diff / 60)} min`;
    if (diff < 86400) return `hace ${Math.floor(diff / 3600)} h`;
    return d.toLocaleDateString("es-AR");
  } catch { return iso; }
}

function scoreColor(score) {
  const s = Number(score ?? 0);
  if (s >= 0.80) return "#22c55e";
  if (s >= 0.60) return "#f59e0b";
  if (s >= 0.40) return "#f97316";
  return "#ef4444";
}

function statusBadge(status) {
  const map = {
    approved: { bg: "#dcfce7", color: "#166534", label: "Aprobado" },
    pending:  { bg: "#fef3c7", color: "#92400e", label: "Pendiente" },
    rejected: { bg: "#fee2e2", color: "#991b1b", label: "Rechazado" },
    flagged:  { bg: "#fde8d8", color: "#9a3412", label: "Con error" },
  };
  const s = map[status] ?? { bg: "#f3f4f6", color: "#374151", label: status };
  return (
    <span style={{
      background: s.bg, color: s.color,
      borderRadius: 6, padding: "2px 8px", fontSize: 11, fontWeight: 600
    }}>{s.label}</span>
  );
}

function sourceChip(source) {
  const map = {
    playbook: { bg: "#ede9fe", color: "#5b21b6", label: "Playbook" },
    faq:      { bg: "#dbeafe", color: "#1e40af", label: "FAQ" },
    agent:    { bg: "#d1fae5", color: "#065f46", label: "Agente" },
    gpt:      { bg: "#fef3c7", color: "#78350f", label: "GPT" },
    fallback: { bg: "#fee2e2", color: "#7f1d1d", label: "Fallback" },
  };
  const s = map[source] ?? { bg: "#f3f4f6", color: "#374151", label: source ?? "?" };
  return (
    <span style={{
      background: s.bg, color: s.color,
      borderRadius: 5, padding: "1px 7px", fontSize: 11, fontWeight: 500
    }}>{s.label}</span>
  );
}

// ─── Componente de rating (thumbs) ────────────────────────────────────────────

function RatingButtons({ captureId, currentRating, reviewer, onDone }) {
  const [loading, setLoading] = useState(false);
  const [corrected, setCorrected] = useState("");
  const [showCorrect, setShowCorrect] = useState(false);

  const rate = useCallback(async (rating) => {
    setLoading(true);
    try {
      await api.post("/bot/learning/feedback", {
        capture_id: captureId,
        reviewer: reviewer || "panel",
        rating,
        corrected_response: corrected || undefined
      });
      toast.success(rating >= 1 ? "✅ Marcado como bueno" : "⚠️ Marcado como malo");
      onDone?.();
    } catch {
      toast.error("Error al guardar feedback");
    } finally {
      setLoading(false);
      setShowCorrect(false);
    }
  }, [captureId, reviewer, corrected, onDone]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <button
          disabled={loading}
          title="Excelente respuesta"
          onClick={() => rate(2)}
          style={{ ...btnStyle, background: currentRating === 2 ? "#bbf7d0" : "#f0fdf4", border: "1px solid #86efac" }}
        >⭐ Excelente</button>
        <button
          disabled={loading}
          title="Buena respuesta"
          onClick={() => rate(1)}
          style={{ ...btnStyle, background: currentRating === 1 ? "#d1fae5" : "#f0fdf4", border: "1px solid #6ee7b7" }}
        >👍 Buena</button>
        <button
          disabled={loading}
          title="Corregir y aprobar"
          onClick={() => setShowCorrect(v => !v)}
          style={{ ...btnStyle, background: "#fff7ed", border: "1px solid #fed7aa" }}
        >✏️ Corregir</button>
        <button
          disabled={loading}
          title="Mala respuesta"
          onClick={() => rate(-1)}
          style={{ ...btnStyle, background: currentRating === -1 ? "#fee2e2" : "#fff1f2", border: "1px solid #fca5a5" }}
        >👎 Mala</button>
      </div>
      {showCorrect && (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <textarea
            value={corrected}
            onChange={e => setCorrected(e.target.value)}
            placeholder="Escribí la respuesta ideal..."
            rows={3}
            style={{ width: "100%", padding: "6px 8px", borderRadius: 6, border: "1px solid #d1d5db", fontSize: 12, resize: "vertical" }}
          />
          <button
            disabled={loading || !corrected.trim()}
            onClick={() => rate(1)}
            style={{ ...btnStyle, background: "#dbeafe", border: "1px solid #93c5fd", alignSelf: "flex-start" }}
          >💾 Guardar corrección</button>
        </div>
      )}
    </div>
  );
}

const btnStyle = {
  padding: "4px 10px", borderRadius: 6, fontSize: 12,
  cursor: "pointer", fontWeight: 500, whiteSpace: "nowrap"
};

// ─── Card de captura ──────────────────────────────────────────────────────────

function CaptureCard({ capture, reviewer, onRefresh }) {
  const [expanded, setExpanded] = useState(false);
  const [promoting, setPromoting] = useState(false);

  const promote = useCallback(async () => {
    setPromoting(true);
    try {
      await api.post(`/bot/learning/promote/${capture.id}`, { promoted_by: reviewer });
      toast.success("🚀 Promovido a bot_examples");
      onRefresh?.();
    } catch {
      toast.error("Error al promover");
    } finally {
      setPromoting(false);
    }
  }, [capture.id, reviewer, onRefresh]);

  const effectiveScore = capture.human_rating != null
    ? [null, 0.05, 0.5, 0.80, 0.95][capture.human_rating + 1]
    : Number(capture.auto_score ?? 0.5);

  return (
    <div style={{
      background: "#fff",
      border: "1px solid #e5e7eb",
      borderRadius: 10,
      padding: "12px 16px",
      marginBottom: 10,
      boxShadow: "0 1px 3px rgba(0,0,0,0.05)"
    }}>
      {/* Cabecera */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          {statusBadge(capture.status)}
          {sourceChip(capture.source_type)}
          {capture.intent && (
            <span style={{ fontSize: 11, color: "#6b7280", background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: 5, padding: "1px 6px" }}>
              {capture.intent}
            </span>
          )}
          {capture.outcome_signal && (
            <span style={{ fontSize: 11, color: "#065f46", background: "#d1fae5", borderRadius: 5, padding: "1px 6px" }}>
              ✓ {capture.outcome_signal}
            </span>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 11, color: "#9ca3af" }}>{fmtTime(capture.created_at)}</span>
          <span style={{
            fontWeight: 700, fontSize: 13,
            color: scoreColor(effectiveScore)
          }}>{Math.round(effectiveScore * 100)}%</span>
        </div>
      </div>

      {/* Mensaje del cliente */}
      <div style={{ marginBottom: 6 }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: "#6b7280", textTransform: "uppercase", letterSpacing: 0.5 }}>Cliente</span>
        <div style={{ fontSize: 13, color: "#111827", marginTop: 2, background: "#f9fafb", borderRadius: 6, padding: "6px 10px" }}>
          {capture.user_message}
        </div>
      </div>

      {/* Respuesta del bot */}
      <div style={{ marginBottom: 10 }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: "#6b7280", textTransform: "uppercase", letterSpacing: 0.5 }}>Bot</span>
        <div style={{
          fontSize: 13, color: "#1f2937", marginTop: 2,
          background: "#f0fdf4", borderRadius: 6, padding: "6px 10px",
          whiteSpace: "pre-wrap",
          maxHeight: expanded ? "none" : 80,
          overflow: expanded ? "visible" : "hidden"
        }}>
          {capture.bot_response}
        </div>
        {capture.bot_response?.length > 200 && (
          <button
            onClick={() => setExpanded(v => !v)}
            style={{ fontSize: 11, color: "#6366f1", background: "none", border: "none", cursor: "pointer", padding: "2px 0" }}
          >{expanded ? "Ver menos" : "Ver completo"}</button>
        )}
      </div>

      {/* Acciones */}
      {capture.status !== "rejected" && !capture.promoted_to_example_id && (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 8, flexWrap: "wrap" }}>
          <RatingButtons
            captureId={capture.id}
            currentRating={capture.human_rating}
            reviewer={reviewer}
            onDone={onRefresh}
          />
          {capture.status === "approved" && (
            <button
              disabled={promoting}
              onClick={promote}
              style={{ ...btnStyle, background: "#e0e7ff", border: "1px solid #a5b4fc", color: "#3730a3" }}
            >🚀 Promover a ejemplos</button>
          )}
        </div>
      )}
      {capture.promoted_to_example_id && (
        <div style={{ fontSize: 11, color: "#6366f1", fontWeight: 600 }}>
          ✅ Promovido a bot_examples #{capture.promoted_to_example_id}
        </div>
      )}
    </div>
  );
}

// ─── Panel de estadísticas ────────────────────────────────────────────────────

function StatsPanel({ stats }) {
  if (!stats) return null;

  const cards = [
    { label: "Total capturas", value: stats.total_captures ?? 0, color: "#6366f1" },
    { label: "Aprobadas",      value: stats.approved ?? 0,       color: "#22c55e" },
    { label: "Pendientes",     value: stats.pending ?? 0,        color: "#f59e0b" },
    { label: "Con feedback",   value: stats.has_human_feedback ?? 0, color: "#3b82f6" },
    { label: "Score promedio", value: stats.avg_auto_score ? `${Math.round(stats.avg_auto_score * 100)}%` : "-", color: "#8b5cf6" },
    { label: "Promovidas",     value: stats.promoted ?? 0,       color: "#ec4899" },
    { label: "Con outcome",    value: stats.has_outcome ?? 0,    color: "#14b8a6" },
    { label: "Con errores",    value: stats.errors ?? 0,         color: "#ef4444" },
  ];

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))", gap: 10, marginBottom: 20 }}>
      {cards.map(c => (
        <div key={c.label} style={{
          background: "#fff", border: "1px solid #e5e7eb",
          borderRadius: 10, padding: "12px 14px", textAlign: "center",
          boxShadow: "0 1px 3px rgba(0,0,0,0.04)"
        }}>
          <div style={{ fontSize: 22, fontWeight: 700, color: c.color }}>{c.value}</div>
          <div style={{ fontSize: 11, color: "#6b7280", marginTop: 2 }}>{c.label}</div>
        </div>
      ))}
    </div>
  );
}

// ─── Preview few-shot ─────────────────────────────────────────────────────────

function FewShotPreview() {
  const [block, setBlock] = useState("");
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [intent, setIntent] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = intent ? `?intent=${encodeURIComponent(intent)}` : "";
      const { data } = await api.get(`/bot/learning/examples/preview${qs}`);
      setBlock(data.block ?? "");
      setCount(data.count ?? 0);
    } catch {
      toast.error("Error cargando preview");
    } finally {
      setLoading(false);
    }
  }, [intent]);

  return (
    <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, padding: "16px 18px", marginBottom: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: "#111827" }}>
          🔍 Preview ejemplos few-shot dinámicos
        </h3>
        <span style={{ fontSize: 12, color: "#6b7280" }}>{count} ejemplos cargados</span>
      </div>
      <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
        <input
          value={intent}
          onChange={e => setIntent(e.target.value)}
          placeholder="Filtrar por intent (ej: compra_directa)"
          style={{ flex: 1, padding: "6px 10px", borderRadius: 6, border: "1px solid #d1d5db", fontSize: 12 }}
        />
        <button
          onClick={load}
          disabled={loading}
          style={{ padding: "6px 14px", borderRadius: 6, background: "#6366f1", color: "#fff", fontSize: 12, fontWeight: 600, border: "none", cursor: "pointer" }}
        >{loading ? "Cargando..." : "Ver ejemplos"}</button>
      </div>
      {block && (
        <pre style={{
          background: "#f8fafc", border: "1px solid #e2e8f0",
          borderRadius: 6, padding: "10px 12px", fontSize: 11,
          color: "#1e293b", whiteSpace: "pre-wrap", maxHeight: 300, overflow: "auto"
        }}>{block}</pre>
      )}
    </div>
  );
}

// ─── Página principal ─────────────────────────────────────────────────────────

const FILTERS = [
  { value: "all",      label: "Todas" },
  { value: "pending",  label: "Pendientes" },
  { value: "approved", label: "Aprobadas" },
  { value: "rejected", label: "Rechazadas" },
  { value: "flagged",  label: "Con errores" },
];

export default function BotLearning() {
  const [stats, setStats]         = useState(null);
  const [captures, setCaptures]   = useState([]);
  const [total, setTotal]         = useState(0);
  const [loading, setLoading]     = useState(false);
  const [filterStatus, setFilter] = useState("pending");
  const [intentFilter, setIntent] = useState("");
  const [page, setPage]           = useState(0);
  const limit = 20;

  // Obtener reviewer del localStorage (compatibilidad con el panel)
  const reviewer = (() => {
    try {
      const u = JSON.parse(localStorage.getItem("user") ?? "{}");
      return u?.email || u?.name || "operador";
    } catch { return "operador"; }
  })();

  const loadStats = useCallback(async () => {
    try {
      const { data } = await api.get("/bot/learning/stats");
      setStats(data.stats ?? null);
    } catch { /* silencioso */ }
  }, []);

  const loadCaptures = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        status: filterStatus,
        limit:  String(limit),
        offset: String(page * limit)
      });
      if (intentFilter.trim()) params.set("intent", intentFilter.trim());
      const { data } = await api.get(`/bot/learning/captures?${params.toString()}`);
      setCaptures(data.rows ?? []);
      setTotal(data.total ?? 0);
    } catch {
      toast.error("Error cargando capturas");
    } finally {
      setLoading(false);
    }
  }, [filterStatus, page, intentFilter]);

  useEffect(() => { loadStats(); }, [loadStats]);
  useEffect(() => { loadCaptures(); }, [loadCaptures]);

  const onRefresh = useCallback(() => {
    loadStats();
    loadCaptures();
  }, [loadStats, loadCaptures]);

  const totalPages = Math.ceil(total / limit);

  return (
    <div style={{ padding: "24px 28px", maxWidth: 900, margin: "0 auto", fontFamily: "system-ui, sans-serif" }}>

      {/* Título */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: "#111827" }}>
            🧠 Sistema de Aprendizaje
          </h1>
          <p style={{ margin: "4px 0 0", fontSize: 13, color: "#6b7280" }}>
            Revisá conversaciones reales y enseñale al bot qué es una buena respuesta.
          </p>
        </div>
        <button
          onClick={onRefresh}
          style={{ padding: "6px 14px", borderRadius: 8, background: "#f3f4f6", border: "1px solid #d1d5db", fontSize: 12, cursor: "pointer" }}
        >↻ Actualizar</button>
      </div>

      {/* Stats */}
      <StatsPanel stats={stats} />

      {/* Few-shot preview */}
      <FewShotPreview />

      {/* Filtros */}
      <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap", alignItems: "center" }}>
        {FILTERS.map(f => (
          <button
            key={f.value}
            onClick={() => { setFilter(f.value); setPage(0); }}
            style={{
              padding: "5px 12px", borderRadius: 20, fontSize: 12, fontWeight: 600,
              cursor: "pointer", border: "1px solid",
              background: filterStatus === f.value ? "#6366f1" : "#f9fafb",
              color: filterStatus === f.value ? "#fff" : "#374151",
              borderColor: filterStatus === f.value ? "#6366f1" : "#d1d5db"
            }}
          >{f.label}</button>
        ))}
        <input
          value={intentFilter}
          onChange={e => { setIntent(e.target.value); setPage(0); }}
          placeholder="Filtrar por intent..."
          style={{ padding: "5px 10px", borderRadius: 6, border: "1px solid #d1d5db", fontSize: 12, width: 160 }}
        />
        <span style={{ fontSize: 12, color: "#9ca3af", marginLeft: "auto" }}>
          {total} capturas
        </span>
      </div>

      {/* Lista de capturas */}
      {loading ? (
        <div style={{ textAlign: "center", padding: 40, color: "#9ca3af" }}>Cargando capturas...</div>
      ) : captures.length === 0 ? (
        <div style={{ textAlign: "center", padding: 40, color: "#9ca3af" }}>
          {filterStatus === "pending"
            ? "No hay capturas pendientes de revisión. El sistema captura automáticamente cada respuesta del bot."
            : "No hay capturas con este filtro."}
        </div>
      ) : (
        captures.map(capture => (
          <CaptureCard
            key={capture.id}
            capture={capture}
            reviewer={reviewer}
            onRefresh={onRefresh}
          />
        ))
      )}

      {/* Paginación */}
      {totalPages > 1 && (
        <div style={{ display: "flex", justifyContent: "center", gap: 8, marginTop: 16 }}>
          <button
            disabled={page === 0}
            onClick={() => setPage(p => p - 1)}
            style={{ ...btnStyle, background: "#f9fafb", border: "1px solid #d1d5db" }}
          >← Anterior</button>
          <span style={{ fontSize: 13, color: "#6b7280", padding: "4px 8px" }}>
            {page + 1} / {totalPages}
          </span>
          <button
            disabled={page >= totalPages - 1}
            onClick={() => setPage(p => p + 1)}
            style={{ ...btnStyle, background: "#f9fafb", border: "1px solid #d1d5db" }}
          >Siguiente →</button>
        </div>
      )}

      {/* Info al pie */}
      <div style={{
        marginTop: 24, padding: "12px 16px", background: "#f8fafc",
        borderRadius: 8, border: "1px solid #e2e8f0", fontSize: 12, color: "#64748b"
      }}>
        <strong>¿Cómo funciona?</strong> El bot captura automáticamente cada conversación.
        Calificá las respuestas: <strong>⭐ Excelente / 👍 Buena</strong> las aprueba para few-shot dinámico.
        <strong> 👎 Mala</strong> las descarta. Las aprobadas se inyectan automáticamente al agente
        para mejorar respuestas futuras similares.
      </div>
    </div>
  );
}
