/**
 * BotPanel.jsx — Panel del bot rediseñado
 *
 * Reemplaza: apps/panel-whaticket/frontend/src/pages/Bot/index.js
 *
 * APIs usadas (todas ya existentes en el backend):
 *   GET  /bot/intelligence/settings
 *   PUT  /bot/intelligence/settings
 *   GET  /bot/intelligence/policies
 *   POST /bot/intelligence/policies
 *   DEL  /bot/intelligence/policies/:id
 *   GET  /bot/intelligence/faqs
 *   POST /bot/intelligence/faqs
 *   DEL  /bot/intelligence/faqs/:id
 *   GET  /bot/intelligence/decisions   (actividad reciente)
 *   POST /bot/playground/run
 *   GET  /vehicles
 *
 * Dependencias: ya están en el proyecto (react-toastify, api service)
 * Estilos: Tailwind CSS (igual que LeadPanelAutos, TicketsAutos)
 */

import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useHistory } from "react-router-dom";
import { toast } from "react-toastify";
import api from "../../services/api";
import { AuthContext } from "../../context/Auth/AuthContext";

// ─── Utilidades ──────────────────────────────────────────────────────────────

function fmtTime(iso) {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    const now = new Date();
    const diff = Math.floor((now - d) / 1000);
    if (diff < 60) return "hace un momento";
    if (diff < 3600) return `hace ${Math.floor(diff / 60)} min`;
    if (diff < 86400) return `hace ${Math.floor(diff / 3600)} h`;
    return d.toLocaleDateString("es-AR");
  } catch {
    return "";
  }
}

function scoreColor(score) {
  if (score >= 70) return "#f59e0b";
  if (score >= 40) return "#3b82f6";
  return "#22c55e";
}

function normalizeVehicleLabel(v) {
  const label = String(v.label || "").trim();
  if (label) return label;
  const brand = String(v.marca || v.brand || "").trim();
  const model = String(v.modelo || v.model || "").trim();
  const version = String(v.version || "").trim();
  const title = String(v.title || "").trim();
  return [brand, model, version].filter(Boolean).join(" ").trim() || title || brand || "Vehículo";
}

function splitVehicleHeading(v) {
  const brand = String(v.marca || v.brand || "").trim();
  const model = String(v.modelo || v.model || "").trim();
  const version = String(v.version || "").trim();
  const title = String(v.title || "").trim();
  const label = normalizeVehicleLabel(v);

  let eyebrow = brand || (title ? title.split(/\s+/)[0] : "");
  let heading = label;
  let subheading = "";

  if (brand && heading.toLowerCase().startsWith(brand.toLowerCase())) {
    heading = heading;
  }
  if (version && heading.toLowerCase() !== `${brand} ${model} ${version}`.trim().toLowerCase()) {
    subheading = version;
  }

  return { eyebrow, heading, subheading };
}

function inferCurrencyLabel(v, amount) {
  const raw = String(v.currency || "").toUpperCase();
  if (raw === "USD" || raw === "US$") return "USD";
  if (raw === "ARS") return "ARS";
  return amount > 0 && amount < 1000000 ? "USD" : "ARS";
}

