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

import React, { useCallback, useContext, useEffect, useRef, useState } from "react";
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

function TabStock({ vehicles, loadingVehicles }) {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState("");

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
            const imageUrl = v.imageUrl || v.image || (Array.isArray(v.pictures) ? v.pictures[0] : null);
            const precioDisplay = precioRaw
              ? (Number.isFinite(precioNum) && precioNum > 0
                  ? precioNum.toLocaleString("es-AR")
                  : String(precioRaw))
              : null;

            return (
              <div
                key={v.id || i}
                className={`border rounded-xl overflow-hidden transition-colors
                  ${es0km
                    ? "bg-amber-500/[0.04] border-amber-500/20"
                    : "bg-white/[0.03] border-white/[0.06]"}`}
              >
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

// ─── Tab: Reglas (Policies + FAQs) ───────────────────────────────────────────

function TabReglas({ policies, faqs, loadingPolicies, onReloadPolicies, onReloadFaqs }) {
  const [newPolicy, setNewPolicy] = useState({ name: "", description: "", triggers: "" });
  const [newFaq, setNewFaq] = useState({ question: "", answer: "" });
  const [showPolicyForm, setShowPolicyForm] = useState(false);
  const [showFaqForm, setShowFaqForm] = useState(false);
  const [saving, setSaving] = useState(false);

  const savePolicy = async () => {
    if (!newPolicy.name.trim()) return;
    setSaving(true);
    try {
      await api.post("/bot/intelligence/policies", {
        name: newPolicy.name,
        description: newPolicy.description,
        triggers: newPolicy.triggers.split(",").map(t => t.trim()).filter(Boolean),
      });
      toast.success("Regla guardada");
      setNewPolicy({ name: "", description: "", triggers: "" });
      setShowPolicyForm(false);
      onReloadPolicies();
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
      onReloadPolicies();
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
      onReloadFaqs();
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
      onReloadFaqs();
    } catch {
      toast.error("Error al eliminar");
    }
  };

  return (
    <div className="grid grid-cols-2 gap-6">
      {/* Policies */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <SectionTitle>Reglas del bot</SectionTitle>
          <button
            onClick={() => setShowPolicyForm(v => !v)}
            className="text-xs text-amber-400 hover:text-amber-300 font-medium"
          >
            {showPolicyForm ? "Cancelar" : "+ Nueva regla"}
          </button>
        </div>

        {showPolicyForm && (
          <div className="bg-white/[0.04] border border-white/[0.08] rounded-xl p-4 mb-3 flex flex-col gap-2">
            <input
              className="bg-white/[0.04] border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-white placeholder-white/25 outline-none focus:border-amber-500/40 w-full"
              placeholder="Nombre de la regla"
              value={newPolicy.name}
              onChange={e => setNewPolicy(p => ({ ...p, name: e.target.value }))}
            />
            <textarea
              className="bg-white/[0.04] border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-white placeholder-white/25 outline-none focus:border-amber-500/40 w-full resize-none"
              placeholder="Descripción / instrucción para el bot"
              rows={2}
              value={newPolicy.description}
              onChange={e => setNewPolicy(p => ({ ...p, description: e.target.value }))}
            />
            <input
              className="bg-white/[0.04] border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-white placeholder-white/25 outline-none focus:border-amber-500/40 w-full"
              placeholder="Triggers (separados por coma)"
              value={newPolicy.triggers}
              onChange={e => setNewPolicy(p => ({ ...p, triggers: e.target.value }))}
            />
            <button
              onClick={savePolicy}
              disabled={saving || !newPolicy.name.trim()}
              className="bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-black text-sm font-semibold px-4 py-2 rounded-lg transition-colors"
            >
              Guardar regla
            </button>
          </div>
        )}

        {loadingPolicies ? (
          <div className="flex flex-col gap-2">
            {[1,2,3].map(i => <div key={i} className="h-16 bg-white/[0.03] rounded-xl animate-pulse" />)}
          </div>
        ) : policies.length === 0 ? (
          <div className="text-white/25 text-sm text-center py-6">Sin reglas configuradas</div>
        ) : (
          <div className="flex flex-col gap-2">
            {policies.map((p, i) => (
              <div key={p.id || i} className="bg-white/[0.03] border border-white/[0.06] rounded-xl px-4 py-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="text-sm font-medium text-white">{p.name}</div>
                    {p.description && (
                      <div className="text-xs text-white/40 mt-0.5 leading-relaxed">{p.description}</div>
                    )}
                    {p.triggers?.length > 0 && (
                      <div className="flex gap-1 flex-wrap mt-1.5">
                        {p.triggers.slice(0, 4).map((t, ti) => (
                          <span key={ti} className="text-[10px] bg-white/[0.05] text-white/40 px-1.5 py-0.5 rounded">
                            {t}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <button
                    onClick={() => deletePolicy(p.id)}
                    className="text-white/20 hover:text-red-400 text-lg leading-none flex-shrink-0 mt-0.5"
                  >
                    ×
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* FAQs */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <SectionTitle>FAQs del bot</SectionTitle>
          <button
            onClick={() => setShowFaqForm(v => !v)}
            className="text-xs text-amber-400 hover:text-amber-300 font-medium"
          >
            {showFaqForm ? "Cancelar" : "+ Nueva FAQ"}
          </button>
        </div>

        {showFaqForm && (
          <div className="bg-white/[0.04] border border-white/[0.08] rounded-xl p-4 mb-3 flex flex-col gap-2">
            <input
              className="bg-white/[0.04] border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-white placeholder-white/25 outline-none focus:border-amber-500/40 w-full"
              placeholder="Pregunta"
              value={newFaq.question}
              onChange={e => setNewFaq(p => ({ ...p, question: e.target.value }))}
            />
            <textarea
              className="bg-white/[0.04] border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-white placeholder-white/25 outline-none focus:border-amber-500/40 w-full resize-none"
              placeholder="Respuesta"
              rows={3}
              value={newFaq.answer}
              onChange={e => setNewFaq(p => ({ ...p, answer: e.target.value }))}
            />
            <button
              onClick={saveFaq}
              disabled={saving || !newFaq.question.trim() || !newFaq.answer.trim()}
              className="bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-black text-sm font-semibold px-4 py-2 rounded-lg transition-colors"
            >
              Guardar FAQ
            </button>
          </div>
        )}

        {faqs.length === 0 ? (
          <div className="text-white/25 text-sm text-center py-6">Sin FAQs configuradas</div>
        ) : (
          <div className="flex flex-col gap-2">
            {faqs.map((f, i) => (
              <div key={f.id || i} className="bg-white/[0.03] border border-white/[0.06] rounded-xl px-4 py-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="text-sm font-medium text-white">{f.question}</div>
                    <div className="text-xs text-white/40 mt-0.5 leading-relaxed">{f.answer}</div>
                  </div>
                  <button
                    onClick={() => deleteFaq(f.id)}
                    className="text-white/20 hover:text-red-400 text-lg leading-none flex-shrink-0 mt-0.5"
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
  );
}

// ─── Componente principal ─────────────────────────────────────────────────────

const TABS = [
  { id: "estado",     label: "Estado" },
  { id: "stock",      label: "Stock del bot" },
  { id: "playground", label: "Playground" },
  { id: "reglas",     label: "Reglas y FAQs" },
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

  // Loading states
  const [loadingDecisions, setLoadingDecisions]   = useState(false);
  const [loadingVehicles, setLoadingVehicles]     = useState(false);
  const [loadingPolicies, setLoadingPolicies]     = useState(false);

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

  // Cargar todo al montar
  useEffect(() => {
    loadDecisions();
    loadVehicles();
    loadPolicies();
    loadFaqs();
  }, [loadDecisions, loadVehicles, loadPolicies, loadFaqs]);

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
            <TabStock vehicles={vehicles} loadingVehicles={loadingVehicles} />
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
        </div>

      </div>
    </div>
  );
}
