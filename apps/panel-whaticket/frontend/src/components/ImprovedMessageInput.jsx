import React, { useEffect, useRef, useState } from "react";
import { Send } from "lucide-react";
import { useParams } from "react-router-dom";

import api from "../services/api";
import toastError from "../errors/toastError";

export default function ImprovedMessageInput({ ticketStatus }) {
  const { ticketId } = useParams();
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    const onPrefill = (e) => {
      const text = e?.detail?.text;
      if (typeof text === "string") {
        setMessage(text);
        setTimeout(() => inputRef.current?.focus?.(), 0);
      }
    };
    window.addEventListener("tickets:prefill", onPrefill);
    return () => window.removeEventListener("tickets:prefill", onPrefill);
  }, []);

  const handleSend = async () => {
    const body = message.trim();
    if (!body || ticketStatus !== "open" || loading) return;
    setLoading(true);
    try {
      await api.post(`/messages/${ticketId}`, {
        read: 1,
        fromMe: true,
        mediaUrl: "",
        body,
      });
      setMessage("");
    } catch (err) {
      toastError(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="shrink-0 border-t border-auto-border bg-auto-panel px-3 py-2">
      <div className="flex items-end gap-2">
        <textarea
          ref={inputRef}
          className="min-h-[44px] max-h-32 flex-1 resize-none rounded-auto-md border border-auto-border bg-auto-surface px-3 py-2 text-sm text-auto-text outline-none placeholder:text-auto-muted focus:ring-2 focus:ring-auto-accent/20 disabled:cursor-not-allowed disabled:opacity-70"
          rows={1}
          placeholder={
            ticketStatus === "open"
              ? "Escribí un mensaje..."
              : "Ticket cerrado"
          }
          value={message}
          disabled={ticketStatus !== "open" || loading}
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
          disabled={!message.trim() || ticketStatus !== "open" || loading}
          className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-auto-md bg-auto-accent text-white transition hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-50"
          title="Enviar"
        >
          <Send className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