function actionBadge(action) {
  const map = {
    SHOW_RESULTS:      { label: "STOCK",    cls: "bg-blue-500/10 text-blue-400 border-blue-500/20" },
    SHOW_ONE:          { label: "STOCK",    cls: "bg-blue-500/10 text-blue-400 border-blue-500/20" },
    ESCALATE_HUMAN:    { label: "ESCALADO", cls: "bg-amber-500/10 text-amber-400 border-amber-500/20" },
    ASK_CLARIFY:       { label: "CALIFICANDO", cls: "bg-green-500/10 text-green-400 border-green-500/20" },
    OFFER_FINANCING:   { label: "FINANCIACIÓN", cls: "bg-purple-500/10 text-purple-400 border-purple-500/20" },
    OFFER_TRADEIN:     { label: "PERMUTA",  cls: "bg-teal-500/10 text-teal-400 border-teal-500/20" },
    FOLLOWUP:          { label: "SEGUIMIENTO", cls: "bg-gray-500/10 text-gray-400 border-gray-500/20" },
  };
  const b = map[action] || { label: action || "—", cls: "bg-gray-500/10 text-gray-400 border-gray-500/20" };
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold border ${b.cls}`}>
      {b.label}
    </span>
  );
}

// ─── Componentes pequeños ─────────────────────────────────────────────────────

function Toggle({ on, onChange, loading }) {
  return (
    <button
      onClick={() => !loading && onChange(!on)}
      className={`relative w-11 h-6 rounded-full border transition-all duration-200 flex-shrink-0
        ${on ? "bg-green-500 border-green-500" : "bg-white/5 border-white/10"}
        ${loading ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
    >
      <span
        className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-all duration-200
          ${on ? "left-[22px]" : "left-0.5"}`}
      />
    </button>
  );
}

function MetricCard({ label, value, change, changeType = "neutral" }) {
  const changeColors = {
    up:      "text-green-400",
    down:    "text-red-400",
    neutral: "text-white/30",
  };
  return (
    <div className="bg-white/[0.03] border border-white/[0.07] rounded-xl p-4">
      <div className="text-[11px] text-white/30 uppercase tracking-wider mb-1.5">{label}</div>
      <div className="text-2xl font-bold text-white tracking-tight">{value}</div>
      {change && (
        <div className={`text-[11px] mt-1 ${changeColors[changeType]}`}>{change}</div>
      )}
    </div>
  );
}

function SectionTitle({ children }) {
  return (
    <div className="text-[11px] font-semibold text-white/30 uppercase tracking-wider mb-3">
      {children}
    </div>
  );
}

// ─── Tab: Estado ──────────────────────────────────────────────────────────────

function TabEstado({ decisions, loadingDecisions }) {
  const escalados = decisions.filter(d => d.action === "ESCALATE_HUMAN").length;
  const calificados = decisions.filter(d => (d.leadScore || 0) >= 30).length;

  return (
    <div>
      <div className="grid grid-cols-4 gap-3 mb-6">
        <MetricCard label="Mensajes procesados" value={decisions.length || "—"} />
        <MetricCard label="Leads calificados" value={calificados || "—"} change={calificados ? `score ≥ 30` : undefined} changeType="up" />
        <MetricCard label="Escalados a humano" value={escalados || "—"} change={escalados ? "score ≥ 60" : undefined} changeType="neutral" />
        <MetricCard
          label="Tasa escalado"
          value={decisions.length ? `${Math.round((escalados / decisions.length) * 100)}%` : "—"}
        />
      </div>

      <SectionTitle>Actividad reciente</SectionTitle>

      {loadingDecisions ? (
        <div className="flex flex-col gap-2">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-14 bg-white/[0.03] rounded-xl animate-pulse" />
          ))}
        </div>
      ) : decisions.length === 0 ? (
        <div className="text-white/30 text-sm text-center py-8">
          Sin actividad todavía. El bot procesará mensajes cuando esté activo.
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {decisions.slice(0, 20).map((d, i) => (
            <div
              key={d.id || i}
              className="bg-white/[0.03] border border-white/[0.06] rounded-xl px-4 py-3 flex items-center gap-3"
            >
              <div className={`w-7 h-7 rounded-lg flex items-center justify-center text-sm flex-shrink-0
                ${d.action === "ESCALATE_HUMAN" ? "bg-amber-500/10 text-amber-400" :
                  d.action?.includes("SHOW") ? "bg-blue-500/10 text-blue-400" :
                  "bg-green-500/10 text-green-400"}`}>
                {d.action === "ESCALATE_HUMAN" ? "↑" : d.action?.includes("SHOW") ? "🚗" : "✓"}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-white truncate">
                  {d.contact || d.remoteJid || "Lead"}
                </div>
                <div className="text-[12px] text-white/40 mt-0.5 truncate">
                  {d.intent && <span className="mr-2">{d.intent}</span>}
                  {d.suggestedReply && `"${d.suggestedReply.slice(0, 60)}..."`}
                </div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                {actionBadge(d.action)}
                {d.leadScore != null && (
                  <span className="text-[11px] font-mono font-bold" style={{ color: scoreColor(d.leadScore) }}>
                    {d.leadScore}
                  </span>
                )}
                <span className="text-[11px] text-white/25">{fmtTime(d.createdAt)}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Tab: Stock ───────────────────────────────────────────────────────────────

function TabStock({ vehicles, loadingVehicles, onDelete }) {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState("");
  const [deletingId, setDeletingId] = useState(null);
  const [confirmId, setConfirmId] = useState(null);

  const handleDelete = async (id) => {
    setConfirmId(null);
    setDeletingId(id);
    try {
      await api.delete(`/vehicles/${id}`);
      toast.success("Vehículo eliminado del stock del bot");
      if (onDelete) onDelete();
    } catch {
      toast.error("No se pudo eliminar el vehículo");
    } finally {
      setDeletingId(null);
    }
  };

  const filtered = vehicles.filter(v => {
    const text = [v.label, v.title, v.marca || v.brand, v.modelo || v.model, v.version, v.year, v.combustible || v.fuel]
      .filter(Boolean).join(" ").toLowerCase();
    const matchQ = !q || text.includes(q.toLowerCase());
    const matchF = !filter ||
      (filter === "0km" && (Number(v.km) === 0 || Number(v.Km) === 0)) ||
      (filter === "usado" && Number(v.km || v.Km) > 0);
    return matchQ && matchF;
  });

  const disponibles = vehicles.filter(v => v.status !== "sold").length;
  const incompletos = vehicles.filter(v => !String(v.model || v.modelo || "").trim()).length;

  return (
    <div>
      <div className="flex gap-2 mb-4">
        <input
          className="flex-1 bg-white/[0.03] border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-white placeholder-white/25 outline-none focus:border-amber-500/50"
          placeholder="Buscar marca, modelo, año, combustible..."
          value={q}
          onChange={e => setQ(e.target.value)}
        />
        <select
          className="bg-white/[0.03] border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-white/60 outline-none cursor-pointer"
          value={filter}
          onChange={e => setFilter(e.target.value)}
        >
          <option value="">Todos</option>
          <option value="0km">0km</option>
          <option value="usado">Usados</option>
        </select>
      </div>

      <SectionTitle>
        Vehículos que el bot conoce ·{" "}
        <span className="text-green-400">{disponibles} disponibles</span>
        {incompletos > 0 && (
          <span className="ml-2 text-red-400" title="Vehículos con modelo faltante: el bot los conoce pero no los puede buscar bien por marca/modelo">
            · ⚠️ {incompletos} con datos incompletos
          </span>
        )}
      </SectionTitle>

      {loadingVehicles ? (
        <div className="grid grid-cols-3 gap-2">
          {[1,2,3,4,5,6].map(i => (
            <div key={i} className="h-28 bg-white/[0.03] rounded-xl animate-pulse" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-white/30 text-sm text-center py-8">
          {vehicles.length === 0
            ? "No hay vehículos en la base de datos. Verificá la tabla de stock."
            : "No hay resultados para esa búsqueda."}
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-2">
          {filtered.map((v, i) => {
            const kmValue = v.km ?? v.Km;
            const kmNum = Number(kmValue);
            const hasKm = Number.isFinite(kmNum) && kmNum >= 0;
            const es0km = hasKm && kmNum === 0;
            const precioRaw = v.precio || v.price;
            const precioNum = Number(String(precioRaw ?? "").replace(/[^0-9.]/g, ""));
            const currency = inferCurrencyLabel(v, precioNum);
            const { eyebrow, heading, subheading } = splitVehicleHeading(v);
            const year = v.year || "—";
            const trans = v.caja || v.transmission || v.Caja || "—";
            const fuel = v.combustible || v.fuel || v.Combustible || "—";
            // Detect incomplete data: no model field means the bot can't match this vehicle well
            const hasModel = String(v.model || v.modelo || "").trim().length > 0;
            const incompleto = !hasModel;
            const imageUrl = v.imageUrl || v.image || (Array.isArray(v.pictures) ? v.pictures[0] : null);
            const precioDisplay = precioRaw
              ? (Number.isFinite(precioNum) && precioNum > 0
                  ? precioNum.toLocaleString("es-AR")
                  : String(precioRaw))
              : null;

            return (
              <div
                key={v.id || i}
                className={`relative border rounded-xl overflow-hidden transition-colors
                  ${incompleto
                    ? "bg-red-500/[0.04] border-red-500/20"
                    : es0km
                      ? "bg-amber-500/[0.04] border-amber-500/20"
                      : "bg-white/[0.03] border-white/[0.06]"}`}
                title={incompleto ? "⚠️ Datos incompletos: falta modelo. El bot no puede matchear bien este vehículo." : undefined}
              >
                {/* Confirm delete overlay */}
                {confirmId === (v.id || i) && (
                  <div className="absolute inset-0 z-10 bg-black/80 flex flex-col items-center justify-center gap-3 p-4">
                    <p className="text-sm text-white text-center font-medium">¿Eliminar este vehículo del bot?</p>
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleDelete(v.id || i)}
                        disabled={deletingId === (v.id || i)}
                        className="px-3 py-1.5 rounded-lg bg-red-500 hover:bg-red-600 text-white text-xs font-semibold transition-colors"
                      >
                        {deletingId === (v.id || i) ? "Eliminando..." : "Sí, eliminar"}
                      </button>
                      <button
                        onClick={() => setConfirmId(null)}
                        className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white text-xs font-semibold transition-colors"
                      >
                        Cancelar
                      </button>
                    </div>
                  </div>
                )}
                {/* Delete button */}
                <button
                  onClick={() => setConfirmId(v.id || i)}
                  className="absolute top-2 right-2 z-10 w-6 h-6 flex items-center justify-center rounded-full bg-black/50 hover:bg-red-500/80 text-white/50 hover:text-white text-xs transition-colors"
                  title="Eliminar vehículo"
                >
                  ×
                </button>
                {imageUrl ? (
                  <div className="h-28 bg-white/[0.03] border-b border-white/[0.06] overflow-hidden">
                    <img src={imageUrl} alt={heading} className="w-full h-full object-cover" />
                  </div>
                ) : null}
                <div className="p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-[10px] text-white/30 uppercase tracking-wide truncate">{eyebrow || "Vehículo"}</div>
                      <div className="text-sm font-semibold text-white mt-0.5 leading-5">{heading}</div>
                      {subheading ? (
                        <div className="text-[11px] text-white/40 mt-0.5 line-clamp-1">{subheading}</div>
                      ) : null}
                    </div>
                    <span className={`text-[10px] font-bold px-2 py-1 rounded-md border ${
                      v.status === "sold"
                        ? "bg-white/5 text-white/45 border-white/10"
                        : v.status === "reserved"
                          ? "bg-amber-500/10 text-amber-300 border-amber-500/20"
                          : "bg-green-500/10 text-green-300 border-green-500/20"
                    }`}>
                      {v.status === "sold" ? "Vendido" : v.status === "reserved" ? "Reservado" : "Disponible"}
                    </span>
                  </div>
                  {incompleto && (
                    <div className="mt-1 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold bg-red-500/10 text-red-400 border border-red-500/20">
                      ⚠️ Modelo faltante
                    </div>
                  )}
                  <div className="text-[11px] text-white/40 mt-1">{year} · {trans} · {fuel}</div>
                  {precioDisplay && (
                    <div className="text-sm font-bold text-amber-400 mt-2">
                      {currency} {precioDisplay}
                    </div>
                  )}
                  <div className="flex items-center justify-between mt-2 gap-2">
                    <span className="text-[11px] text-white/30 truncate">
                      {hasKm ? (es0km ? "0 km" : `${kmNum.toLocaleString("es-AR")} km`) : "Km sin informar"}
                    </span>
                    {v.permalink ? (
                      <a href={v.permalink} target="_blank" rel="noreferrer" className="text-[11px] text-amber-400 hover:text-amber-300">
                        Ver publicación
                      </a>
                    ) : (
                      <div className={`w-1.5 h-1.5 rounded-full ${
                        v.status === "sold" ? "bg-white/20" :
                        v.status === "reserved" ? "bg-amber-400" : "bg-green-400"
                      }`} />
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Tab: Playground ──────────────────────────────────────────────────────────

function TabPlayground() {
  const [messages, setMessages] = useState([
    {
      role: "bot",
      text: "¡Hola! Soy el asistente de la concesionaria. ¿Estás buscando un auto 0km o usado? ¿Tenés alguna marca o modelo en mente?",
      time: "ahora",
    },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [decision, setDecision] = useState(null);
  const messagesEndRef = useRef(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const send = async () => {
    const text = input.trim();
    if (!text || loading) return;
    setInput("");
    setMessages(prev => [...prev, { role: "user", text, time: "ahora" }]);
    setLoading(true);

    try {
      // Armar historial para dar contexto al agente GPT
      const history = messages
        .filter(m => m.role === "user" || m.role === "bot")
        .slice(-8)
        .map(m => ({ role: m.role === "bot" ? "assistant" : "user", content: m.text }));
      const { data } = await api.post("/bot/playground/run", { text, state: { history } });
      const reply = data?.result?.suggestedReply || data?.result?.reply || data?.suggestedReply || data?.reply || "Sin respuesta del bot.";
      setMessages(prev => [...prev, { role: "bot", text: reply, time: "ahora" }]);
      if (data) setDecision(data?.result ?? data);
    } catch (err) {
      setMessages(prev => [...prev, {
        role: "bot",
        text: "Error al conectar con el bot. Verificá que BOT_URL esté configurada en .env.",
        time: "ahora",
        error: true,
      }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="grid grid-cols-[1fr_280px] gap-3">
      {/* Chat */}
      <div className="bg-white/[0.03] border border-white/[0.07] rounded-xl flex flex-col h-[380px]">
        <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3 scrollbar-thin scrollbar-thumb-white/10">
          {messages.map((m, i) => (
            <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[78%]`}>
                <div className={`px-3 py-2 rounded-xl text-sm leading-relaxed
                  ${m.role === "user"
                    ? "bg-amber-500 text-black font-medium rounded-br-sm"
                    : m.error
                      ? "bg-red-500/10 text-red-300 border border-red-500/20 rounded-bl-sm"
                      : "bg-white/[0.06] text-white border border-white/[0.07] rounded-bl-sm"}`}>
                  {m.text}
                </div>
                <div className={`text-[10px] text-white/25 mt-1 ${m.role === "user" ? "text-right" : ""}`}>
                  {m.role === "bot" ? "Bot" : "Vos"} · {m.time}
                </div>
              </div>
            </div>
          ))}
          {loading && (
            <div className="flex justify-start">
              <div className="bg-white/[0.06] border border-white/[0.07] rounded-xl rounded-bl-sm px-4 py-3 flex gap-1.5 items-center">
                {[0,1,2].map(i => (
                  <span key={i} className="w-1.5 h-1.5 bg-white/30 rounded-full animate-bounce"
                    style={{ animationDelay: `${i * 0.15}s` }} />
                ))}
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>
        <div className="flex gap-2 p-3 border-t border-white/[0.06]">
          <input
            className="flex-1 bg-white/[0.04] border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-white placeholder-white/25 outline-none focus:border-amber-500/50"
            placeholder='Ej: "busco una hilux diesel" · Enter para enviar'
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === "Enter" && send()}
            disabled={loading}
          />
          <button
            onClick={send}
            disabled={loading || !input.trim()}
            className="bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-black font-semibold text-sm px-4 rounded-lg transition-colors"
          >
            Enviar
          </button>
        </div>
      </div>

      {/* Panel de decisión */}
      <div className="bg-white/[0.03] border border-white/[0.07] rounded-xl p-4">
        <div className="text-[11px] font-semibold text-white/30 uppercase tracking-wider mb-4">
          Decisión del agente
        </div>

        {!decision ? (
          <div className="text-sm text-white/20 text-center pt-8">
            Enviá un mensaje para ver cómo decide el bot
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <Row label="Intent" value={decision.intent} mono />
            <Row label="Action">
              {actionBadge(decision.action)}
            </Row>
            <Row label="Urgencia" value={decision.urgency} />
            <Row label="Marca" value={decision.extracted?.brand} />
            <Row label="Modelo" value={decision.extracted?.model} />
            {decision.extracted?.maxPrice && (
              <Row
                label="Presupuesto"
                value={`${decision.extracted.currency || "ARS"} ${Number(decision.extracted.maxPrice).toLocaleString("es-AR")}`}
              />
            )}
            <div>
              <Row label="Lead score" value={decision.leadScore ?? "—"} />
              <div className="h-1 bg-white/[0.06] rounded-full mt-1.5 overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{
                    width: `${Math.min(100, decision.leadScore || 0)}%`,
                    background: `linear-gradient(90deg, #22c55e, ${scoreColor(decision.leadScore || 0)})`,
                  }}
                />
              </div>
            </div>
            <Row label="Handoff">
              {decision.handoffRecommended
                ? <span className="text-amber-400 text-xs font-semibold">Sí — escalar ahora</span>
                : <span className="text-white/30 text-xs">No</span>}
            </Row>
            {decision.suggestedReply && (
              <div className="bg-white/[0.04] border border-white/[0.07] rounded-lg p-3 mt-1">
                <div className="text-[10px] text-white/30 uppercase tracking-wide mb-1">Respuesta sugerida</div>
                <div className="text-xs text-white/60 leading-relaxed italic">
                  "{decision.suggestedReply}"
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Row({ label, value, mono, children }) {
  return (
    <div className="flex justify-between items-center">
      <span className="text-xs text-white/30">{label}</span>
      {children || (
        <span className={`text-xs font-medium text-white ${mono ? "font-mono" : ""}`}>
          {value || "—"}
        </span>
      )}
    </div>
  );
}

const AUTO_AGENCY_POLICY_PRESETS = [
  {
    name: "Precio y stock",
    description:
      "Cuando pregunten por precio, valor, stock o disponibilidad, pedir marca, modelo o presupuesto. Responder solo con unidades reales en stock y, si no hay coincidencia exacta, ofrecer alternativas cercanas.",
    triggers: [
      "precio",
      "vale",
      "valor",
      "cuánto sale",
      "cuánto cuesta",
      "stock",
      "disponible",
      "está disponible",
      "tenés",
      "hay",
      "me pasás precio",
    ],
  },
  {
    name: "Financiación",
    description:
      "Si consultan por cuotas, financiación o anticipo, pedir vehículo de interés, entrega inicial y cantidad de cuotas. No prometer aprobación; presentar la financiación como evaluación sujeta a revisión.",
    triggers: [
      "financiacion",
      "financiación",
      "financiar",
      "cuotas",
      "anticipo",
      "crédito",
      "credito",
      "plan",
      "entrega y cuotas",
      "sin anticipo",
    ],
  },
  {
    name: "Permuta / usado",
    description:
      "Cuando quieran entregar un usado, responder que se toma sujeto a revisión. Pedir marca, modelo, año, kilometraje y fotos para orientar la operación.",
    triggers: [
      "usado",
      "permuta",
      "parte de pago",
      "entrego",
      "tomo usado",
      "reciben usado",
      "te doy mi auto",
      "dejo mi auto",
    ],
  },
  {
    name: "Ubicación y visita",
    description:
      "Si preguntan dónde están o cómo llegar, informar que la agencia está en Tandil y ofrecer ubicación exacta. Si el lead muestra intención, proponer visita o test drive con día y horario.",
    triggers: [
      "ubicación",
      "ubicacion",
      "dónde están",
      "donde están",
      "dirección",
      "direccion",
      "como llego",
      "test drive",
      "visita",
    ],
  },
  {
    name: "Horarios de atención",
    description:
      "Responder horarios de forma breve y cerrar con una propuesta concreta para coordinar visita o llamada.",
    triggers: ["horario", "horarios", "atienden", "abierto", "abren"],
  },
  {
    name: "Cierre comercial",
    description:
      "Cuando el lead ya dejó claro vehículo, presupuesto o forma de pago, cerrar con una próxima acción concreta: visita, envío de ubicación, simulación o derivación a asesor humano.",
    triggers: ["reservar", "seña", "reserva", "avanzo", "quiero verlo", "quiero ir"],
  },
];

const AUTO_AGENCY_FAQ_PRESETS = [
  {
    question: "¿Tienen stock o precio?",
    answer:
      "Decime marca, modelo o presupuesto y te muestro opciones disponibles con precio.",
  },
  {
    question: "¿Trabajan con financiación?",
    answer:
      "Sí, podemos evaluar financiación. Pasame qué vehículo te interesa, cuánto anticipo tenés y en cuántas cuotas lo querés ver.",
  },
  {
    question: "¿Toman usado o permuta?",
    answer:
      "Tomamos usado en parte de pago sujeto a revisión. Si querés, decime qué auto tenés y te orientamos.",
  },
  {
    question: "¿Dónde están?",
    answer:
      "Estamos en Tandil. Decime desde qué zona venís y te paso la ubicación exacta para llegar sin vueltas.",
  },
  {
    question: "¿Qué horario tienen?",
    answer:
      "Atendemos de lunes a viernes de 9:00 a 18:00 y sábados de 9:30 a 13:00. Si querés, coordinamos una visita.",
  },
  {
    question: "¿Puedo coordinar visita o test drive?",
    answer:
      "Sí. Decime qué vehículo querés ver y qué día te queda cómodo, y te coordinamos visita o test drive.",
  },
  {
    question: "¿Cómo reservo una unidad?",
    answer:
      "Si ya tenés definida la unidad, te explicamos los pasos de reserva y te derivamos con un asesor para cerrarlo bien.",
  },
];

const AUTO_AGENCY_COVERAGE = [
  { id: "stock", label: "Precio / stock", keywords: ["precio", "stock", "disponible", "cuánto cuesta"] },
  { id: "financing", label: "Financiación", keywords: ["financi", "cuotas", "anticipo", "credito", "crédito"] },
  { id: "tradein", label: "Permuta / usado", keywords: ["permuta", "usado", "parte de pago", "entrego"] },
  { id: "location", label: "Ubicación", keywords: ["tandil", "ubicación", "ubicacion", "dirección", "direccion"] },
  { id: "hours", label: "Horarios", keywords: ["horario", "atienden", "abierto", "sábado", "sabado"] },
  { id: "visit", label: "Visita / test drive", keywords: ["visita", "test drive", "quiero verlo", "coordinar"] },
];

const normalizeText = (value) =>
  String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim();

// ─── Tab: Reglas (Policies + FAQs) ───────────────────────────────────────────

function TabReglas({ policies, faqs, loadingPolicies, onReloadPolicies, onReloadFaqs }) {
  const [newPolicy, setNewPolicy] = useState({ name: "", description: "", triggers: "" });
  const [newFaq, setNewFaq] = useState({ question: "", answer: "" });
  const [showPolicyForm, setShowPolicyForm] = useState(false);
  const [showFaqForm, setShowFaqForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [installingPreset, setInstallingPreset] = useState(false);

  const knowledgeCorpus = useMemo(() => {
    const policyText = (policies || []).flatMap((policy) => [
      policy?.name,
      policy?.description,
      ...(Array.isArray(policy?.triggers) ? policy.triggers : []),
    ]);
    const faqText = (faqs || []).flatMap((faq) => [faq?.question, faq?.answer]);
    return normalizeText([...policyText, ...faqText].filter(Boolean).join(" "));
  }, [policies, faqs]);

  const coverageItems = useMemo(
    () =>
      AUTO_AGENCY_COVERAGE.map((item) => ({
        ...item,
        configured: item.keywords.some((keyword) => knowledgeCorpus.includes(normalizeText(keyword))),
      })),
    [knowledgeCorpus]
  );

  const missingCoverage = coverageItems.filter((item) => !item.configured);

  const savePolicy = async () => {
    if (!newPolicy.name.trim()) return;
    setSaving(true);
    try {
      await api.post("/bot/intelligence/policies", {
        name: newPolicy.name,
        description: newPolicy.description,
        triggers: newPolicy.triggers
          .split(",")
          .map((trigger) => trigger.trim())
          .filter(Boolean),
      });
      toast.success("Regla guardada");
      setNewPolicy({ name: "", description: "", triggers: "" });
      setShowPolicyForm(false);
      await onReloadPolicies();
    } catch {
      toast.error("Error al guardar la regla");
    } finally {
      setSaving(false);
    }
  };

  const deletePolicy = async (id) => {
    try {
      await api.delete(`/bot/intelligence/policies/${id}`);
      toast.success("Regla eliminada");
      await onReloadPolicies();
    } catch {
      toast.error("Error al eliminar");
    }
  };

  const saveFaq = async () => {
    if (!newFaq.question.trim() || !newFaq.answer.trim()) return;
    setSaving(true);
    try {
      await api.post("/bot/intelligence/faqs", newFaq);
      toast.success("FAQ guardada");
      setNewFaq({ question: "", answer: "" });
      setShowFaqForm(false);
      await onReloadFaqs();
    } catch {
      toast.error("Error al guardar el FAQ");
    } finally {
      setSaving(false);
    }
  };

  const deleteFaq = async (id) => {
    try {
      await api.delete(`/bot/intelligence/faqs/${id}`);
      toast.success("FAQ eliminada");
      await onReloadFaqs();
    } catch {
      toast.error("Error al eliminar");
    }
  };

  const usePolicyPreset = (preset) => {
    setShowPolicyForm(true);
    setNewPolicy({
      name: preset.name,
      description: preset.description,
      triggers: preset.triggers.join(", "),
    });
  };

  const useFaqPreset = (preset) => {
    setShowFaqForm(true);
    setNewFaq({
      question: preset.question,
      answer: preset.answer,
    });
  };

  const installAgencyPreset = async () => {
    setInstallingPreset(true);

    try {
      const existingPolicyNames = new Set((policies || []).map((policy) => normalizeText(policy?.name)));
      const existingPolicyTriggers = new Set(
        (policies || []).flatMap((policy) =>
          Array.isArray(policy?.triggers) ? policy.triggers.map((trigger) => normalizeText(trigger)) : []
        )
      );
      const existingFaqQuestions = new Set((faqs || []).map((faq) => normalizeText(faq?.question)));

      let createdPolicies = 0;
      let createdFaqs = 0;
      let skipped = 0;

      for (const preset of AUTO_AGENCY_POLICY_PRESETS) {
        const nameExists = existingPolicyNames.has(normalizeText(preset.name));
        const triggerExists = preset.triggers.some((trigger) => existingPolicyTriggers.has(normalizeText(trigger)));
        if (nameExists || triggerExists) {
          skipped += 1;
          continue;
        }

        await api.post("/bot/intelligence/policies", preset);
        createdPolicies += 1;
      }

      for (const preset of AUTO_AGENCY_FAQ_PRESETS) {
        const questionExists = existingFaqQuestions.has(normalizeText(preset.question));
        if (questionExists) {
          skipped += 1;
          continue;
        }

        await api.post("/bot/intelligence/faqs", preset);
        createdFaqs += 1;
      }

      await Promise.all([onReloadPolicies(), onReloadFaqs()]);
      toast.success(
        `Base concesionaria cargada · ${createdPolicies} reglas · ${createdFaqs} FAQs${skipped ? ` · ${skipped} omitidas` : ""}`
      );
    } catch {
      toast.error("No se pudo instalar la base de agencia");
    } finally {
      setInstallingPreset(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-[1.35fr_1fr] gap-4">
        <div className="rounded-2xl border border-white/[0.08] bg-white/[0.03] p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-white/35">
                Base sugerida para concesionaria
              </div>
              <div className="mt-2 text-lg font-semibold text-white">Pack comercial listo para agencia de autos</div>
              <div className="mt-1 max-w-2xl text-sm leading-6 text-white/45">
                Carga reglas y FAQs pensadas para stock, precio, financiación, permuta, ubicación, horarios y visitas.
                No borra nada existente: solo agrega lo que falte.
              </div>
            </div>
            <button
              onClick={installAgencyPreset}
              disabled={installingPreset}
              className="rounded-xl bg-amber-500 px-4 py-2 text-sm font-semibold text-black transition-colors hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {installingPreset ? "Instalando..." : "Instalar base agencia"}
            </button>
          </div>

          <div className="mt-4 grid grid-cols-3 gap-3">
            <MetricCard label="Reglas activas" value={policies.length || "0"} />
            <MetricCard label="FAQs activas" value={faqs.length || "0"} />
            <MetricCard
              label="Cobertura comercial"
              value={`${coverageItems.filter((item) => item.configured).length}/${coverageItems.length}`}
              change={missingCoverage.length ? `${missingCoverage.length} áreas por reforzar` : "Cobertura completa"}
              changeType={missingCoverage.length ? "neutral" : "up"}
            />
          </div>
        </div>

        <div className="rounded-2xl border border-white/[0.08] bg-white/[0.03] p-5">
          <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-white/35">Chequeo comercial</div>
          <div className="mt-3 flex flex-col gap-2">
            {coverageItems.map((item) => (
              <div
                key={item.id}
                className={`flex items-center justify-between rounded-xl border px-3 py-2.5 ${
                  item.configured
                    ? "border-green-500/15 bg-green-500/10"
                    : "border-white/[0.08] bg-white/[0.02]"
                }`}
              >
                <span className="text-sm text-white">{item.label}</span>
                <span
                  className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                    item.configured ? "bg-green-500/15 text-green-300" : "bg-white/5 text-white/45"
                  }`}
                >
                  {item.configured ? "Cubierto" : "Falta"}
                </span>
              </div>
            ))}
          </div>
          {missingCoverage.length > 0 ? (
            <div className="mt-4 rounded-xl border border-amber-500/15 bg-amber-500/10 px-3 py-2 text-xs leading-5 text-amber-200">
              Recomendación: cargá primero las áreas faltantes para que el bot responda mejor en conversaciones de venta.
            </div>
          ) : (
            <div className="mt-4 rounded-xl border border-green-500/15 bg-green-500/10 px-3 py-2 text-xs leading-5 text-green-200">
              La base comercial cubre los disparadores principales de una agencia.
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-6">
        <div>
          <div className="mb-3 flex items-center justify-between">
            <SectionTitle>Reglas del bot</SectionTitle>
            <button
              onClick={() => setShowPolicyForm((value) => !value)}
              className="text-xs font-medium text-amber-400 hover:text-amber-300"
            >
              {showPolicyForm ? "Cancelar" : "+ Nueva regla"}
            </button>
          </div>

          <div className="mb-3 grid grid-cols-2 gap-2">
            {AUTO_AGENCY_POLICY_PRESETS.slice(0, 4).map((preset) => (
              <button
                key={preset.name}
                onClick={() => usePolicyPreset(preset)}
                className="rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 py-3 text-left transition-colors hover:border-amber-500/25 hover:bg-amber-500/[0.06]"
              >
                <div className="text-sm font-medium text-white">{preset.name}</div>
                <div className="mt-1 text-[11px] leading-5 text-white/35">{preset.triggers.slice(0, 3).join(" · ")}</div>
              </button>
            ))}
          </div>

          {showPolicyForm && (
            <div className="mb-3 flex flex-col gap-2 rounded-xl border border-white/[0.08] bg-white/[0.04] p-4">
              <input
                className="w-full rounded-lg border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-sm text-white outline-none placeholder:text-white/25 focus:border-amber-500/40"
                placeholder="Nombre de la regla"
                value={newPolicy.name}
                onChange={(event) => setNewPolicy((prev) => ({ ...prev, name: event.target.value }))}
              />
              <textarea
                className="w-full resize-none rounded-lg border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-sm text-white outline-none placeholder:text-white/25 focus:border-amber-500/40"
                placeholder="Descripción / instrucción para el bot"
                rows={3}
                value={newPolicy.description}
                onChange={(event) => setNewPolicy((prev) => ({ ...prev, description: event.target.value }))}
              />
              <input
                className="w-full rounded-lg border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-sm text-white outline-none placeholder:text-white/25 focus:border-amber-500/40"
                placeholder="Triggers (separados por coma)"
                value={newPolicy.triggers}
                onChange={(event) => setNewPolicy((prev) => ({ ...prev, triggers: event.target.value }))}
              />
              <button
                onClick={savePolicy}
                disabled={saving || !newPolicy.name.trim()}
                className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-black transition-colors hover:bg-amber-400 disabled:opacity-40"
              >
                Guardar regla
              </button>
            </div>
          )}

          {loadingPolicies ? (
            <div className="flex flex-col gap-2">
              {[1, 2, 3].map((index) => (
                <div key={index} className="h-16 animate-pulse rounded-xl bg-white/[0.03]" />
              ))}
            </div>
          ) : policies.length === 0 ? (
            <div className="py-6 text-center text-sm text-white/25">Sin reglas configuradas</div>
          ) : (
            <div className="flex flex-col gap-2">
              {policies.map((policy, index) => {
                const triggers = Array.isArray(policy?.triggers) ? policy.triggers : [];
                return (
                  <div key={policy.id || index} className="rounded-xl border border-white/[0.06] bg-white/[0.03] px-4 py-3">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="text-sm font-medium text-white">{policy.name}</div>
                        {policy.description ? (
                          <div className="mt-0.5 text-xs leading-relaxed text-white/40">{policy.description}</div>
                        ) : null}
                        {triggers.length > 0 ? (
                          <div className="mt-2 flex flex-wrap gap-1">
                            {triggers.slice(0, 6).map((trigger, triggerIndex) => (
                              <span
                                key={`${policy.id || index}-${triggerIndex}`}
                                className="rounded-full bg-white/[0.05] px-2 py-0.5 text-[10px] text-white/45"
                              >
                                {trigger}
                              </span>
                            ))}
                            {triggers.length > 6 ? (
                              <span className="rounded-full bg-white/[0.05] px-2 py-0.5 text-[10px] text-white/30">
                                +{triggers.length - 6}
                              </span>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                      <button
                        onClick={() => deletePolicy(policy.id)}
                        className="mt-0.5 text-lg leading-none text-white/20 hover:text-red-400"
                      >
                        ×
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div>
          <div className="mb-3 flex items-center justify-between">
            <SectionTitle>FAQs del bot</SectionTitle>
            <button
              onClick={() => setShowFaqForm((value) => !value)}
              className="text-xs font-medium text-amber-400 hover:text-amber-300"
            >
              {showFaqForm ? "Cancelar" : "+ Nueva FAQ"}
            </button>
          </div>

          <div className="mb-3 grid grid-cols-2 gap-2">
            {AUTO_AGENCY_FAQ_PRESETS.slice(0, 4).map((preset) => (
              <button
                key={preset.question}
                onClick={() => useFaqPreset(preset)}
                className="rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 py-3 text-left transition-colors hover:border-amber-500/25 hover:bg-amber-500/[0.06]"
              >
                <div className="text-sm font-medium text-white">{preset.question}</div>
                <div className="mt-1 text-[11px] leading-5 text-white/35">{preset.answer.slice(0, 78)}...</div>
              </button>
            ))}
          </div>

          {showFaqForm && (
            <div className="mb-3 flex flex-col gap-2 rounded-xl border border-white/[0.08] bg-white/[0.04] p-4">
              <input
                className="w-full rounded-lg border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-sm text-white outline-none placeholder:text-white/25 focus:border-amber-500/40"
                placeholder="Pregunta"
                value={newFaq.question}
                onChange={(event) => setNewFaq((prev) => ({ ...prev, question: event.target.value }))}
              />
              <textarea
                className="w-full resize-none rounded-lg border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-sm text-white outline-none placeholder:text-white/25 focus:border-amber-500/40"
                placeholder="Respuesta"
                rows={4}
                value={newFaq.answer}
                onChange={(event) => setNewFaq((prev) => ({ ...prev, answer: event.target.value }))}
              />
              <button
                onClick={saveFaq}
                disabled={saving || !newFaq.question.trim() || !newFaq.answer.trim()}
                className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-black transition-colors hover:bg-amber-400 disabled:opacity-40"
              >
                Guardar FAQ
              </button>
            </div>
          )}

          {faqs.length === 0 ? (
            <div className="py-6 text-center text-sm text-white/25">Sin FAQs configuradas</div>
          ) : (
            <div className="flex flex-col gap-2">
              {faqs.map((faq, index) => (
                <div key={faq.id || index} className="rounded-xl border border-white/[0.06] bg-white/[0.03] px-4 py-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="text-sm font-medium text-white">{faq.question}</div>
                      <div className="mt-0.5 text-xs leading-relaxed text-white/40">{faq.answer}</div>
                    </div>
                    <button
                      onClick={() => deleteFaq(faq.id)}
                      className="mt-0.5 text-lg leading-none text-white/20 hover:text-red-400"
                    >
                      ×
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Tab: Playbooks ───────────────────────────────────────────────────────────

function TabPlaybooks({ playbooks, loadingPlaybooks, onReload }) {
  const [form, setForm] = useState({ intent: "", description: "", template: "" });
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!form.intent.trim() || !form.template.trim()) return;
    setSaving(true);
    try {
      await api.post("/bot/intelligence/playbooks", form);
      toast.success("Playbook guardado");
      setForm({ intent: "", description: "", template: "" });
      setShowForm(false);
      onReload();
    } catch {
      toast.error("Error al guardar el playbook");
    } finally {
      setSaving(false);
    }
  };

  const del = async (id) => {
    if (!window.confirm("¿Eliminar este playbook?")) return;
    try {
      await api.delete(`/bot/intelligence/playbooks/${id}`);
      toast.success("Playbook eliminado");
      onReload();
    } catch {
      toast.error("Error al eliminar");
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <div className="text-[14px] font-semibold text-white">Playbooks</div>
          <div className="text-[12px] text-white/40 mt-0.5">
            Plantillas de respuesta activadas por intención del cliente.
            Usá {"{{nombre}}"}, {"{{marca}}"}, {"{{modelo}}"} como variables.
          </div>
        </div>
        <button
          onClick={() => setShowForm(v => !v)}
          className="px-3 py-1.5 bg-amber-500/10 border border-amber-500/20 text-amber-400 text-[12px] font-semibold rounded-lg hover:bg-amber-500/20 transition-colors"
        >
          + Nuevo playbook
        </button>
      </div>

      {showForm && (
        <div className="bg-white/[0.03] border border-white/[0.07] rounded-xl p-4 mb-5 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] text-white/40 mb-1 block">Intent (clave interna)</label>
              <input
                className="w-full bg-white/[0.05] border border-white/[0.08] rounded-lg px-3 py-2 text-[13px] text-white placeholder-white/20 focus:outline-none focus:border-amber-500/40"
                placeholder="ej: permuta, financiacion, visita"
                value={form.intent}
                onChange={e => setForm(f => ({ ...f, intent: e.target.value }))}
              />
            </div>
            <div>
              <label className="text-[11px] text-white/40 mb-1 block">Descripción</label>
              <input
                className="w-full bg-white/[0.05] border border-white/[0.08] rounded-lg px-3 py-2 text-[13px] text-white placeholder-white/20 focus:outline-none focus:border-amber-500/40"
                placeholder="Para qué sirve este playbook"
                value={form.description}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              />
            </div>
          </div>
          <div>
            <label className="text-[11px] text-white/40 mb-1 block">Template de respuesta</label>
            <textarea
              rows={4}
              className="w-full bg-white/[0.05] border border-white/[0.08] rounded-lg px-3 py-2 text-[13px] text-white placeholder-white/20 focus:outline-none focus:border-amber-500/40 resize-none"
              placeholder="Escribí la respuesta. Usá {{nombre}}, {{marca}}, {{modelo}}, {{precio}} como variables dinámicas."
              value={form.template}
              onChange={e => setForm(f => ({ ...f, template: e.target.value }))}
            />
          </div>
          <div className="flex gap-2">
            <button
              onClick={save}
              disabled={saving || !form.intent.trim() || !form.template.trim()}
              className="px-4 py-1.5 bg-amber-500 text-black text-[12px] font-bold rounded-lg hover:bg-amber-400 disabled:opacity-40 transition-colors"
            >
              {saving ? "Guardando..." : "Guardar playbook"}
            </button>
            <button
              onClick={() => setShowForm(false)}
              className="px-4 py-1.5 bg-white/[0.05] text-white/50 text-[12px] rounded-lg hover:bg-white/[0.08] transition-colors"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {loadingPlaybooks ? (
        <div className="text-center py-8 text-white/30 text-[13px]">Cargando playbooks...</div>
      ) : playbooks.length === 0 ? (
        <div className="text-center py-10 text-white/20 text-[13px]">
          No hay playbooks configurados.
          <br />
          <span className="text-white/30">Agregá uno para que el bot use respuestas estructuradas.</span>
        </div>
      ) : (
        <div className="space-y-3">
          {playbooks.map((pb) => (
            <div key={pb.id} className="bg-white/[0.03] border border-white/[0.06] rounded-xl p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[11px] bg-amber-500/10 text-amber-400 border border-amber-500/20 px-2 py-0.5 rounded font-mono font-bold">
                      {pb.intent}
                    </span>
                    {pb.description && (
                      <span className="text-[12px] text-white/50">{pb.description}</span>
                    )}
                  </div>
                  <div className="text-[12px] text-white/60 bg-white/[0.03] rounded-lg p-3 mt-2 whitespace-pre-wrap font-mono leading-relaxed border border-white/[0.04]">
                    {pb.template}
                  </div>
                </div>
                <button
                  onClick={() => del(pb.id)}
                  className="text-white/20 hover:text-red-400 transition-colors text-[18px] leading-none mt-0.5"
                  title="Eliminar"
                >
                  ×
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Tab: Aprendizaje ─────────────────────────────────────────────────────────

function TabAprendizaje() {
  const [stats, setStats] = useState(null);
  const [captures, setCaptures] = useState([]);
  const [loading, setLoading] = useState(false);
  const [filterStatus, setFilterStatus] = useState("pending");
  const [selected, setSelected] = useState(null);
  const [feedbackNote, setFeedbackNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [statsRes, capturesRes] = await Promise.allSettled([
        api.get("/bot/learning/stats"),
        api.get("/bot/learning/captures", { params: { status: filterStatus, limit: 30 } }),
      ]);
      if (statsRes.status === "fulfilled") setStats(statsRes.value.data);
      if (capturesRes.status === "fulfilled") {
        const d = capturesRes.value.data;
        setCaptures(Array.isArray(d) ? d : d?.rows || []);
      }
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [filterStatus]);

  useEffect(() => { loadData(); }, [loadData]);

  const approve = async (id) => {
    setSubmitting(true);
    try {
      await api.post("/bot/learning/feedback", { captureId: id, reviewer: "panel", rating: 2, notes: feedbackNote || undefined });
      toast.success("Captura aprobada ✓");
      setSelected(null);
      setFeedbackNote("");
      loadData();
    } catch { toast.error("Error"); }
    finally { setSubmitting(false); }
  };

  const reject = async (id) => {
    setSubmitting(true);
    try {
      await api.post("/bot/learning/feedback", { captureId: id, reviewer: "panel", rating: -1, notes: feedbackNote || undefined });
      toast.success("Captura rechazada");
      setSelected(null);
      setFeedbackNote("");
      loadData();
    } catch { toast.error("Error"); }
    finally { setSubmitting(false); }
  };

  const promote = async (id) => {
    setSubmitting(true);
    try {
      await api.post(`/bot/learning/promote/${id}`);
      toast.success("¡Promovido a ejemplos del bot! 🚀");
      setSelected(null);
      loadData();
    } catch { toast.error("Error al promover"); }
    finally { setSubmitting(false); }
  };

  const STATUS_LABELS = { pending: "Pendientes", approved: "Aprobadas", rejected: "Rechazadas", flagged: "Flaggeadas", all: "Todas" };
  const STATUS_COLORS = { pending: "#f59e0b", approved: "#22c55e", rejected: "#ef4444", flagged: "#a855f7" };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <div className="text-[14px] font-semibold text-white">Sistema de Aprendizaje Incremental</div>
          <div className="text-[12px] text-white/40 mt-0.5">
            Revisá respuestas del bot y aprobá las mejores para que aprenda.
          </div>
        </div>
        <button onClick={loadData} className="text-[12px] text-white/30 hover:text-white/60 transition-colors">
          ↻ Actualizar
        </button>
      </div>

      {/* Stats row */}
      {stats && (
        <div className="grid grid-cols-4 gap-3 mb-5">
          {[
            { label: "Total capturas", value: stats.total_captures, color: "#3b82f6" },
            { label: "Pendientes", value: stats.pending, color: "#f59e0b" },
            { label: "Aprobadas", value: stats.approved, color: "#22c55e" },
            { label: "Score promedio", value: stats.avg_auto_score ? (Number(stats.avg_auto_score) * 100).toFixed(0) + "%" : "—", color: "#a855f7" },
          ].map(s => (
            <div key={s.label} className="bg-white/[0.03] border border-white/[0.06] rounded-xl p-3 text-center">
              <div className="text-[20px] font-bold" style={{ color: s.color }}>{s.value ?? "—"}</div>
              <div className="text-[11px] text-white/30 mt-0.5">{s.label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Filter */}
      <div className="flex gap-2 mb-4">
        {Object.keys(STATUS_LABELS).map(s => (
          <button
            key={s}
            onClick={() => setFilterStatus(s)}
            className={`px-3 py-1.5 text-[12px] font-medium rounded-lg border transition-colors ${
              filterStatus === s
                ? "bg-white/[0.08] border-white/[0.15] text-white"
                : "bg-transparent border-white/[0.06] text-white/30 hover:text-white/50"
            }`}
          >
            {STATUS_LABELS[s]}
          </button>
        ))}
      </div>

      {/* List */}
      {loading ? (
        <div className="text-center py-8 text-white/30 text-[13px]">Cargando capturas...</div>
      ) : captures.length === 0 ? (
        <div className="text-center py-10 text-white/20 text-[13px]">Sin capturas para este filtro.</div>
      ) : (
        <div className="space-y-2">
          {captures.map((c) => (
            <div
              key={c.id}
              className={`bg-white/[0.02] border rounded-xl p-4 cursor-pointer hover:bg-white/[0.04] transition-colors ${
                selected?.id === c.id ? "border-amber-500/30 bg-amber-500/[0.04]" : "border-white/[0.06]"
              }`}
              onClick={() => setSelected(selected?.id === c.id ? null : c)}
            >
              <div className="flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                    {c.intent && (
                      <span className="text-[10px] bg-blue-500/10 text-blue-400 border border-blue-500/20 px-1.5 py-0.5 rounded font-mono">
                        {c.intent}
                      </span>
                    )}
                    <span className="text-[10px] text-white/25">{c.source_type}</span>
                    <span className="text-[10px]" style={{ color: STATUS_COLORS[c.status] || "#6b7280" }}>
                      ● {c.status}
                    </span>
                    <span className="text-[10px] text-white/25 ml-auto">
                      Score: {c.auto_score ? (Number(c.auto_score) * 100).toFixed(0) + "%" : "—"}
                    </span>
                  </div>
                  <div className="text-[12px] text-white/70 mb-1">
                    <span className="text-white/30">Cliente: </span>
                    {c.user_message?.slice(0, 120)}
                    {c.user_message?.length > 120 ? "…" : ""}
                  </div>
                  <div className="text-[12px] text-white/50">
                    <span className="text-white/20">Bot: </span>
                    {c.bot_response?.slice(0, 120)}
                    {c.bot_response?.length > 120 ? "…" : ""}
                  </div>
                </div>
              </div>

              {/* Expanded review panel */}
              {selected?.id === c.id && (
                <div className="mt-4 pt-4 border-t border-white/[0.06]" onClick={e => e.stopPropagation()}>
                  <div className="text-[11px] text-white/30 mb-2">Respuesta completa del bot:</div>
                  <div className="bg-white/[0.03] rounded-lg p-3 text-[12px] text-white/70 whitespace-pre-wrap mb-3 max-h-40 overflow-y-auto">
                    {c.bot_response}
                  </div>
                  <div className="mb-3">
                    <label className="text-[11px] text-white/30 mb-1 block">Nota (opcional)</label>
                    <input
                      className="w-full bg-white/[0.05] border border-white/[0.08] rounded-lg px-3 py-2 text-[12px] text-white placeholder-white/20 focus:outline-none focus:border-amber-500/40"
                      placeholder="¿Por qué la aprobás o rechazás?"
                      value={feedbackNote}
                      onChange={e => setFeedbackNote(e.target.value)}
                    />
                  </div>
                  <div className="flex gap-2 flex-wrap">
                    <button
                      onClick={() => approve(c.id)}
                      disabled={submitting}
                      className="px-3 py-1.5 bg-green-500/10 border border-green-500/20 text-green-400 text-[12px] font-semibold rounded-lg hover:bg-green-500/20 disabled:opacity-40 transition-colors"
                    >
                      ✓ Aprobar
                    </button>
                    <button
                      onClick={() => promote(c.id)}
                      disabled={submitting}
                      className="px-3 py-1.5 bg-amber-500/10 border border-amber-500/20 text-amber-400 text-[12px] font-semibold rounded-lg hover:bg-amber-500/20 disabled:opacity-40 transition-colors"
                    >
                      🚀 Promover a ejemplos
                    </button>
                    <button
                      onClick={() => reject(c.id)}
                      disabled={submitting}
                      className="px-3 py-1.5 bg-red-500/10 border border-red-500/20 text-red-400 text-[12px] font-semibold rounded-lg hover:bg-red-500/20 disabled:opacity-40 transition-colors"
                    >
                      ✗ Rechazar
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Tab: Configuración ───────────────────────────────────────────────────────

function TabConfig() {
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    agencyName: "",
    financeApr: "0.75",
    botEnabled: true,
    maxReplyDelayMs: "2500",
    handoffPhoneNumber: "",
    handoffMessage: "",
  });

  useEffect(() => {
    api.get("/bot/intelligence/settings")
      .then(({ data }) => {
        const s = data?.settings || data || {};
        setSettings(s);
        setForm({
          agencyName:         String(s.agencyName || s.dealershipName || ""),
          financeApr:         String(s.financeApr ?? "0.75"),
          botEnabled:         Boolean(s.botEnabled !== false),
          maxReplyDelayMs:    String(s.maxReplyDelayMs ?? "2500"),
          handoffPhoneNumber: String(s.handoffPhoneNumber || ""),
          handoffMessage:     String(s.handoffMessage || ""),
        });
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      const patch = {
        ...settings,
        agencyName:         form.agencyName,
        dealershipName:     form.agencyName,
        financeApr:         parseFloat(form.financeApr) || 0.75,
        botEnabled:         form.botEnabled,
        maxReplyDelayMs:    parseInt(form.maxReplyDelayMs, 10) || 2500,
        handoffPhoneNumber: form.handoffPhoneNumber,
        handoffMessage:     form.handoffMessage,
      };
      await api.put("/bot/intelligence/settings", { settings: patch });
      setSettings(patch);
      toast.success("Configuración guardada ✓");
    } catch {
      toast.error("Error al guardar la configuración");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="text-center py-8 text-white/30 text-[13px]">Cargando configuración...</div>;
  }

  const Field = ({ label, hint, children }) => (
    <div>
      <label className="text-[12px] font-medium text-white/60 block mb-1">{label}</label>
      {hint && <div className="text-[11px] text-white/25 mb-1.5">{hint}</div>}
      {children}
    </div>
  );

  return (
    <div>
      <div className="mb-5">
        <div className="text-[14px] font-semibold text-white">Configuración del bot</div>
        <div className="text-[12px] text-white/40 mt-0.5">
          Parámetros globales del motor de respuestas.
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mb-6">
        <Field label="Nombre de la agencia" hint="Aparece en las respuestas del bot">
          <input
            className="w-full bg-white/[0.05] border border-white/[0.08] rounded-lg px-3 py-2 text-[13px] text-white placeholder-white/20 focus:outline-none focus:border-amber-500/40"
            placeholder="Ej: AutoRed Tandil"
            value={form.agencyName}
            onChange={e => setForm(f => ({ ...f, agencyName: e.target.value }))}
          />
        </Field>

        <Field label="Tasa de financiación anual (APR)" hint="Decimal. 0.75 = 75% anual. Se usa en el simulador de cuotas.">
          <input
            type="number"
            step="0.01"
            min="0.01"
            max="5"
            className="w-full bg-white/[0.05] border border-white/[0.08] rounded-lg px-3 py-2 text-[13px] text-white placeholder-white/20 focus:outline-none focus:border-amber-500/40"
            value={form.financeApr}
            onChange={e => setForm(f => ({ ...f, financeApr: e.target.value }))}
          />
          <div className="text-[11px] text-white/25 mt-1">
            Cuota estimada actual: ARS {
              (() => {
                const apr = parseFloat(form.financeApr) || 0.75;
                const price = 20_000_000;
                const r = apr / 12;
                const n = 24;
                const pow = Math.pow(1 + r, n);
                const m = (price * r * pow) / (pow - 1);
                return Number.isFinite(m) ? Math.round(m).toLocaleString("es-AR") : "—";
              })()
            } / mes (ARS 20M, 24 cuotas, sin entrada)
          </div>
        </Field>

        <Field label="Delay máximo de respuesta (ms)" hint="Tiempo que simula que el bot 'está escribiendo'. Default: 2500 ms.">
          <input
            type="number"
            step="100"
            min="500"
            max="8000"
            className="w-full bg-white/[0.05] border border-white/[0.08] rounded-lg px-3 py-2 text-[13px] text-white placeholder-white/20 focus:outline-none focus:border-amber-500/40"
            value={form.maxReplyDelayMs}
            onChange={e => setForm(f => ({ ...f, maxReplyDelayMs: e.target.value }))}
          />
        </Field>

        <Field label="Teléfono de derivación a humano" hint="Número WhatsApp del asesor al que se deriva cuando el bot escala.">
          <input
            className="w-full bg-white/[0.05] border border-white/[0.08] rounded-lg px-3 py-2 text-[13px] text-white placeholder-white/20 focus:outline-none focus:border-amber-500/40"
            placeholder="ej: 5492494000000"
            value={form.handoffPhoneNumber}
            onChange={e => setForm(f => ({ ...f, handoffPhoneNumber: e.target.value }))}
          />
        </Field>

        <Field label="Mensaje de derivación" hint="Lo que el bot dice cuando pasa el lead a un humano.">
          <textarea
            rows={3}
            className="w-full bg-white/[0.05] border border-white/[0.08] rounded-lg px-3 py-2 text-[13px] text-white placeholder-white/20 focus:outline-none focus:border-amber-500/40 resize-none"
            placeholder="Ej: Te paso con un asesor que te puede ayudar mejor 🙌"
            value={form.handoffMessage}
            onChange={e => setForm(f => ({ ...f, handoffMessage: e.target.value }))}
          />
        </Field>

        <Field label="Estado del bot">
          <div className="flex items-center gap-3 mt-1">
            <button
              onClick={() => setForm(f => ({ ...f, botEnabled: !f.botEnabled }))}
              className={`relative w-11 h-6 rounded-full transition-colors ${form.botEnabled ? "bg-amber-500" : "bg-white/[0.12]"}`}
            >
              <span className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${form.botEnabled ? "translate-x-6" : "translate-x-1"}`} />
            </button>
            <span className={`text-[13px] font-medium ${form.botEnabled ? "text-green-400" : "text-white/30"}`}>
              {form.botEnabled ? "Bot activo" : "Bot pausado"}
            </span>
          </div>
        </Field>
      </div>

      <button
        onClick={save}
        disabled={saving}
        className="px-5 py-2 bg-amber-500 text-black text-[13px] font-bold rounded-lg hover:bg-amber-400 disabled:opacity-40 transition-colors"
      >
        {saving ? "Guardando..." : "Guardar configuración"}
      </button>
    </div>
  );
}

// ─── Componente principal ─────────────────────────────────────────────────────

const TABS = [
  { id: "estado",      label: "Estado" },
  { id: "stock",       label: "Stock del bot" },
  { id: "playground",  label: "Playground" },
  { id: "reglas",      label: "Reglas y FAQs" },
  { id: "playbooks",   label: "Playbooks" },
  { id: "aprendizaje", label: "Aprendizaje" },
  { id: "config",      label: "Configuración" },
];

export default function BotPanel() {
  const history = useHistory();
  const { user } = useContext(AuthContext);

  useEffect(() => {
    if (user?.profile && user.profile !== "admin") history.push("/");
  }, [user, history]);

  const [tab, setTab] = useState("estado");

  // Bot toggle
  const [botEnabled, setBotEnabled] = useState(true);
  const [togglingBot, setTogglingBot] = useState(false);

  // Data
  const [decisions, setDecisions]         = useState([]);
  const [vehicles, setVehicles]           = useState([]);
  const [policies, setPolicies]           = useState([]);
  const [faqs, setFaqs]                   = useState([]);
  const [playbooks, setPlaybooks]         = useState([]);

  // Loading states
  const [loadingDecisions, setLoadingDecisions]   = useState(false);
  const [loadingVehicles, setLoadingVehicles]     = useState(false);
  const [loadingPolicies, setLoadingPolicies]     = useState(false);
  const [loadingPlaybooks, setLoadingPlaybooks]   = useState(false);

  // Cargar estado del bot
  useEffect(() => {
    api.get("/bot/intelligence/settings")
      .then(({ data }) => {
        const s = data?.settings || data || {};
        if (typeof s.botEnabled === "boolean") setBotEnabled(s.botEnabled);
      })
      .catch(() => {});
  }, []);

  // Cargar decisiones
  const loadDecisions = useCallback(async () => {
    setLoadingDecisions(true);
    try {
      const { data } = await api.get("/bot/intelligence/decisions", { params: { limit: 50 } });
      setDecisions(Array.isArray(data) ? data : data?.decisions || []);
    } catch {
      setDecisions([]);
    } finally {
      setLoadingDecisions(false);
    }
  }, []);

  // Cargar vehículos
  const loadVehicles = useCallback(async () => {
    setLoadingVehicles(true);
    try {
      const { data } = await api.get("/vehicles");
      const list = Array.isArray(data) ? data : data?.vehicles || [];
      setVehicles(list);
    } catch {
      setVehicles([]);
    } finally {
      setLoadingVehicles(false);
    }
  }, []);

  // Cargar policies
  const loadPolicies = useCallback(async () => {
    setLoadingPolicies(true);
    try {
      const { data } = await api.get("/bot/intelligence/policies");
      setPolicies(Array.isArray(data) ? data : data?.policies || []);
    } catch {
      setPolicies([]);
    } finally {
      setLoadingPolicies(false);
    }
  }, []);

  // Cargar FAQs
  const loadFaqs = useCallback(async () => {
    try {
      const { data } = await api.get("/bot/intelligence/faqs");
      setFaqs(Array.isArray(data) ? data : data?.faqs || []);
    } catch {
      setFaqs([]);
    }
  }, []);

  // Cargar Playbooks
  const loadPlaybooks = useCallback(async () => {
    setLoadingPlaybooks(true);
    try {
      const { data } = await api.get("/bot/intelligence/playbooks");
      setPlaybooks(Array.isArray(data) ? data : data?.playbooks || []);
    } catch {
      setPlaybooks([]);
    } finally {
      setLoadingPlaybooks(false);
    }
  }, []);

  // Cargar todo al montar
  useEffect(() => {
    loadDecisions();
    loadVehicles();
    loadPolicies();
    loadFaqs();
    loadPlaybooks();
  }, [loadDecisions, loadVehicles, loadPolicies, loadFaqs, loadPlaybooks]);

  const handleToggleBot = async (next) => {
    setTogglingBot(true);
    try {
      const { data } = await api.get("/bot/intelligence/settings");
      const current = data?.settings || data || {};
      await api.put("/bot/intelligence/settings", { settings: { ...current, botEnabled: next } });
      setBotEnabled(next);
      toast.success(next ? "Bot activado" : "Bot pausado");
    } catch {
      toast.error("No se pudo cambiar el estado del bot");
    } finally {
      setTogglingBot(false);
    }
  };

  const vehiculosActivos = vehicles.filter(v => v.status !== "sold").length;

  return (
    <div className="min-h-screen bg-[#0f1117] p-6">
      <div className="max-w-6xl mx-auto">

        {/* Header */}
        <div className="bg-[#171b26] border border-white/[0.07] rounded-2xl overflow-hidden mb-1">
          <div className="px-6 py-4 flex items-center justify-between border-b border-white/[0.06]">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 bg-amber-500/10 border border-amber-500/20 rounded-xl flex items-center justify-center text-lg">
                🤖
              </div>
              <div>
                <div className="text-[15px] font-semibold text-white tracking-tight">
                  WaPro Bot — Concesionaria
                </div>
                <div className="text-[12px] text-white/30 mt-0.5">
                  Motor: GPT-4o-mini · Catálogo:{" "}
                  <span className={vehiculosActivos > 0 ? "text-green-400" : "text-white/30"}>
                    {vehiculosActivos > 0 ? `${vehiculosActivos} vehículos activos` : "cargando..."}
                  </span>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className={`w-2 h-2 rounded-full ${botEnabled ? "bg-green-400" : "bg-white/20"}`}
                style={botEnabled ? { boxShadow: "0 0 6px rgba(74,222,128,0.6)" } : {}} />
              <span className={`text-sm font-medium ${botEnabled ? "text-green-400" : "text-white/30"}`}>
                {botEnabled ? "Bot activo" : "Bot pausado"}
              </span>
              <Toggle on={botEnabled} onChange={handleToggleBot} loading={togglingBot} />
            </div>
          </div>

          {/* Tabs */}
          <div className="flex gap-0.5 px-4 bg-[#171b26]">
            {TABS.map(t => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`px-4 py-3 text-[13px] font-medium border-b-2 transition-all duration-150
                  ${tab === t.id
                    ? "text-amber-400 border-amber-500 bg-amber-500/[0.06]"
                    : "text-white/30 border-transparent hover:text-white/60"}`}
              >
                {t.label}
                {t.id === "stock" && vehiculosActivos > 0 && (
                  <span className="ml-1.5 text-[10px] bg-amber-500/10 text-amber-400 px-1.5 py-0.5 rounded font-bold">
                    {vehiculosActivos}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Contenido */}
        <div className="bg-[#171b26] border border-white/[0.07] rounded-2xl p-6 mt-1">
          {tab === "estado" && (
            <TabEstado decisions={decisions} loadingDecisions={loadingDecisions} />
          )}
          {tab === "stock" && (
            <TabStock vehicles={vehicles} loadingVehicles={loadingVehicles} onDelete={loadVehicles} />
          )}
          {tab === "playground" && (
            <TabPlayground />
          )}
          {tab === "reglas" && (
            <TabReglas
              policies={policies}
              faqs={faqs}
              loadingPolicies={loadingPolicies}
              onReloadPolicies={loadPolicies}
              onReloadFaqs={loadFaqs}
            />
          )}
          {tab === "playbooks" && (
            <TabPlaybooks
              playbooks={playbooks}
              loadingPlaybooks={loadingPlaybooks}
              onReload={loadPlaybooks}
            />
          )}
          {tab === "aprendizaje" && (
            <TabAprendizaje />
          )}
          {tab === "config" && (
            <TabConfig />
          )}
        </div>

      </div>
    </div>
  );
}
