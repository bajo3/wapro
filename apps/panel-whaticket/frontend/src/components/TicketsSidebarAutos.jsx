import React, { useContext, useEffect, useMemo, useState } from "react";
import { Search, SlidersHorizontal, X } from "lucide-react";
import api from "../services/api";
import toastError from "../errors/toastError";
import { AuthContext } from "../context/Auth/AuthContext";
import TicketListItemTailwind from "./TicketListItemTailwind";

const cn = (...classes) => classes.filter(Boolean).join(" ");

const TAB_STYLES = {
  queue:   "text-auto-pending border-auto-pending",
  working: "text-auto-open border-auto-open",
  closed:  "text-auto-hint border-auto-hint",
};

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

  const [loading, setLoading]       = useState(true);
  const [tickets, setTickets]       = useState([]);
  const [counts, setCounts]         = useState({ pending: 0, open: 0, closed: 0, total: 0 });
  const [queues, setQueues]         = useState([]);
  const [whatsapps, setWhatsapps]   = useState([]);
  const [filtersOpen, setFiltersOpen] = useState(() => {
    try { return localStorage.getItem("ticketsAutos.filtersOpen") === "1"; }
    catch { return false; }
  });

  const queueIdsParam = useMemo(() => {
    if (filters.queueId === "all") return JSON.stringify([]);
    return JSON.stringify([Number(filters.queueId)]);
  }, [filters.queueId]);

  const whatsappIdsParam = useMemo(() => {
    if (filters.whatsappId === "all") return JSON.stringify([]);
    return JSON.stringify([Number(filters.whatsappId)]);
  }, [filters.whatsappId]);

  const toggleFilters = () => {
    const next = !filtersOpen;
    setFiltersOpen(next);
    try { localStorage.setItem("ticketsAutos.filtersOpen", next ? "1" : "0"); } catch {}
  };

  // Load queues & whatsapps
  useEffect(() => {
    let mounted = true;
    const run = async () => {
      try {
        const [qRes, wRes] = await Promise.all([api.get("/queue"), api.get("/whatsapp")]);
        if (!mounted) return;
        setQueues(Array.isArray(qRes.data) ? qRes.data : []);
        setWhatsapps(Array.isArray(wRes.data) ? wRes.data : []);
      } catch (err) { toastError(err); }
    };
    run();
    return () => { mounted = false; };
  }, []);

  // Load counts
  useEffect(() => {
    let mounted = true;
    const run = async () => {
      try {
        const { data } = await api.get("/tickets/counts", {
          params: { queueIds: queueIdsParam, whatsappIds: whatsappIdsParam },
        });
        if (!mounted) return;
        setCounts({
          pending: Number(data?.pending || 0),
          open: Number(data?.open || 0),
          closed: Number(data?.closed || 0),
          total: Number(data?.total || 0),
        });
      } catch {}
    };
    run();
    return () => { mounted = false; };
  }, [queueIdsParam, whatsappIdsParam]);

  // Load tickets
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
            leadSource: filters.leadSource !== "all" ? filters.leadSource : undefined,
            pageNumber: 1,
          },
        });
        if (!mounted) return;
        setTickets(Array.isArray(data?.tickets) ? data.tickets : []);
      } catch (err) { toastError(err); }
      finally { if (mounted) setLoading(false); }
    };
    run();
    return () => { mounted = false; };
  }, [activeStatus, filters, queueIdsParam, whatsappIdsParam]);

  const countForTab = (key) => {
    if (key === "queue")   return counts.pending;
    if (key === "working") return counts.open;
    if (key === "closed")  return counts.closed;
    return 0;
  };

  return (
    <div className="flex h-full flex-col bg-auto-panel border border-auto-border rounded-auto-xl overflow-hidden">

      {/* Tabs */}
      <div className="flex border-b border-auto-border px-2 pt-1 gap-0.5">
        {statusTabs.map((tab) => {
          const isActive = activeTab === tab.key;
          const count = countForTab(tab.key);
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={cn(
                "flex items-center gap-1.5 px-3 py-2.5 text-[12px] font-medium border-b-2 transition-all duration-150",
                isActive
                  ? TAB_STYLES[tab.key] || "text-auto-accent border-auto-accent"
                  : "text-auto-hint border-transparent hover:text-auto-muted"
              )}
            >
              {tab.label}
              {count > 0 && (
                <span className={cn(
                  "rounded-full px-1.5 py-0.5 text-[10px] font-bold",
                  isActive
                    ? tab.key === "queue" ? "bg-amber-500/15 text-amber-400"
                      : tab.key === "working" ? "bg-green-500/15 text-green-400"
                      : "bg-white/10 text-white/40"
                    : "bg-white/[0.06] text-white/30"
                )}>
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Search + filter toggle */}
      <div className="px-3 pt-3 pb-2 flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-auto-hint pointer-events-none" />
          <input
            className="w-full h-8 bg-auto-panel2 border border-auto-border rounded-auto-md pl-8 pr-3 text-[13px] text-auto-text placeholder-auto-hint outline-none focus:border-auto-accent/50 transition-colors"
            placeholder="Buscar..."
            value={filters.search || ""}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <button
          onClick={toggleFilters}
          className={cn(
            "h-8 w-8 flex items-center justify-center rounded-auto-md border transition-colors",
            filtersOpen
              ? "bg-auto-accent/10 border-auto-accent/30 text-auto-accent"
              : "bg-auto-panel2 border-auto-border text-auto-hint hover:text-auto-muted"
          )}
          type="button"
          title="Filtros"
        >
          {filtersOpen ? <X className="h-3.5 w-3.5" /> : <SlidersHorizontal className="h-3.5 w-3.5" />}
        </button>
      </div>

      {/* Filters panel */}
      {filtersOpen && (
        <div className="px-3 pb-3 flex flex-col gap-2 border-b border-auto-border">
          <select
            value={filters.queueId}
            onChange={(e) => setQueueId(e.target.value)}
            className="h-8 w-full bg-auto-panel2 border border-auto-border rounded-auto-md px-3 text-[12px] text-auto-muted outline-none focus:border-auto-accent/50"
          >
            <option value="all">Todas las colas</option>
            {queues.map((q) => (
              <option key={q.id} value={q.id}>{q.name}</option>
            ))}
          </select>

          <select
            value={filters.whatsappId}
            onChange={(e) => setWhatsappId(e.target.value)}
            className="h-8 w-full bg-auto-panel2 border border-auto-border rounded-auto-md px-3 text-[12px] text-auto-muted outline-none focus:border-auto-accent/50"
          >
            <option value="all">Todos los WhatsApp</option>
            {whatsapps.map((w) => (
              <option key={w.id} value={w.id}>{w.name}</option>
            ))}
          </select>

          <select
            value={filters.leadSource}
            onChange={(e) => setLeadSource(e.target.value)}
            className="h-8 w-full bg-auto-panel2 border border-auto-border rounded-auto-md px-3 text-[12px] text-auto-muted outline-none focus:border-auto-accent/50"
          >
            <option value="all">Lead: todos</option>
            <option value="WEB">Web</option>
            <option value="IG">Instagram</option>
            <option value="FB">Facebook</option>
            <option value="REF">Referido</option>
          </select>
        </div>
      )}

      {/* Ticket list */}
      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2 flex flex-col gap-1.5 scrollbar-thin scrollbar-thumb-auto-border2">
        {loading ? (
          <>
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-[72px] rounded-auto-lg bg-auto-panel2 animate-pulse" />
            ))}
          </>
        ) : tickets.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <div className="w-10 h-10 rounded-full bg-auto-panel2 flex items-center justify-center mb-3">
              <Search className="h-4 w-4 text-auto-hint" />
            </div>
            <div className="text-sm text-auto-hint">Sin tickets en esta vista</div>
          </div>
        ) : (
          tickets.map((t) => (
            <TicketListItemTailwind
              key={t.id}
              ticket={t}
              isSelected={Number(ticketId) === t.id}
              onSelect={onSelectTicket}
              onAccept={onAcceptTicket}
            />
          ))
        )}
      </div>
    </div>
  );
}
