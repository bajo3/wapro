import React, { useMemo, useState } from "react";
import { useHistory, useParams } from "react-router-dom";
import clsx from "clsx";

import TicketsSidebarAutos from "../../components/TicketsSidebarAutos";
import TicketsHeaderAutos from "../../components/TicketsHeaderAutos";
import Ticket from "../../components/Ticket";
import LeadPanelAutos from "../../components/LeadPanelAutos";
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

  return (
    <div className="h-[calc(100%-48px)] w-full bg-auto-surface text-auto-text">
      <div className="mx-auto flex h-full max-w-[1600px] gap-4 p-4">
        {/* Sidebar (hide on mobile when a ticket is selected) */}
        <div
          className={clsx(
            "w-[380px] shrink-0",
            numericTicketId ? "hidden md:block" : "block"
          )}
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
          />

          <div
            className={clsx(
              "mt-4 flex min-h-0 flex-1 overflow-hidden rounded-auto-xl border border-auto-border bg-auto-panel shadow-auto-soft"
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

              {/* Right panel: lead/auto */}
              {numericTicketId ? (
                <div className="hidden lg:block w-[360px] border-l border-auto-border bg-auto-panel">
                  <LeadPanelAutos ticketId={numericTicketId} />
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
