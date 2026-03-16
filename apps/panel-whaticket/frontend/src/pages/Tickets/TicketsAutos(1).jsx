import React, { useEffect, useMemo, useRef, useState } from "react";
import { useHistory, useParams } from "react-router-dom";
import clsx from "clsx";

import TicketsSidebarAutos from "../../components/TicketsSidebarAutos";
import TicketsHeaderAutos from "../../components/TicketsHeaderAutos";
import Ticket from "../../components/Ticket";
import api from "../../services/api";
import toastError from "../../errors/toastError";

const STATUS_TABS = [
  { key: "queue", label: "Cola", status: "pending" },
  { key: "working", label: "Trabajando", status: "open" },
  { key: "closed", label: "Cerrados", status: "closed" },
];

export default function TicketsAutos() {
  const history = useHistory();
  const { ticketId } = useParams();

  const [activeTab, setActiveTab] = useState("queue");
  const [search, setSearch] = useState("");
  const [queueId, setQueueId] = useState("all");
  const [whatsappId, setWhatsappId] = useState("all");
  const [leadSource, setLeadSource] = useState("all");
  const [refreshKey, setRefreshKey] = useState(0);

  // Layout state
  const [sidebarVisible, setSidebarVisible] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const v = Number(localStorage.getItem("ticketsAutos.sidebarWidth") || 340);
    return Number.isFinite(v) ? v : 340;
  });
  const dragRef = useRef({ dragging: false, startX: 0, startW: 340 });

  const activeStatus = useMemo(() => {
    return STATUS_TABS.find((t) => t.key === activeTab)?.status || "pending";
  }, [activeTab]);

  const filters = useMemo(
    () => ({ search, queueId, whatsappId, leadSource }),
    [search, queueId, whatsappId, leadSource]
  );

  const handleSelectTicket = (id) => history.push(`/tickets/${id}`);

  const handleAcceptTicket = async (id, userId) => {
    // optimistic navigation
    history.push(`/tickets/${id}`);
    try {
      await api.put(`/tickets/${id}`, { status: "open", userId });
      setActiveTab("working");
      setRefreshKey((k) => k + 1);
    } catch (err) {
      toastError(err);
    }
  };

  const onRefresh = () => setRefreshKey((k) => k + 1);

  const numericTicketId = ticketId ? Number(ticketId) : null;

  const startDrag = (e) => {
    if (!sidebarVisible) return;
    dragRef.current = { dragging: true, startX: e.clientX, startW: sidebarWidth };
    document.body.style.userSelect = "none";
  };

  useEffect(() => {
    const onMove = (e) => {
      if (!dragRef.current.dragging) return;
      const dx = e.clientX - dragRef.current.startX;
      const next = Math.min(520, Math.max(280, dragRef.current.startW + dx));
      setSidebarWidth(next);
    };
    const onUp = () => {
      if (!dragRef.current.dragging) return;
      dragRef.current.dragging = false;
      document.body.style.userSelect = "";
      localStorage.setItem("ticketsAutos.sidebarWidth", String(sidebarWidth));
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [sidebarWidth]);

  return (
    <div className="h-[calc(100%-48px)] w-full bg-auto-surface text-auto-text">
      <div className="mx-auto flex h-full max-w-[1800px] gap-3 p-3">
        {/* Sidebar (hide on mobile when a ticket is selected) */}
        {sidebarVisible && (
          <div
            className={clsx(
              "shrink-0",
              numericTicketId ? "hidden md:block" : "block"
            )}
            style={{ width: sidebarWidth }}
          >
            <TicketsSidebarAutos
              key={refreshKey}
              activeTab={activeTab}
              setActiveTab={setActiveTab}
              statusTabs={STATUS_TABS}
              ticketId={numericTicketId}
              filters={filters}
              setSearch={setSearch}
              setQueueId={setQueueId}
              setWhatsappId={setWhatsappId}
              setLeadSource={setLeadSource}
              onSelectTicket={handleSelectTicket}
              onAcceptTicket={handleAcceptTicket}
              activeStatus={activeStatus}
            />
          </div>
        )}

        {/* Drag handle to resize sidebar */}
        {sidebarVisible && (
          <div
            className="hidden md:block w-2 -ml-3 cursor-col-resize"
            onMouseDown={startDrag}
            title="Arrastrá para ajustar"
            role="separator"
            aria-orientation="vertical"
          />
        )}

        {/* Main panel */}
        <div className="flex min-w-0 flex-1 flex-col">
          <TicketsHeaderAutos
            activeTab={activeTab}
            statusTabs={STATUS_TABS}
            filters={filters}
            onClearFilters={() => {
              setSearch("");
              setQueueId("all");
              setWhatsappId("all");
              setLeadSource("all");
              setRefreshKey((k) => k + 1);
            }}
            onRefresh={onRefresh}
            sidebarVisible={sidebarVisible}
            onToggleSidebar={() => setSidebarVisible((v) => !v)}
          />

          <div
            className={clsx(
              "mt-3 flex min-h-0 flex-1 overflow-hidden rounded-auto-xl border border-auto-border bg-auto-panel shadow-auto-soft"
            )}
          >
            <div className="min-w-0 flex flex-1">
              <div className="min-w-0 flex-1">
                {numericTicketId ? (
                  <Ticket />
                ) : (
                  <div className="flex h-full items-center justify-center p-8">
                  <div className="max-w-md text-center">
                    <div className="text-lg font-semibold text-auto-text">
                      Seleccioná un chat
                    </div>
                    <div className="mt-2 text-sm text-auto-muted">
                      Usá la lista de la izquierda para abrir un ticket.
                    </div>
                  </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

    </div>
  );
}
