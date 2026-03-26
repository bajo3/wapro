import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useHistory } from "react-router-dom";
import {
  ChevronLeft,
  ChevronRight,
  DollarSign,
  EyeOff,
  RefreshCw,
  Search,
  Settings,
  Target,
  Timer,
  Trophy,
  XCircle,
} from "lucide-react";
import { toast } from "react-toastify";

import toastError from "../../errors/toastError";
import {
  createPipelineStage,
  deletePipelineStage,
  getPipelineBoard,
  listPipelineStages,
  updatePipelineStage,
  updateTicketStage,
  updateTicketValue,
} from "../../services/pipeline";

const LOOKBACK_OPTIONS = [
  { value: 30, label: "30 días" },
  { value: 60, label: "60 días" },
  { value: 90, label: "90 días" },
  { value: 120, label: "120 días" },
  { value: 180, label: "180 días" },
];

const CATEGORY_META = {
  OPEN: {
    label: "Abierto",
    chip: "bg-sky-500/10 text-sky-300 border-sky-500/20",
    dot: "bg-sky-400",
    card: "border-sky-500/12",
  },
  WON: {
    label: "Ganado",
    chip: "bg-green-500/10 text-green-300 border-green-500/20",
    dot: "bg-green-400",
    card: "border-green-500/12",
  },
  LOST: {
    label: "Perdido",
    chip: "bg-rose-500/10 text-rose-300 border-rose-500/20",
    dot: "bg-rose-400",
    card: "border-rose-500/12",
  },
};

const STALE_THRESHOLD_HOURS = 48;
const PREFS_KEY = "wapro.pipeline.preferences.v2";

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function moneyFmt(currency, value) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) return "—";
  return `${String(currency || "ARS").toUpperCase()} ${amount.toLocaleString("es-AR")}`;
}

function compactMoney(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) return "—";
  return amount.toLocaleString("es-AR");
}

function averageHours(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return 0;
  return Math.round((ms / (1000 * 60 * 60)) * 10) / 10;
}

function getStageAgeMs(ticket) {
  const changedAt = ticket?.stageChangedAt ? new Date(ticket.stageChangedAt).getTime() : null;
  if (!changedAt || Number.isNaN(changedAt)) return 0;
  return Math.max(0, Date.now() - changedAt);
}

function getUpdatedMs(ticket) {
  const updatedAt = ticket?.updatedAt ? new Date(ticket.updatedAt).getTime() : null;
  if (!updatedAt || Number.isNaN(updatedAt)) return 0;
  return Math.max(0, Date.now() - updatedAt);
}

function formatAge(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return "recién";
  const hours = Math.floor(ms / (1000 * 60 * 60));
  const days = Math.floor(hours / 24);
  if (days > 0) return `${days}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h`;
  const minutes = Math.max(1, Math.floor(ms / (1000 * 60)));
  return `${minutes} min`;
}

function statusTone(status) {
  const normalized = String(status || "").toLowerCase();
  if (normalized === "pending") return "bg-amber-500/10 text-amber-300 border-amber-500/20";
  if (normalized === "closed") return "bg-white/5 text-white/45 border-white/10";
  return "bg-green-500/10 text-green-300 border-green-500/20";
}

