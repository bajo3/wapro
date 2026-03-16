import React, { useContext, useEffect, useRef, useState } from "react";
import { Send } from "lucide-react";
import { useParams } from "react-router-dom";

import api from "../services/api";
import { AuthContext } from "../context/Auth/AuthContext";
import { ReplyMessageContext } from "../context/ReplyingMessage/ReplyingMessageContext";
import toastError from "../errors/toastError";
import { useLocalStorage } from "../hooks/useLocalStorage";

export default function ImprovedMessageInput({ ticketStatus }) {
  const { ticketId } = useParams();
  const { user } = useContext(AuthContext);
  const { replyingMessage, setReplyingMessage } = useContext(ReplyMessageContext);
  const [signMessage] = useLocalStorage("signOption", true);
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    const onPrefill = (e) => {
      const text = e?.detail?.text;
      if (typeof text === "string") {
        setMessage(text);
        requestAnimationFrame(() => inputRef.current?.focus?.());
      }
    };
    window.addEventListener("tickets:prefill", onPrefill);
    return () => window.removeEventListener("tickets:prefill", onPrefill);
  }, []);

  useEffect(() => {
    setMessage("");
    setReplyingMessage(null);
  }, [ticketId, setReplyingMessage]);

  const handleSend = async () => {
    const body = message.trim();
    if (!body || sending || ticketStatus !== "open") return;
    setSending(true);
    try {
      await api.post(`/messages/${ticketId}`, {
        read: 1,
        fromMe: true,
        mediaUrl: "",
        body: signMessage ? `*${user?.name || "Asesor"}:*\n${body}` : body,
        quotedMsg: replyingMessage || undefined,
      });
      setMessage("");
      setReplyingMessage(null);
      requestAnimationFrame(() => inputRef.current?.focus?.());
    } catch (err) {
      toastError(err);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="shrink-0 border-t border-auto-border bg-auto-panel px-3 py-3 md:px-4">
      {replyingMessage && (
        <div className="mb-2 rounded-auto-md border border-auto-border bg-auto-surface px-3 py-2 text-xs text-auto-muted">
          <div className="font-medium text-auto-text">Respondiendo mensaje</div>
          <div className="mt-1 line-clamp-2">{replyingMessage?.body || ""}</div>
          <button
            type="button"
            className="mt-2 text-xs font-medium text-auto-accent"
            onClick={() => setReplyingMessage(null)}
          >
            Cancelar
          </button>
        </div>
      )}

      <div className="flex items-end gap-2">
        <textarea
          ref={inputRef}
          rows={1}
          value={message}
          disabled={sending || ticketStatus !== "open"}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
          placeholder={
            ticketStatus === "open"
              ? "Escribí un mensaje..."
              : "El ticket está cerrado"
          }
          className="min-h-[44px] max-h-40 flex-1 resize-y rounded-auto-lg border border-auto-border bg-auto-surface px-3 py-2 text-sm text-auto-text outline-none placeholder:text-auto-muted focus:border-auto-accent/40 focus:ring-2 focus:ring-auto-accent/20 disabled:cursor-not-allowed disabled:opacity-60"
        />
        <button
          type="button"
          onClick={handleSend}
          disabled={sending || !message.trim() || ticketStatus !== "open"}
          className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-auto-lg bg-auto-accent text-white transition hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-50"
          title="Enviar mensaje"
        >
          <Send className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
