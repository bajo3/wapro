/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./index.html", "./src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
      /**
       * Design tokens for the "Autos" UI.
       * We keep the legacy `ticket.*` palette to avoid breaking the current
       * UI while we migrate section-by-section to Tailwind.
       */
      colors: {
        ticket: {
          surface: "#f5f7fb",
          panel: "#ffffff",
          border: "#d8deeb",
          muted: "#6b7a90",
          open: "#16a34a",
          pending: "#f59e0b",
          closed: "#64748b",
          accent: "#2576d2",
        },

        // Autos theme (neutral + confident accent)
        auto: {
          surface: "#0b1220", // page background
          panel: "#0f172a", // cards/panels
          panel2: "#111c33", // secondary panels
          border: "#23314a",
          text: "#e5e7eb",
          muted: "#9aa7bd",
          accent: "#ef4444", // red accent (autos)
          open: "#22c55e",
          pending: "#f59e0b",
          closed: "#94a3b8",
        },
      },
      spacing: {
        "ticket-xs": "0.25rem",
        "ticket-sm": "0.5rem",
        "ticket-md": "0.75rem",
        "ticket-lg": "1rem",
        "ticket-xl": "1.5rem",
      },
      borderRadius: {
        ticket: "0.75rem",
        "auto-md": "0.75rem",
        "auto-lg": "1rem",
        "auto-xl": "1.25rem",
      },
      boxShadow: {
        ticket: "0 4px 16px rgba(15, 23, 42, 0.08)",
        "ticket-soft": "0 2px 8px rgba(15, 23, 42, 0.06)",

        // Subtle shadows for dark UI
        "auto-soft": "0 10px 30px rgba(0, 0, 0, 0.25)",
      },
    },
  },
  plugins: [],
};
