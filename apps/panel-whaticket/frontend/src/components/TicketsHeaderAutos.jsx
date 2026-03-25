import React, { useMemo } from "react";
import { RefreshCw, Sidebar, X } from "lucide-react";

const STATUS_META = {
  queue: {
    dot: "bg-auto-pending",
    eyebrow: "Cola comercial",
    description: "Leads nuevos sin tomar",
  },
  working: {
    dot: "bg-auto-open",
    eyebrow: "Inbox comercial",
    description: "Conversaciones activas del equipo",
  },
  closed: {
    dot: "bg-auto-hint",
    eyebrow: "Historial",
    description: "Tickets finalizados o archivados",
  },
};

const actionButtonClass =
  "inline-flex h-9 items-center gap-2 rounded-auto-lg border border-auto-border bg-auto-panel2 px-3 text-xs font-medium text-auto-muted transition-colors hover:border-auto-border2 hover:text-auto-text";

export default function TicketsHeaderAutos({
  activeTab,
  statusTabs,
  hasActiveFilters,
  onClearFilters,
  onRefresh,
  sidebarVisible,
  onToggleSidebar,
}) {
  const currentTab = useMemo(
    () => statusTabs.find((tab) => tab.key === activeTab),
    [activeTab, statusTabs]
  );

  const meta = STATUS_META[activeTab] || STATUS_META.working;

  return (
    <header className="rounded-auto-xl border border-auto-border bg-auto-panel px-4 py-3 shadow-auto-soft">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2.5">
            <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${meta.dot}`} />
            <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-auto-muted">
              {meta.eyebrow}
            </span>
          </div>

          <div className="mt-1 flex flex-wrap items-center gap-2">
            <h1 className="truncate text-lg font-semibold text-auto-text">
              {currentTab?.label || "Tickets"}
            </h1>
            {hasActiveFilters ? (
              <span className="rounded-full border border-auto-accent/20 bg-auto-accent/10 px-2.5 py-1 text-[11px] font-medium text-auto-accent">
                Filtros activos
              </span>
            ) : null}
          </div>

          <p className="mt-1 text-sm text-auto-muted">{meta.description}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2 lg:justify-end">
          <button
            onClick={onToggleSidebar}
            className={actionButtonClass}
            type="button"
            title={sidebarVisible ? "Ocultar lista" : "Mostrar lista"}
          >
            <Sidebar className="h-4 w-4" />
            <span>{sidebarVisible ? "Ocultar lista" : "Mostrar lista"}</span>
          </button>

          <button onClick={onRefresh} className={actionButtonClass} type="button">
            <RefreshCw className="h-4 w-4" />
            <span>Refrescar</span>
          </button>

          <button
            onClick={onClearFilters}
            className="inline-flex h-9 items-center gap-2 rounded-auto-lg bg-auto-accent px-3 text-xs font-bold text-black transition-colors hover:bg-auto-accent2"
            type="button"
          >
            <X className="h-4 w-4" />
            <span>Limpiar filtros</span>
          </button>
        </div>
      </div>
    </header>
  );
}
