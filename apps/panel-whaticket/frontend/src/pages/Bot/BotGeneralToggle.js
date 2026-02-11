import React, { useEffect, useState } from "react";
import { Button, Paper, Typography } from "@material-ui/core";
import { toast } from "react-toastify";
import api from "../../services/api";

/**
 * BotGeneralToggle
 * - Toggle global bot on/off for ALL tickets.
 * - Backend required:
 *    GET  /bot/settings  -> { enabled: boolean }
 *    PUT  /bot/settings  -> { enabled: boolean }
 *
 * Usage (inside your Bot page):
 *   <BotGeneralToggle />
 */
export default function BotGeneralToggle() {
  const [enabled, setEnabled] = useState(true);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    try {
      const { data } = await api.get("/bot/settings");
      setEnabled(Boolean(data?.enabled));
    } catch (err) {
      // Endpoint not present yet: keep default ON without breaking UI.
    }
  };

  useEffect(() => {
    load();
  }, []);

  const toggle = async () => {
    setLoading(true);
    try {
      const next = !enabled;
      await api.put("/bot/settings", { enabled: next });
      setEnabled(next);
      toast.success(next ? "Bot general activado" : "Bot general apagado");
    } catch (err) {
      toast.error("No se pudo cambiar el estado del bot");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Paper style={{ padding: 16, marginBottom: 16 }}>
      <Typography variant="subtitle1" style={{ marginBottom: 10 }}>
        Bot general
      </Typography>

      <Button
        variant="contained"
        color={enabled ? "secondary" : "primary"}
        onClick={toggle}
        disabled={loading}
      >
        {enabled ? "Apagar bot general" : "Prender bot general"}
      </Button>

      <Typography variant="body2" style={{ marginTop: 10, opacity: 0.8 }}>
        Estado actual: {enabled ? "ACTIVO" : "APAGADO"}
      </Typography>
    </Paper>
  );
}
