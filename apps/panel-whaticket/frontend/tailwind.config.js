/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./index.html", "./src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
      /**
       * Define a new colour palette tailored for automotive agencies.  The
       * existing `ticket` palette was inherited from Whaticket and uses
       * blues/greens that don’t resonate with an automotive brand.  The
       * `auto` palette introduces darker neutrals, a vibrant accent and
       * status colours that are easier to differentiate at a glance.
       *
       *  - `primary`: used for text and key UI elements.  A dark navy
       *    creates contrast and evokes professionalism.
       *  - `secondary`: used for subtle backgrounds or secondary text.
       *  - `background`: the default page background, a very light gray to
       *    reduce eye strain.
       *  - `surface`: panels and cards have a clean white surface.
       *  - `accent`: a punchy red/orange inspired by sports cars; great for
       *    highlights and call‑to‑action buttons.
       *  - `open`, `pending`, `closed`: status colours for tickets.  These
       *    mirror the typical green/amber/gray semantics but are scoped
       *    under the `auto` namespace to avoid collisions.
       */
      colors: {
        auto: {
          primary: "#0f172a", // dark navy for primary text
          secondary: "#1e293b", // dark slate for secondary areas
          background: "#f3f4f6", // off white for page backgrounds
          surface: "#ffffff", // white cards
          accent: "#ef4444", // vibrant red for actions and highlights
          open: "#16a34a", // green for open tickets
          pending: "#f59e0b", // amber for pending tickets
          closed: "#64748b", // muted blue/gray for closed tickets
        },
        /**
         * Preserve the original ticket palette for backward compatibility.
         * Existing components that rely on `ticket.*` will continue to
         * function.  However, new components should favour the `auto`
         * palette.
         */
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
