import React, { useContext, useEffect, useState } from "react";
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
  const [queues, setQueues] = useState([]);
  const [whatsapps, setWhatsapps] = useState([]);

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
            queueIds: filters.queueId !== "all" ? [filters.queueId] : undefined,
            whatsappIds:
              filters.whatsappId !== "all" ? [filters.whatsappId] : undefined,
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
  }, [activeStatus, filters.search, filters.queueId, filters.whatsappId]);

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
              {t.label}
            </button>
          );
        })}
      </div>

      {/* Filters */}
      <div className="space-y-3 border-b border-auto-border p-3">
        <input
          value={filters.search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar por nombre o mensaje…"
          className="h-10 w-full rounded-auto-md border border-auto-border bg-auto-panel px-3 text-sm text-auto-text outline-none placeholder:text-auto-muted focus:ring-2 focus:ring-auto-accent/40"
        />

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
        ) : tickets.length === 0 ? (
          <div className="p-6 text-center text-sm text-auto-muted">
            No hay tickets en esta vista.
          </div>
        ) : (
          <div className="space-y-2">
            {tickets.map((t) => (
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
