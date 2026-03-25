import React, { useContext, useEffect, useMemo, useState } from "react";
import { Search, SlidersHorizontal, X } from "lucide-react";
import api from "../services/api";
import toastError from "../errors/toastError";
import { AuthContext } from "../context/Auth/AuthContext";
import TicketListItemTailwind from "./TicketListItemTailwind";

const cn = (...classes) => classes.filter(Boolean).join(" ");

const TAB_STYLES = {
  queue: {
    active: "border-auto-pending/40 bg-auto-pending/10 text-auto-pending",
    idle: "text-auto-muted hover:text-auto-text",
  },
  working: {
    active: "border-auto-open/40 bg-auto-open/10 text-auto-open",
    idle: "text-auto-muted hover:text-auto-text",
  },
  closed: {
    active: "border-auto-border2 bg-auto-surface text-auto-text",
    idle: "text-auto-muted hover:text-auto-text",
  },
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

  const [loading, setLoading] = useState(true);
  const [tickets, setTickets] = useState([]);
  const [counts, setCounts] = useState({ pending: 0, open: 0, closed: 0, total: 0 });
  const [queues, setQueues] = useState([]);
  const [whatsapps, setWhatsapps] = useState([]);
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

  const hasActiveFilters =
    Boolean(filters.search) ||
    filters.queueId !== "all" ||
    filters.whatsappId !== "all" ||
    filters.leadSource !== "all";

  const toggleFilters = () => {
    const nextValue = !filtersOpen;
    setFiltersOpen(nextValue);
    try {
      localStorage.setItem("ticketsAutos.filtersOpen", nextValue ? "1" : "0");
    } catch {
      // noop
    }
  };

  useEffect(() => {
    let mounted = true;

    const run = async () => {
      try {
        const [queuesResponse, whatsappsResponse] = await Promise.all([
          api.get("/queue"),
          api.get("/whatsapp"),
        ]);

        if (!mounted) return;
        setQueues(Array.isArray(queuesResponse.data) ? queuesResponse.data : []);
        setWhatsapps(Array.isArray(whatsappsResponse.data) ? whatsappsResponse.data : []);
      } catch (err) {
        toastError(err);
      }
    };

    run();
    return () => {
      mounted = false;
    };
  }, []);

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
      } catch {
        // noop
      }
    };

    run();
    return () => {
      mounted = false;
    };
  }, [queueIdsParam, whatsappIdsParam]);

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
  }, [activeStatus, filters, queueIdsParam, whatsappIdsParam]);

  const countForTab = (key) => {
    if (key === "queue") return counts.pending;
    if (key === "working") return counts.open;
    if (key === "closed") return counts.closed;
    return 0;
  };

  return (
    <aside className="flex h-full min-h-0 flex-col overflow-hidden rounded-auto-xl border border-auto-border bg-auto-panel shadow-auto-soft">
      <div className="border-b border-auto-border px-3 pb-3 pt-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-auto-muted">
              Tickets
            </div>
            <div className="mt-1 text-sm font-semibold text-auto-text">Gestión comercial</div>
          </div>
          <div className="rounded-full border border-auto-border bg-auto-surface px-2.5 py-1 text-[11px] text-auto-muted">
            {tickets.length} en vista
          </div>
        </div>

        <div className="mt-3 grid grid-cols-3 gap-2">
          {statusTabs.map((tab) => {
            const isActive = activeTab === tab.key;
            const styles = TAB_STYLES[tab.key] || TAB_STYLES.working;
            const count = countForTab(tab.key);

            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActiveTab(tab.key)}
                className={cn(
                  "rounded-auto-lg border px-2.5 py-2 text-left transition-colors",
                  isActive ? styles.active : `border-auto-border bg-auto-surface ${styles.idle}`
                )}
              >
                <div className="truncate text-[11px] font-semibold">{tab.label}</div>
                <div className="mt-1 text-[18px] font-semibold leading-none">{count}</div>
              </button>
            );
          })}
        </div>
      </div>

      <div className="border-b border-auto-border px-3 py-3">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-auto-hint" />
            <input
              className="h-10 w-full rounded-auto-lg border border-auto-border bg-auto-panel2 pl-9 pr-3 text-sm text-auto-text outline-none transition-colors placeholder:text-auto-hint focus:border-auto-accent/40"
              placeholder="Buscar nombre, número o mensaje..."
              value={filters.search || ""}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>

          <button
            onClick={toggleFilters}
            className={cn(
              "inline-flex h-10 w-10 items-center justify-center rounded-auto-lg border transition-colors",
              filtersOpen || hasActiveFilters
                ? "border-auto-accent/30 bg-auto-accent/10 text-auto-accent"
                : "border-auto-border bg-auto-panel2 text-auto-hint hover:text-auto-text"
            )}
            type="button"
            title="Filtros"
          >
            {filtersOpen ? <X className="h-4 w-4" /> : <SlidersHorizontal className="h-4 w-4" />}
          </button>
        </div>

        {hasActiveFilters ? (
          <div className="mt-2 text-[11px] text-auto-muted">Hay filtros aplicados sobre la bandeja.</div>
        ) : null}
      </div>

      {filtersOpen && (
        <div className="border-b border-auto-border px-3 py-3">
          <div className="grid gap-2">
            <select
              value={filters.queueId}
              onChange={(event) => setQueueId(event.target.value)}
              className="h-9 w-full rounded-auto-lg border border-auto-border bg-auto-panel2 px-3 text-xs text-auto-muted outline-none transition-colors focus:border-auto-accent/40"
            >
              <option value="all">Todas las colas</option>
              {queues.map((queue) => (
                <option key={queue.id} value={queue.id}>
                  {queue.name}
                </option>
              ))}
            </select>

            <select
              value={filters.whatsappId}
              onChange={(event) => setWhatsappId(event.target.value)}
              className="h-9 w-full rounded-auto-lg border border-auto-border bg-auto-panel2 px-3 text-xs text-auto-muted outline-none transition-colors focus:border-auto-accent/40"
            >
              <option value="all">Todos los WhatsApp</option>
              {whatsapps.map((whatsapp) => (
                <option key={whatsapp.id} value={whatsapp.id}>
                  {whatsapp.name}
                </option>
              ))}
            </select>

            <select
              value={filters.leadSource}
              onChange={(event) => setLeadSource(event.target.value)}
              className="h-9 w-full rounded-auto-lg border border-auto-border bg-auto-panel2 px-3 text-xs text-auto-muted outline-none transition-colors focus:border-auto-accent/40"
            >
              <option value="all">Todos los orígenes</option>
              <option value="WEB">Web</option>
              <option value="IG">Instagram</option>
              <option value="FB">Facebook</option>
              <option value="REF">Referido</option>
            </select>
          </div>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2 scrollbar-thin scrollbar-thumb-auto-border2">
        <div className="flex flex-col gap-2">
          {loading ? (
            [1, 2, 3, 4, 5, 6].map((index) => (
              <div key={index} className="h-[84px] animate-pulse rounded-auto-lg border border-auto-border bg-auto-panel2" />
            ))
          ) : tickets.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-auto-lg border border-dashed border-auto-border bg-auto-surface px-4 py-14 text-center">
              <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-full border border-auto-border bg-auto-panel2">
                <Search className="h-4 w-4 text-auto-hint" />
              </div>
              <div className="text-sm font-medium text-auto-text">No hay tickets en esta vista</div>
              <div className="mt-1 text-xs leading-5 text-auto-muted">
                Ajustá los filtros o cambiá de columna para encontrar la conversación.
              </div>
            </div>
          ) : (
            tickets.map((ticket) => (
              <TicketListItemTailwind
                key={ticket.id}
                ticket={ticket}
                isSelected={Number(ticketId) === ticket.id}
                onSelect={onSelectTicket}
                onAccept={(id) => onAcceptTicket?.(id, user?.id)}
              />
            ))
          )}
        </div>
      </div>
    </aside>
  );
}
