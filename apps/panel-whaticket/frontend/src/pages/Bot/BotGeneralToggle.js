import React, { useEffect, useState } from "react";
import { Button, Paper, Typography } from "@material-ui/core";
import { toast } from "react-toastify";
import api from "../../services/api";

/**
 * FIX: avoid /bot/settings (404) by reusing:
 *   GET /bot/intelligence/settings
 *   PUT /bot/intelligence/settings
 *
 * Stores flag in settings.botEnabled (boolean).
 */
export default function BotGeneralToggle() {
  const [enabled, setEnabled] = useState(null); // null = loading, no default
  const [loading, setLoading] = useState(false);
  const [rawSettings, setRawSettings] = useState({});

  const load = async () => {
    try {
      const { data } = await api.get("/bot/intelligence/settings");
      const settings = data?.settings || data || {};
      setRawSettings(settings);
      setEnabled(typeof settings.botEnabled === "boolean" ? settings.botEnabled : false);
    } catch (err) {
      setEnabled(false); // fail-safe: unknown state → show as off
    }
  };

  useEffect(() => {
    load();
  }, []);

  const toggle = async () => {
    setLoading(true);
    try {
      const next = !enabled;
      const nextSettings = { ...rawSettings, botEnabled: next };

      await api.put("/bot/intelligence/settings", { settings: nextSettings });

      setRawSettings(nextSettings);
      setEnabled(next);
      toast.success(next ? "Bot general activado" : "Bot general apagado");
    } catch (err) {
      toast.error("No se pudo cambiar el estado del bot");
    } finally {
      setLoading(false);
    }
  };

  if (enabled === null) {
    return (
      <Paper style={{ padding: 16, marginBottom: 16 }}>
        <Typography variant="body2" style={{ opacity: 0.6 }}>Cargando estado del bot...</Typography>
      </Paper>
    );
  }

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

      <Typography variant="caption" style={{ display: "block", marginTop: 8, opacity: 0.7 }}>
        Nota: si ves 403, tu sesión expiró. Volvé a iniciar sesión en el panel.
      </Typography>
    </Paper>
  );
}
