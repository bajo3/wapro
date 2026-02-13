import React, { useEffect } from "react";

/**
 * Simple right-side slide-over drawer.
 * - Locks body scroll while open
 * - ESC closes
 */
export default function SlideOver({
  open,
  title,
  onClose,
  children,
  widthClass = "w-[420px]",
}) {
  useEffect(() => {
    if (!open) return;
    const prevOverflow = document?.body?.style?.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (e) => {
      if (e.key === "Escape") onClose?.();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = prevOverflow || "";
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50">
      {/* overlay */}
      <div
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
        role="button"
        tabIndex={-1}
        aria-label="Cerrar"
      />

      {/* panel */}
      <div
        className={`absolute right-0 top-0 h-full ${widthClass} max-w-[92vw] border-l border-auto-border bg-auto-panel shadow-auto-soft`}
        role="dialog"
        aria-modal="true"
      >
        <div className="flex h-12 items-center justify-between border-b border-auto-border px-4">
          <div className="text-sm font-semibold text-auto-text">{title}</div>
          <button
            type="button"
            onClick={onClose}
            className="h-9 w-9 rounded-auto-md border border-auto-border bg-auto-panel text-auto-text hover:bg-auto-panel2"
            aria-label="Cerrar"
            title="Cerrar"
          >
            ×
          </button>
        </div>
        <div className="h-[calc(100%-48px)] overflow-auto">{children}</div>
      </div>
    </div>
  );
}
