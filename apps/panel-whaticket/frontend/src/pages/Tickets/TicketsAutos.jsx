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

  const [sidebarVisible, setSidebarVisible] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const stored = Number(localStorage.getItem("ticketsAutos.sidebarWidth") || 360);
    return Number.isFinite(stored) ? stored : 360;
  });
  const dragRef = useRef({ dragging: false, startX: 0, startW: 360 });

  const activeStatus = useMemo(() => {
    return STATUS_TABS.find((tab) => tab.key === activeTab)?.status || "pending";
  }, [activeTab]);

  const filters = useMemo(
    () => ({ search, queueId, whatsappId, leadSource }),
    [search, queueId, whatsappId, leadSource]
  );

  const numericTicketId = ticketId ? Number(ticketId) : null;

  const handleSelectTicket = (id) => history.push(`/tickets/${id}`);

  const handleAcceptTicket = async (id, userId) => {
    history.push(`/tickets/${id}`);
    try {
      await api.put(`/tickets/${id}`, { status: "open", userId });
      setActiveTab("working");
      setRefreshKey((value) => value + 1);
    } catch (err) {
      toastError(err);
    }
  };

  const onRefresh = () => setRefreshKey((value) => value + 1);

  const startDrag = (event) => {
    if (!sidebarVisible) return;
    dragRef.current = {
      dragging: true,
      startX: event.clientX,
      startW: sidebarWidth,
    };
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
  };

  useEffect(() => {
    const onMove = (event) => {
      if (!dragRef.current.dragging) return;
      const delta = event.clientX - dragRef.current.startX;
      const nextWidth = Math.min(520, Math.max(300, dragRef.current.startW + delta));
      setSidebarWidth(nextWidth);
    };

    const onUp = () => {
      if (!dragRef.current.dragging) return;
      dragRef.current.dragging = false;
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      localStorage.setItem("ticketsAutos.sidebarWidth", String(sidebarWidth));
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);

    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [sidebarWidth]);

  const hasActiveFilters =
    Boolean(search) || queueId !== "all" || whatsappId !== "all" || leadSource !== "all";

  return (
    <div className="h-[calc(100vh-48px)] min-h-[640px] w-full overflow-hidden bg-auto-surface text-auto-text">
      <div className="flex h-full min-h-0 w-full flex-col gap-3 p-3 md:p-4">
        <TicketsHeaderAutos
          activeTab={activeTab}
          statusTabs={STATUS_TABS}
          hasActiveFilters={hasActiveFilters}
          onClearFilters={() => {
            setSearch("");
            setQueueId("all");
            setWhatsappId("all");
            setLeadSource("all");
            setRefreshKey((value) => value + 1);
          }}
          onRefresh={onRefresh}
          sidebarVisible={sidebarVisible}
          onToggleSidebar={() => setSidebarVisible((value) => !value)}
        />

        <div className="flex min-h-0 flex-1 gap-3 overflow-hidden">
          {sidebarVisible && (
            <div
              className={clsx(
                "min-h-0 shrink-0",
                numericTicketId ? "hidden xl:block" : "block"
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

          {sidebarVisible && (
            <div className="relative hidden xl:flex xl:w-3 xl:shrink-0 xl:items-stretch">
              <button
                type="button"
                className="group flex h-full w-full cursor-col-resize items-center justify-center"
                onMouseDown={startDrag}
                title="Arrastrá para ajustar el ancho"
                aria-label="Ajustar ancho de la lista"
              >
                <span className="h-full w-px rounded-full bg-auto-border transition-colors group-hover:bg-auto-accent/60" />
              </button>
            </div>
          )}

          <section className="flex min-w-0 min-h-0 flex-1 overflow-hidden rounded-auto-xl border border-auto-border bg-auto-panel shadow-auto-soft">
            {numericTicketId ? (
              <Ticket />
            ) : (
              <div className="flex h-full w-full items-center justify-center bg-[radial-gradient(circle_at_top,rgba(245,158,11,0.10),transparent_35%)] p-8">
                <div className="max-w-md rounded-auto-xl border border-auto-border bg-auto-surface/80 p-6 text-center shadow-auto-soft backdrop-blur-sm">
                  <div className="text-lg font-semibold text-auto-text">Seleccioná un chat</div>
                  <div className="mt-2 text-sm leading-6 text-auto-muted">
                    Abrí un ticket desde la lista para ver la conversación, gestionar el lead y responder sin salir del panel.
                  </div>
                </div>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