function readStoredPrefs() {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function MetricCard({ title, value, hint, icon }) {
  return (
    <div className="rounded-2xl border border-white/[0.08] bg-white/[0.03] p-4 shadow-auto-soft">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-[11px] uppercase tracking-[0.18em] text-white/35">{title}</div>
          <div className="mt-2 text-2xl font-semibold text-white">{value}</div>
          {hint ? <div className="mt-1 text-xs text-white/40">{hint}</div> : null}
        </div>
        <div className="rounded-xl border border-white/[0.08] bg-auto-panel2 p-2 text-auto-accent">{icon}</div>
      </div>
    </div>
  );
}

function StagePill({ stage, onClick, active }) {
  const meta = CATEGORY_META[String(stage?.category || "OPEN").toUpperCase()] || CATEGORY_META.OPEN;
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs transition-colors ${
        active
          ? "border-auto-accent/30 bg-auto-accent/10 text-auto-accent"
          : "border-white/[0.08] bg-white/[0.03] text-white/55 hover:border-white/[0.14] hover:text-white"
      }`}
    >
      <span className={`h-2 w-2 rounded-full ${meta.dot}`} />
      <span>{stage.name}</span>
    </button>
  );
}

export default function Pipeline() {
  const history = useHistory();
  const storedPrefs = useMemo(() => readStoredPrefs() || {}, []);

  const [loading, setLoading] = useState(false);
  const [board, setBoard] = useState({ stages: [], ticketsByStage: {}, lookbackDays: 120 });
  const [stages, setStages] = useState([]);
  const [stagesOpen, setStagesOpen] = useState(false);
  const [editingStage, setEditingStage] = useState(null);
  const [stageForm, setStageForm] = useState({ name: "", category: "OPEN", isDefault: false });
  const [savingStage, setSavingStage] = useState(false);

  const [query, setQuery] = useState(storedPrefs.query || "");
  const [categoryFilter, setCategoryFilter] = useState(storedPrefs.categoryFilter || "all");
  const [hideEmptyStages, setHideEmptyStages] = useState(Boolean(storedPrefs.hideEmptyStages));
  const [onlyWithValue, setOnlyWithValue] = useState(Boolean(storedPrefs.onlyWithValue));
  const [staleOnly, setStaleOnly] = useState(Boolean(storedPrefs.staleOnly));
  const [lookbackDays, setLookbackDays] = useState(Number(storedPrefs.lookbackDays) || 120);

  const boardScrollRef = useRef(null);
  const stageRefs = useRef({});

  const persistPrefs = useCallback((next) => {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(next));
    } catch {
      // noop
    }
  }, []);

  useEffect(() => {
    persistPrefs({ query, categoryFilter, hideEmptyStages, onlyWithValue, staleOnly, lookbackDays });
  }, [query, categoryFilter, hideEmptyStages, onlyWithValue, staleOnly, lookbackDays, persistPrefs]);

  const loadBoard = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getPipelineBoard({ lookbackDays });
      setBoard(data || { stages: [], ticketsByStage: {}, lookbackDays });
    } catch (error) {
      toastError(error);
    } finally {
      setLoading(false);
    }
  }, [lookbackDays]);

  const loadStages = useCallback(async () => {
    try {
      const data = await listPipelineStages();
      setStages(data?.stages || []);
    } catch (error) {
      toastError(error);
    }
  }, []);

  useEffect(() => {
    loadBoard();
  }, [loadBoard]);

  const metricsByStage = useMemo(() => {
    const result = {};

    for (const stage of board.stages || []) {
      const tickets = board.ticketsByStage?.[String(stage.id)] || [];
      let totalMs = 0;
      let withAge = 0;
      let sumARS = 0;
      let sumUSD = 0;
      let staleCount = 0;

      for (const ticket of tickets) {
        const ageMs = getStageAgeMs(ticket);
        if (ageMs > 0) {
          totalMs += ageMs;
          withAge += 1;
          if (String(stage.category || "OPEN").toUpperCase() === "OPEN" && ageMs >= STALE_THRESHOLD_HOURS * 60 * 60 * 1000) {
            staleCount += 1;
          }
        }

        const value = Number(ticket?.dealValue);
        if (Number.isFinite(value) && value > 0) {
          const currency = String(ticket?.dealCurrency || "ARS").toUpperCase();
          if (currency === "USD") sumUSD += value;
          else sumARS += value;
        }
      }

      result[stage.id] = {
        count: tickets.length,
        avgHours: withAge ? averageHours(totalMs / withAge) : 0,
        sumARS,
        sumUSD,
        staleCount,
      };
    }

    return result;
  }, [board]);

  const filteredStages = useMemo(() => {
    const normalizedQuery = normalizeText(query);

    return (board.stages || [])
      .filter((stage) => categoryFilter === "all" || String(stage.category || "OPEN").toLowerCase() === categoryFilter)
      .map((stage) => {
        const tickets = (board.ticketsByStage?.[String(stage.id)] || []).filter((ticket) => {
          const haystack = normalizeText(
            [
              ticket?.id,
              ticket?.status,
              ticket?.contact?.name,
              ticket?.contact?.number,
              ticket?.lastMessage,
              ticket?.pipelineStage?.name,
            ]
              .filter(Boolean)
              .join(" ")
          );

          const matchesQuery = !normalizedQuery || haystack.includes(normalizedQuery);
          const value = Number(ticket?.dealValue);
          const ageMs = getStageAgeMs(ticket);
          const hasValue = Number.isFinite(value) && value > 0;
          const isStale = String(stage.category || "OPEN").toUpperCase() === "OPEN" && ageMs >= STALE_THRESHOLD_HOURS * 60 * 60 * 1000;

          if (!matchesQuery) return false;
          if (onlyWithValue && !hasValue) return false;
          if (staleOnly && !isStale) return false;
          return true;
        });

        return {
          ...stage,
          filteredTickets: tickets,
          rawTickets: board.ticketsByStage?.[String(stage.id)] || [],
        };
      })
      .filter((stage) => !hideEmptyStages || stage.filteredTickets.length > 0);
  }, [board, categoryFilter, hideEmptyStages, onlyWithValue, query, staleOnly]);

  const boardMetrics = useMemo(() => {
    const allTickets = filteredStages.flatMap((stage) => stage.filteredTickets);
    const openStages = filteredStages.filter((stage) => String(stage.category || "OPEN").toUpperCase() === "OPEN");
    const openTickets = openStages.flatMap((stage) => stage.filteredTickets);

    const totalARS = openTickets.reduce((acc, ticket) => {
      const value = Number(ticket?.dealValue);
      const currency = String(ticket?.dealCurrency || "ARS").toUpperCase();
      return Number.isFinite(value) && value > 0 && currency !== "USD" ? acc + value : acc;
    }, 0);

    const totalUSD = openTickets.reduce((acc, ticket) => {
      const value = Number(ticket?.dealValue);
      const currency = String(ticket?.dealCurrency || "ARS").toUpperCase();
      return Number.isFinite(value) && value > 0 && currency === "USD" ? acc + value : acc;
    }, 0);

    const staleTickets = openTickets.filter((ticket) => getStageAgeMs(ticket) >= STALE_THRESHOLD_HOURS * 60 * 60 * 1000);
    const noValueTickets = openTickets.filter((ticket) => {
      const value = Number(ticket?.dealValue);
      return !Number.isFinite(value) || value <= 0;
    });

    const avgAgeMs = openTickets.length
      ? openTickets.reduce((acc, ticket) => acc + getStageAgeMs(ticket), 0) / openTickets.length
      : 0;

    return {
      totalTickets: allTickets.length,
      openTickets: openTickets.length,
      wonTickets: filteredStages
        .filter((stage) => String(stage.category || "OPEN").toUpperCase() === "WON")
        .reduce((acc, stage) => acc + stage.filteredTickets.length, 0),
      lostTickets: filteredStages
        .filter((stage) => String(stage.category || "OPEN").toUpperCase() === "LOST")
        .reduce((acc, stage) => acc + stage.filteredTickets.length, 0),
      totalARS,
      totalUSD,
      staleTickets: staleTickets.length,
      noValueTickets: noValueTickets.length,
      avgAge: formatAge(avgAgeMs),
    };
  }, [filteredStages]);

  const openStagesModal = async () => {
    await loadStages();
    setStagesOpen(true);
  };

  const resetStageForm = () => {
    setEditingStage(null);
    setStageForm({ name: "", category: "OPEN", isDefault: false });
  };

  const submitStage = async () => {
    if (!String(stageForm.name || "").trim()) return;
    setSavingStage(true);
    try {
      const payload = {
        name: String(stageForm.name || "").trim(),
        category: String(stageForm.category || "OPEN").toUpperCase(),
        isDefault: !!stageForm.isDefault,
      };

      if (editingStage?.id) {
        await updatePipelineStage(editingStage.id, payload);
        toast.success("Etapa actualizada");
      } else {
        await createPipelineStage(payload);
        toast.success("Etapa creada");
      }

      resetStageForm();
      await Promise.all([loadStages(), loadBoard()]);
    } catch (error) {
      toastError(error);
    } finally {
      setSavingStage(false);
    }
  };

  const moveStageOrder = async (stage, direction) => {
    try {
      const index = stages.findIndex((item) => item.id === stage.id);
      const targetIndex = index + direction;
      if (targetIndex < 0 || targetIndex >= stages.length) return;
      const other = stages[targetIndex];
      await updatePipelineStage(stage.id, { order: other.order });
      await updatePipelineStage(other.id, { order: stage.order });
      await Promise.all([loadStages(), loadBoard()]);
    } catch (error) {
      toastError(error);
    }
  };

  const setDefaultStage = async (stage) => {
    try {
      await updatePipelineStage(stage.id, { isDefault: true });
      toast.success("Etapa por defecto actualizada");
      await Promise.all([loadStages(), loadBoard()]);
    } catch (error) {
      toastError(error);
    }
  };

  const removeStage = async (stage) => {
    try {
      await deletePipelineStage(stage.id);
      toast.success("Etapa eliminada");
      await Promise.all([loadStages(), loadBoard()]);
    } catch (error) {
      toastError(error);
    }
  };

  const onDragStart = (event, ticketId, fromStageId) => {
    event.dataTransfer.setData("text/plain", JSON.stringify({ ticketId, fromStageId }));
    event.dataTransfer.effectAllowed = "move";
  };

  const onDrop = async (event, toStageId) => {
    event.preventDefault();
    try {
      const raw = event.dataTransfer.getData("text/plain");
      if (!raw) return;
      const { ticketId } = JSON.parse(raw);
      if (!ticketId) return;
      await updateTicketStage(ticketId, toStageId);
      toast.success("Ticket movido");
      await loadBoard();
    } catch (error) {
      toastError(error);
    }
  };

  const moveTicketToRelativeStage = async (ticket, offset) => {
    const index = (board.stages || []).findIndex((stage) => stage.id === ticket?.pipelineStageId);
    if (index < 0) return;
    const target = board.stages[index + offset];
    if (!target) return;

    try {
      await updateTicketStage(ticket.id, target.id);
      toast.success(`Movido a ${target.name}`);
      await loadBoard();
    } catch (error) {
      toastError(error);
    }
  };

  const saveTicketValue = async (ticket, rawValue, rawCurrency) => {
    try {
      const normalizedValue = rawValue === "" || rawValue === null || rawValue === undefined ? null : Number(rawValue);
      await updateTicketValue(ticket.id, {
        dealValue: normalizedValue,
        dealCurrency: rawCurrency,
      });
      toast.success("Valor actualizado");
      await loadBoard();
    } catch (error) {
      toastError(error);
    }
  };

  const scrollToStage = (stageId) => {
    const el = stageRefs.current?.[stageId];
    if (el) {
      el.scrollIntoView({ behavior: "smooth", inline: "start", block: "nearest" });
    }
  };

  return (
    <div className="min-h-screen bg-auto-surface p-6 text-auto-text">
      <div className="mx-auto flex max-w-[1880px] flex-col gap-5">
        <div className="rounded-[24px] border border-white/[0.08] bg-auto-panel p-5 shadow-auto-soft">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-white/35">Pipeline comercial</div>
              <div className="mt-2 text-[28px] font-semibold tracking-tight text-white">Embudo más simple y operativo</div>
              <div className="mt-2 max-w-3xl text-sm leading-6 text-white/45">
                Mejoré la vista para gestionar leads más rápido: filtros persistentes, alertas de oportunidades frías,
                navegación por etapas y movimientos rápidos sin depender solo de drag & drop.
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={loadBoard}
                disabled={loading}
                className="inline-flex items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.03] px-4 py-2 text-sm text-white transition-colors hover:bg-white/[0.06] disabled:opacity-50"
              >
                <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
                Refrescar
              </button>
              <button
                type="button"
                onClick={() => {
                  const element = boardScrollRef.current;
                  if (!element) return;
                  element.scrollTo({ left: element.scrollWidth, behavior: "smooth" });
                }}
                className="inline-flex items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.03] px-4 py-2 text-sm text-white transition-colors hover:bg-white/[0.06]"
              >
                Ir al final
              </button>
              <button
                type="button"
                onClick={openStagesModal}
                className="inline-flex items-center gap-2 rounded-xl bg-amber-500 px-4 py-2 text-sm font-semibold text-black transition-colors hover:bg-amber-400"
              >
                <Settings className="h-4 w-4" />
                Etapas
              </button>
            </div>
          </div>

          <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-5">
            <MetricCard
              title="Leads visibles"
              value={boardMetrics.totalTickets || "0"}
              hint={`${boardMetrics.openTickets} abiertos · ${boardMetrics.wonTickets} ganados`}
              icon={<Target className="h-5 w-5" />}
            />
            <MetricCard
              title="Oportunidades frías"
              value={boardMetrics.staleTickets || "0"}
              hint={`más de ${STALE_THRESHOLD_HOURS}h sin salir de etapa`}
              icon={<Timer className="h-5 w-5" />}
            />
            <MetricCard
              title="Sin valor cargado"
              value={boardMetrics.noValueTickets || "0"}
              hint="leads abiertos que todavía no tienen monto"
              icon={<DollarSign className="h-5 w-5" />}
            />
            <MetricCard
              title="Potencial ARS"
              value={moneyFmt("ARS", boardMetrics.totalARS)}
              hint={boardMetrics.totalUSD > 0 ? `+ ${moneyFmt("USD", boardMetrics.totalUSD)}` : "solo etapas abiertas"}
              icon={<Trophy className="h-5 w-5" />}
            />
            <MetricCard
              title="Edad promedio"
              value={boardMetrics.avgAge}
              hint="tiempo promedio en etapas abiertas"
              icon={<Timer className="h-5 w-5" />}
            />
          </div>
        </div>

        <div className="rounded-[24px] border border-white/[0.08] bg-auto-panel p-4 shadow-auto-soft">
          <div className="grid grid-cols-1 gap-3 xl:grid-cols-[1.4fr_repeat(4,minmax(0,1fr))]">
            <label className="group flex items-center gap-3 rounded-2xl border border-white/[0.08] bg-white/[0.03] px-4 py-3 transition-colors focus-within:border-auto-accent/35">
              <Search className="h-4 w-4 text-white/35" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                className="w-full bg-transparent text-sm text-white outline-none placeholder:text-white/25"
                placeholder="Buscar por contacto, ticket, estado o mensaje"
              />
            </label>

            <select
              value={lookbackDays}
              onChange={(event) => setLookbackDays(Number(event.target.value) || 120)}
              className="rounded-2xl border border-white/[0.08] bg-white/[0.03] px-4 py-3 text-sm text-white outline-none"
            >
              {LOOKBACK_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  Ventana {option.label}
                </option>
              ))}
            </select>

            <select
              value={categoryFilter}
              onChange={(event) => setCategoryFilter(event.target.value)}
              className="rounded-2xl border border-white/[0.08] bg-white/[0.03] px-4 py-3 text-sm text-white outline-none"
            >
              <option value="all">Todas las categorías</option>
              <option value="open">Solo abiertas</option>
              <option value="won">Solo ganadas</option>
              <option value="lost">Solo perdidas</option>
            </select>

            <button
              type="button"
              onClick={() => setHideEmptyStages((value) => !value)}
              className={`inline-flex items-center justify-center gap-2 rounded-2xl border px-4 py-3 text-sm transition-colors ${
                hideEmptyStages
                  ? "border-auto-accent/30 bg-auto-accent/10 text-auto-accent"
                  : "border-white/[0.08] bg-white/[0.03] text-white/55 hover:text-white"
              }`}
            >
              <EyeOff className="h-4 w-4" />
              Ocultar vacías
            </button>

            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setOnlyWithValue((value) => !value)}
                className={`rounded-2xl border px-4 py-3 text-sm transition-colors ${
                  onlyWithValue
                    ? "border-auto-accent/30 bg-auto-accent/10 text-auto-accent"
                    : "border-white/[0.08] bg-white/[0.03] text-white/55 hover:text-white"
                }`}
              >
                Con valor
              </button>
              <button
                type="button"
                onClick={() => setStaleOnly((value) => !value)}
                className={`rounded-2xl border px-4 py-3 text-sm transition-colors ${
                  staleOnly
                    ? "border-auto-accent/30 bg-auto-accent/10 text-auto-accent"
                    : "border-white/[0.08] bg-white/[0.03] text-white/55 hover:text-white"
                }`}
              >
                Solo fríos
              </button>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            {(filteredStages || []).map((stage) => (
              <StagePill
                key={stage.id}
                stage={stage}
                onClick={() => scrollToStage(stage.id)}
                active={false}
              />
            ))}
          </div>
        </div>

        {(boardMetrics.staleTickets > 0 || boardMetrics.noValueTickets > 0) && (
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <div className="rounded-2xl border border-amber-500/15 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
              <div className="font-semibold">Atención comercial</div>
              <div className="mt-1 text-amber-100/80">
                Tenés {boardMetrics.staleTickets} leads en etapas abiertas con más de {STALE_THRESHOLD_HOURS} horas.
              </div>
            </div>
            <div className="rounded-2xl border border-sky-500/15 bg-sky-500/10 px-4 py-3 text-sm text-sky-200">
              <div className="font-semibold">Dato faltante</div>
              <div className="mt-1 text-sky-100/80">
                Hay {boardMetrics.noValueTickets} oportunidades abiertas sin valor cargado. Eso complica medir el embudo.
              </div>
            </div>
          </div>
        )}

        <div
          ref={boardScrollRef}
          className="flex gap-4 overflow-x-auto pb-2"
        >
          {filteredStages.map((stage) => {
            const meta = CATEGORY_META[String(stage.category || "OPEN").toUpperCase()] || CATEGORY_META.OPEN;
            const metrics = metricsByStage[stage.id] || { count: 0, avgHours: 0, sumARS: 0, sumUSD: 0, staleCount: 0 };
            return (
              <section
                key={stage.id}
                ref={(element) => {
                  if (element) stageRefs.current[stage.id] = element;
                }}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => onDrop(event, stage.id)}
                className={`flex min-h-[600px] w-[360px] shrink-0 flex-col rounded-[24px] border bg-auto-panel p-4 shadow-auto-soft ${meta.card}`}
              >
                <div className="border-b border-white/[0.06] pb-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className={`h-2.5 w-2.5 rounded-full ${meta.dot}`} />
                        <h2 className="text-lg font-semibold text-white">{stage.name}</h2>
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${meta.chip}`}>
                          {meta.label}
                        </span>
                        <span className="rounded-full border border-white/[0.08] bg-white/[0.03] px-2.5 py-1 text-[11px] text-white/45">
                          {stage.filteredTickets.length} visibles · {stage.rawTickets.length} totales
                        </span>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => scrollToStage(stage.id)}
                      className="rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-xs text-white/55 transition-colors hover:bg-white/[0.06] hover:text-white"
                    >
                      Ver
                    </button>
                  </div>

                  <div className="mt-4 grid grid-cols-2 gap-2">
                    <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 py-2">
                      <div className="text-[10px] uppercase tracking-[0.18em] text-white/30">Promedio</div>
                      <div className="mt-1 text-sm font-medium text-white">{metrics.avgHours ? `${metrics.avgHours}h` : "—"}</div>
                    </div>
                    <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 py-2">
                      <div className="text-[10px] uppercase tracking-[0.18em] text-white/30">Potencial</div>
                      <div className="mt-1 text-sm font-medium text-white">
                        {metrics.sumUSD > 0 ? moneyFmt("USD", metrics.sumUSD) : moneyFmt("ARS", metrics.sumARS)}
                      </div>
                    </div>
                  </div>

                  {metrics.staleCount > 0 ? (
                    <div className="mt-3 rounded-xl border border-amber-500/15 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                      {metrics.staleCount} lead{metrics.staleCount === 1 ? "" : "s"} necesita{metrics.staleCount === 1 ? "" : "n"} seguimiento.
                    </div>
                  ) : null}
                </div>

                <div className="mt-4 flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pr-1">
                  {stage.filteredTickets.length === 0 ? (
                    <div className="flex flex-1 items-center justify-center rounded-2xl border border-dashed border-white/[0.1] bg-white/[0.02] px-4 py-8 text-center text-sm text-white/30">
                      No hay tickets visibles en esta etapa con los filtros actuales.
                    </div>
                  ) : (
                    stage.filteredTickets.map((ticket) => {
                      const stageAgeMs = getStageAgeMs(ticket);
                      const updatedMs = getUpdatedMs(ticket);
                      const isStale =
                        String(stage.category || "OPEN").toUpperCase() === "OPEN" &&
                        stageAgeMs >= STALE_THRESHOLD_HOURS * 60 * 60 * 1000;
                      const value = Number(ticket?.dealValue);
                      const currency = String(ticket?.dealCurrency || "ARS").toUpperCase();
                      const hasValue = Number.isFinite(value) && value > 0;

                      return (
                        <article
                          key={ticket.id}
                          draggable
                          onDragStart={(event) => onDragStart(event, ticket.id, stage.id)}
                          className={`rounded-2xl border bg-white/[0.03] p-4 transition-colors hover:border-white/[0.14] ${
                            isStale ? "border-amber-500/20" : "border-white/[0.08]"
                          }`}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="truncate text-sm font-semibold text-white">
                                {ticket?.contact?.name || "Contacto"}
                              </div>
                              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                                <span className={`rounded-full border px-2 py-0.5 text-[10px] ${statusTone(ticket?.status)}`}>
                                  {ticket?.status || "open"}
                                </span>
                                <span className="rounded-full border border-white/[0.08] bg-auto-surface px-2 py-0.5 text-[10px] text-white/45">
                                  #{ticket.id}
                                </span>
                                {isStale ? (
                                  <span className="rounded-full border border-amber-500/20 bg-amber-500/10 px-2 py-0.5 text-[10px] text-amber-300">
                                    Frío
                                  </span>
                                ) : null}
                              </div>
                            </div>

                            <button
                              type="button"
                              onClick={() => history.push(`/tickets/${ticket.id}`)}
                              className="rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-xs text-white/55 transition-colors hover:bg-white/[0.06] hover:text-white"
                            >
                              Abrir
                            </button>
                          </div>

                          <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-white/40">
                            <div className="rounded-xl border border-white/[0.06] bg-auto-surface px-3 py-2">
                              <div className="uppercase tracking-[0.16em] text-white/25">Etapa</div>
                              <div className="mt-1 text-white/70">{formatAge(stageAgeMs)}</div>
                            </div>
                            <div className="rounded-xl border border-white/[0.06] bg-auto-surface px-3 py-2">
                              <div className="uppercase tracking-[0.16em] text-white/25">Actualizado</div>
                              <div className="mt-1 text-white/70">{formatAge(updatedMs)}</div>
                            </div>
                          </div>

                          <div className="mt-3 grid grid-cols-[1fr_110px] gap-2">
                            <input
                              type="number"
                              defaultValue={hasValue ? value : ""}
                              placeholder="Valor estimado"
                              onBlur={(event) => saveTicketValue(ticket, event.target.value, currency)}
                              className="rounded-xl border border-white/[0.08] bg-auto-surface px-3 py-2 text-sm text-white outline-none placeholder:text-white/20 focus:border-auto-accent/35"
                            />
                            <select
                              defaultValue={currency}
                              onChange={(event) => saveTicketValue(ticket, hasValue ? value : null, event.target.value)}
                              className="rounded-xl border border-white/[0.08] bg-auto-surface px-3 py-2 text-sm text-white outline-none focus:border-auto-accent/35"
                            >
                              <option value="ARS">ARS</option>
                              <option value="USD">USD</option>
                            </select>
                          </div>

                          <div className="mt-2 text-xs text-white/45">
                            {hasValue ? `${currency} ${compactMoney(value)}` : "Sin valor cargado"}
                          </div>

                          <div className="mt-4 flex items-center justify-between gap-2">
                            <button
                              type="button"
                              onClick={() => moveTicketToRelativeStage(ticket, -1)}
                              disabled={(board.stages || []).findIndex((item) => item.id === stage.id) === 0}
                              className="inline-flex items-center gap-1 rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-xs text-white/55 transition-colors hover:bg-white/[0.06] hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
                            >
                              <ChevronLeft className="h-4 w-4" />
                              Anterior
                            </button>
                            <button
                              type="button"
                              onClick={() => moveTicketToRelativeStage(ticket, 1)}
                              disabled={(board.stages || []).findIndex((item) => item.id === stage.id) === (board.stages || []).length - 1}
                              className="inline-flex items-center gap-1 rounded-xl border border-auto-accent/20 bg-auto-accent/10 px-3 py-2 text-xs text-auto-accent transition-colors hover:bg-auto-accent/15 disabled:cursor-not-allowed disabled:opacity-30"
                            >
                              Siguiente
                              <ChevronRight className="h-4 w-4" />
                            </button>
                          </div>
                        </article>
                      );
                    })
                  )}
                </div>
              </section>
            );
          })}
        </div>
      </div>

      {stagesOpen ? (
        <div className="fixed inset-0 z-[1300] flex items-center justify-center bg-black/65 p-4 backdrop-blur-sm">
          <div className="max-h-[90vh] w-full max-w-4xl overflow-hidden rounded-[28px] border border-white/[0.08] bg-auto-panel shadow-auto-soft">
            <div className="flex items-center justify-between border-b border-white/[0.08] px-6 py-4">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-white/35">Configuración</div>
                <div className="mt-1 text-xl font-semibold text-white">Etapas del pipeline</div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setStagesOpen(false);
                  resetStageForm();
                }}
                className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-2 text-white/55 transition-colors hover:bg-white/[0.06] hover:text-white"
              >
                <XCircle className="h-5 w-5" />
              </button>
            </div>

            <div className="grid max-h-[calc(90vh-74px)] grid-cols-[1fr_1.15fr] gap-0 overflow-hidden">
              <div className="border-r border-white/[0.08] px-6 py-5">
                <div className="text-sm font-semibold text-white">Alta rápida</div>
                <div className="mt-1 text-sm text-white/40">Creá o editá etapas sin salir del tablero.</div>

                <div className="mt-4 flex flex-col gap-3">
                  <input
                    value={stageForm.name}
                    onChange={(event) => setStageForm((prev) => ({ ...prev, name: event.target.value }))}
                    placeholder="Nombre de la etapa"
                    className="rounded-2xl border border-white/[0.08] bg-white/[0.03] px-4 py-3 text-sm text-white outline-none placeholder:text-white/20 focus:border-auto-accent/35"
                  />

                  <select
                    value={stageForm.category}
                    onChange={(event) => setStageForm((prev) => ({ ...prev, category: event.target.value }))}
                    className="rounded-2xl border border-white/[0.08] bg-white/[0.03] px-4 py-3 text-sm text-white outline-none focus:border-auto-accent/35"
                  >
                    <option value="OPEN">Abierta</option>
                    <option value="WON">Ganada</option>
                    <option value="LOST">Perdida</option>
                  </select>

                  <label className="inline-flex items-center gap-2 rounded-2xl border border-white/[0.08] bg-white/[0.03] px-4 py-3 text-sm text-white/70">
                    <input
                      type="checkbox"
                      checked={Boolean(stageForm.isDefault)}
                      onChange={(event) => setStageForm((prev) => ({ ...prev, isDefault: event.target.checked }))}
                    />
                    Usar como etapa por defecto
                  </label>

                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={submitStage}
                      disabled={savingStage || !String(stageForm.name || "").trim()}
                      className="flex-1 rounded-2xl bg-amber-500 px-4 py-3 text-sm font-semibold text-black transition-colors hover:bg-amber-400 disabled:opacity-40"
                    >
                      {savingStage ? "Guardando..." : editingStage ? "Guardar cambios" : "Crear etapa"}
                    </button>
                    <button
                      type="button"
                      onClick={resetStageForm}
                      className="rounded-2xl border border-white/[0.08] bg-white/[0.03] px-4 py-3 text-sm text-white/65 transition-colors hover:bg-white/[0.06] hover:text-white"
                    >
                      Limpiar
                    </button>
                  </div>
                </div>
              </div>

              <div className="overflow-y-auto px-6 py-5">
                <div className="text-sm font-semibold text-white">Etapas actuales</div>
                <div className="mt-1 text-sm text-white/40">Reordená, definí default o corregí categorías.</div>

                <div className="mt-4 flex flex-col gap-3">
                  {(stages || []).map((stage, index) => {
                    const meta = CATEGORY_META[String(stage.category || "OPEN").toUpperCase()] || CATEGORY_META.OPEN;
                    return (
                      <div key={stage.id} className="rounded-2xl border border-white/[0.08] bg-white/[0.03] p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="flex items-center gap-2">
                              <span className={`h-2.5 w-2.5 rounded-full ${meta.dot}`} />
                              <div className="text-sm font-semibold text-white">{stage.name}</div>
                              {stage.isDefault ? (
                                <span className="rounded-full border border-auto-accent/20 bg-auto-accent/10 px-2 py-0.5 text-[10px] font-semibold text-auto-accent">
                                  Default
                                </span>
                              ) : null}
                            </div>
                            <div className="mt-1 text-xs text-white/40">
                              {meta.label} · orden {stage.order}
                            </div>
                          </div>

                          <div className="flex flex-wrap items-center gap-2">
                            <button
                              type="button"
                              onClick={() => moveStageOrder(stage, -1)}
                              disabled={index === 0}
                              className="rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-xs text-white/55 transition-colors hover:bg-white/[0.06] hover:text-white disabled:opacity-25"
                            >
                              ↑
                            </button>
                            <button
                              type="button"
                              onClick={() => moveStageOrder(stage, 1)}
                              disabled={index === stages.length - 1}
                              className="rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-xs text-white/55 transition-colors hover:bg-white/[0.06] hover:text-white disabled:opacity-25"
                            >
                              ↓
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setEditingStage(stage);
                                setStageForm({
                                  name: stage.name,
                                  category: String(stage.category || "OPEN").toUpperCase(),
                                  isDefault: !!stage.isDefault,
                                });
                              }}
                              className="rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-xs text-white/55 transition-colors hover:bg-white/[0.06] hover:text-white"
                            >
                              Editar
                            </button>
                            <button
                              type="button"
                              onClick={() => setDefaultStage(stage)}
                              className="rounded-xl border border-auto-accent/20 bg-auto-accent/10 px-3 py-2 text-xs text-auto-accent transition-colors hover:bg-auto-accent/15"
                            >
                              Default
                            </button>
                            <button
                              type="button"
                              onClick={() => removeStage(stage)}
                              className="rounded-xl border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-xs text-rose-300 transition-colors hover:bg-rose-500/15"
                            >
                              Eliminar
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
