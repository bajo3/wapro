/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./index.html", "./src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
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
      },
      boxShadow: {
        ticket: "0 4px 16px rgba(15, 23, 42, 0.08)",
        "ticket-soft": "0 2px 8px rgba(15, 23, 42, 0.06)",
      },
    },
  },
  plugins: [],
};
