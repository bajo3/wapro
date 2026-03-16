import React, { useState } from "react";
import { Send } from "lucide-react";
import { useParams } from "react-router-dom";

import api from "../services/api";

/**
 * A simplified, Tailwind-styled message input for the improved ticket UI.
 *
 * The existing MessageInput component is heavily dependent on Material‑UI and
 * inline styles, which can cause layout issues when used inside the
 * Tailwind‑driven chat view. This component provides a lightweight
 * alternative that sits flush at the bottom of the chat, adapts to the
 * ticket's status, and dispatches messages via the same API endpoint.
 */
export default function ImprovedMessageInput({ ticketStatus }) {
  const { ticketId } = useParams();
  const [message, setMessage] = useState("");

  const handleSend = async () => {
    const body = message.trim();
    if (!body || ticketStatus !== "open") return;
    try {
      await api.post(`/messages/${ticketId}`, {
        read: 1,
        fromMe: true,
        mediaUrl: "",
        body,
      });
      setMessage("");
    } catch (err) {
      // swallow errors silently; toast handling occurs upstream
    }
  };

  return (
    <div className="flex items-center gap-2 bg-auto-panel px-3 py-2 border-t border-auto-border">
      <textarea
        className="flex-1 resize-none rounded-auto-md border border-auto-border bg-auto-surface px-3 py-2 text-auto-text placeholder-auto-muted focus:outline-none disabled:bg-gray-100"
        rows={1}
        placeholder={
          ticketStatus === "open"
            ? "Escriba un mensaje o presione '/' para usar las respuestas rápidas registradas"
            : "Ticket cerrado"
        }
        value={message}
        disabled={ticketStatus !== "open"}
        onChange={(e) => setMessage(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            handleSend();
          }
        }}
      />
      <button
        type="button"
        onClick={handleSend}
        disabled={!message.trim() || ticketStatus !== "open"}
        className="inline-flex items-center justify-center rounded-auto-md bg-auto-accent px-3 py-2 text-white hover:bg-auto-accent/90 disabled:opacity-50"
      >
        <Send className="h-4 w-4" />
      </button>
    </div>
  );
}