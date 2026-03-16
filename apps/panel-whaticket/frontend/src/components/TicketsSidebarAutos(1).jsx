import React, { useContext, useEffect, useMemo, useState } from "react";
import clsx from "clsx";

import api from "../services/api";
import toastError from "../errors/toastError";
import { AuthContext } from "../context/Auth/AuthContext";
import TicketListItemTailwind from "./TicketListItemTailwind";

const Select = ({ value, onChange, children }) => (
  <select
    value={value}
    onChange={(e) => onChange(e.target.value)}
    className="h-10 w-full rounded-auto-md border border-auto-border bg-auto-panel px-3 text-sm text-auto-text outline-none focus:ring-2 focus:ring-auto-accent/40"
  >
    {children}
  </select>
);

export default function TicketsSidebarAutos({
  activeTab,
  setActiveTab,
  statusTabs,
  ticketId,
  filters,
  setSearch,
  setQueueId,
  setWhatsappId,
  setLeadSource,
  onSelectTicket,
  onAcceptTicket,
  activeStatus,
}) {
  const { user } = useContext(AuthContext);

  const [loading, setLoading] = useState(true);
  const [tickets, setTickets] = useState([]);
  const [counts, setCounts] = useState({ pending: 0, open: 0, closed: 0, total: 0 });
  const [queues, setQueues] = useState([]);
  const [whatsapps, setWhatsapps] = useState([]);

  // Compact filters (collapse advanced controls)
  const [filtersOpen, setFiltersOpen] = useState(() => {
    try {
      return localStorage.getItem("ticketsAutos.filtersOpen") === "1";
    } catch {
      return false;
    }
  });

  const queueIdsParam = useMemo(() => {
    if (filters.queueId === "all") return JSON.stringify([]);
    return JSON.stringify([Number(filters.queueId)]);
  }, [filters.queueId]);

  const whatsappIdsParam = useMemo(() => {
    if (filters.whatsappId === "all") return JSON.stringify([]);
    return JSON.stringify([Number(filters.whatsappId)]);
  }, [filters.whatsappId]);


const queueLabel = useMemo(() => {
  if (filters.queueId === "all") return "Todas las colas";
  const q = queues.find((x) => String(x.id) === String(filters.queueId));
  return q?.name || "Cola";
}, [filters.queueId, queues]);

const whatsappLabel = useMemo(() => {
  if (filters.whatsappId === "all") return "Todos los WhatsApp";
  const w = whatsapps.find((x) => String(x.id) === String(filters.whatsappId));
  return w?.name || "WhatsApp";
}, [filters.whatsappId, whatsapps]);

const leadLabel = useMemo(() => {
  if (filters.leadSource === "all") return "Lead: todos";
  const v = String(filters.leadSource).toUpperCase();
  if (v === "IG") return "Lead: IG";
  if (v === "FB") return "Lead: FB";
  if (v === "WEB") return "Lead: Web";
  if (v === "REF") return "Lead: Ref";
  return `Lead: ${v}`;
}, [filters.leadSource]);

const toggleFilters = () => {
  const next = !filtersOpen;
  setFiltersOpen(next);
  try {
    localStorage.setItem("ticketsAutos.filtersOpen", next ? "1" : "0");
  } catch {}
};

// Metadata for selects

  useEffect(() => {
    let mounted = true;
    const run = async () => {
      try {
        const [qRes, wRes] = await Promise.all([
          api.get("/queue"),
          api.get("/whatsapp"),
        ]);
        if (!mounted) return;
        setQueues(Array.isArray(qRes.data) ? qRes.data : []);
        setWhatsapps(Array.isArray(wRes.data) ? wRes.data : []);
      } catch (err) {
        toastError(err);
      }
    };
    run();
    return () => {
      mounted = false;
    };
  }, []);

  // Tab counters
  useEffect(() => {
    let mounted = true;

    const run = async () => {
      try {
        const { data } = await api.get("/tickets/counts", {
          params: {
            queueIds: queueIdsParam,
            whatsappIds: whatsappIdsParam,
          },
        });
        if (!mounted) return;
        setCounts({
          pending: Number(data?.pending || 0),
          open: Number(data?.open || 0),
          closed: Number(data?.closed || 0),
          total: Number(data?.total || 0),
        });
      } catch (err) {
        // counts are non-critical
      }
    };

    run();
    return () => {
      mounted = false;
    };
  }, [queueIdsParam, whatsappIdsParam]);

  // Tickets list
  useEffect(() => {
    let mounted = true;
    setLoading(true);

    const run = async () => {
      try {
        const { data } = await api.get("/tickets", {
          params: {
            status: activeStatus,
            searchParam: filters.search || undefined,
            queueIds: queueIdsParam,
            whatsappIds: whatsappIdsParam,
          },
        });

        if (!mounted) return;

        const list = Array.isArray(data?.tickets)
          ? data.tickets
          : Array.isArray(data)
            ? data
            : [];
        setTickets(list);
      } catch (err) {
        toastError(err);
      } finally {
        if (mounted) setLoading(false);
      }
    };

    run();
    return () => {
      mounted = false;
    };
  }, [activeStatus, filters.search, queueIdsParam, whatsappIdsParam]);

  const visibleTickets = useMemo(() => {
    if (filters.leadSource === "all") return tickets;
    const target = String(filters.leadSource).toUpperCase();
    return tickets.filter((t) => {
      const ls = String(t?.contact?.leadSource || "").toUpperCase();
      return ls === target;
    });
  }, [tickets, filters.leadSource]);

  return (
    <div className="flex h-full flex-col rounded-auto-xl border border-auto-border bg-auto-panel shadow-auto-soft">
      {/* Title */}
      <div className="border-b border-auto-border p-4">
        <div className="text-sm font-semibold tracking-tight text-auto-text">Tickets</div>
        <div className="mt-1 text-xs text-auto-muted">Gestión de leads (Autos)</div>
      </div>

      {/* Tabs */}
      <div className="grid grid-cols-3 gap-2 border-b border-auto-border p-3">
        {statusTabs.map((t) => {
          const isActive = t.key === activeTab;
          const n = t.status === "pending" ? counts.pending : t.status === "open" ? counts.open : counts.closed;
          return (
            <button
              key={t.key}
              onClick={() => setActiveTab(t.key)}
              className={clsx(
                "h-9 rounded-auto-md text-xs font-medium transition",
                isActive
                  ? "bg-auto-accent text-white shadow-sm"
                  : "bg-auto-panel text-auto-muted hover:bg-auto-panel2"
              )}
              type="button"
            >
              <span className="flex items-center justify-center gap-2">
                <span>{t.label}</span>
                <span
                  className={clsx(
                    "inline-flex h-5 min-w-[20px] items-center justify-center rounded-full px-1.5 text-[11px]",
                    isActive ? "bg-white/20 text-white" : "bg-auto-panel2 text-auto-muted"
                  )}
                >
                  {n}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      {/* Filters */}
<div className="border-b border-auto-border p-2">
  <input
    value={filters.search}
    onChange={(e) => setSearch(e.target.value)}
    placeholder="Buscar…"
    className="h-9 w-full rounded-auto-md border border-auto-border bg-auto-panel px-3 text-sm text-auto-text outline-none placeholder:text-auto-muted focus:ring-2 focus:ring-auto-accent/40"
  />

  <div className="mt-2 flex items-center justify-between gap-2">
    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
      <span className="max-w-[140px] truncate rounded-full bg-auto-panel2 px-2 py-1 text-[11px] text-auto-muted">
        {queueLabel}
      </span>
      <span className="max-w-[140px] truncate rounded-full bg-auto-panel2 px-2 py-1 text-[11px] text-auto-muted">
        {whatsappLabel}
      </span>
      <span className="rounded-full bg-auto-panel2 px-2 py-1 text-[11px] text-auto-muted">
        {leadLabel}
      </span>
    </div>

    <button
      type="button"
      onClick={toggleFilters}
      className="h-8 shrink-0 rounded-auto-md border border-auto-border bg-auto-panel px-2 text-xs font-medium text-auto-text hover:bg-auto-panel2"
      title="Filtros"
    >
      {filtersOpen ? "Ocultar" : "Filtros"}
    </button>
  </div>

  {filtersOpen && (
    <div className="mt-2 space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <Select value={filters.queueId} onChange={setQueueId}>
          <option value="all">Todas las colas</option>
          {queues.map((q) => (
            <option key={q.id} value={String(q.id)}>
              {q.name}
            </option>
          ))}
        </Select>

        <Select value={filters.whatsappId} onChange={setWhatsappId}>
          <option value="all">Todos los WhatsApp</option>
          {whatsapps.map((w) => (
            <option key={w.id} value={String(w.id)}>
              {w.name}
            </option>
          ))}
        </Select>
      </div>

      <Select value={filters.leadSource} onChange={setLeadSource}>
        <option value="all">Lead Source (todos)</option>
        <option value="IG">Instagram</option>
        <option value="FB">Facebook</option>
        <option value="WEB">Web</option>
        <option value="REF">Referido</option>
      </Select>
    </div>
  )}
</div>

{/* List */}
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {loading ? (
          <div className="space-y-2 p-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <div
                key={i}
                className="h-16 animate-pulse rounded-auto-lg border border-auto-border bg-auto-panel2"
              />
            ))}
          </div>
        ) : visibleTickets.length === 0 ? (
          <div className="p-6 text-center text-sm text-auto-muted">
            No hay tickets en esta vista.
          </div>
        ) : (
          <div className="space-y-2">
            {visibleTickets.map((t) => (
              <TicketListItemTailwind
                key={t.id}
                ticket={t}
                isSelected={ticketId === t.id}
                onSelect={onSelectTicket}
                onAccept={(id) => onAcceptTicket(id, user?.id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
