/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./index.html", "./src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Legacy ticket palette (no tocar — usada en componentes viejos)
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

        // Tema oscuro unificado (WaPro Dark)
        auto: {
          surface:  "#0f1117",   // fondo general
          panel:    "#171b26",   // cards / paneles
          panel2:   "#1e2333",   // paneles secundarios
          border:   "rgba(255,255,255,0.08)",
          border2:  "rgba(255,255,255,0.14)",
          text:     "#f1f5f9",
          muted:    "#94a3b8",
          hint:     "#64748b",
          accent:   "#f59e0b",   // amber — color primario
          accent2:  "#fbbf24",   // amber hover
          open:     "#22c55e",
          pending:  "#f59e0b",
          closed:   "#64748b",
        },
      },
      borderRadius: {
        ticket:    "0.75rem",
        "auto-md": "0.5rem",
        "auto-lg": "0.75rem",
        "auto-xl": "1rem",
      },
      boxShadow: {
        ticket:       "0 4px 16px rgba(15, 23, 42, 0.08)",
        "ticket-soft": "0 2px 8px rgba(15, 23, 42, 0.06)",
        "auto-soft":  "0 4px 24px rgba(0, 0, 0, 0.35)",
      },
    },
  },
  plugins: [],
};
