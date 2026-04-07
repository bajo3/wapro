import React, { useState, useEffect, useCallback } from "react";
import {
  Container, Grid, Paper, Typography, Box, CircularProgress,
  Chip, Divider, Tooltip, IconButton, LinearProgress, Button
} from "@material-ui/core";
import { makeStyles } from "@material-ui/core/styles";
import RefreshIcon from "@material-ui/icons/Refresh";
import TrendingUpIcon from "@material-ui/icons/TrendingUp";
import TrendingDownIcon from "@material-ui/icons/TrendingDown";
import PeopleIcon from "@material-ui/icons/People";
import DirectionsCarIcon from "@material-ui/icons/DirectionsCar";
import MonetizationOnIcon from "@material-ui/icons/MonetizationOn";
import AssignmentIcon from "@material-ui/icons/Assignment";
import CheckCircleIcon from "@material-ui/icons/CheckCircle";
import ErrorIcon from "@material-ui/icons/Error";
import WarningIcon from "@material-ui/icons/Warning";
import SmartToyIcon from "@material-ui/icons/Android";
import api from "../../services/api";
import axios from "axios";

// Bot API URL — configurable via env, no hard dependency on config.js export
const BOT_BASE = (
  (typeof window !== "undefined" && window.ENV?.VITE_BOT_API_URL) ||
  (typeof import.meta !== "undefined" && import.meta.env?.VITE_BOT_API_URL) ||
  ""
);

const useStyles = makeStyles((theme) => ({
  root: {
    paddingTop: theme.spacing(3),
    paddingBottom: theme.spacing(4),
    background: theme.palette.background.default,
    minHeight: "100vh",
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: theme.spacing(3),
  },
  card: {
    padding: theme.spacing(2.5),
    borderRadius: 12,
    display: "flex",
    flexDirection: "column",
    gap: theme.spacing(1),
    height: "100%",
    boxShadow: "0 1px 4px rgba(0,0,0,0.08)",
    transition: "box-shadow .2s",
    "&:hover": { boxShadow: "0 4px 16px rgba(0,0,0,0.12)" },
  },
  cardIcon: {
    width: 40, height: 40, borderRadius: 10,
    display: "flex", alignItems: "center", justifyContent: "center",
    marginBottom: theme.spacing(0.5),
  },
  cardValue: {
    fontSize: 28, fontWeight: 700,
    color: theme.palette.text.primary,
    lineHeight: 1,
  },
  cardLabel: {
    fontSize: 13,
    color: theme.palette.text.secondary,
    fontWeight: 500,
  },
  cardDelta: {
    display: "flex", alignItems: "center", gap: 4,
    fontSize: 12, fontWeight: 600,
  },
  sectionTitle: {
    fontSize: 15, fontWeight: 700,
    color: theme.palette.text.primary,
    marginBottom: theme.spacing(1.5),
  },
  statusRow: {
    display: "flex", alignItems: "center",
    justifyContent: "space-between",
    padding: "6px 0",
    borderBottom: `1px solid ${theme.palette.divider}`,
    "&:last-child": { borderBottom: "none" },
  },
  intentRow: {
    display: "flex", alignItems: "center",
    justifyContent: "space-between",
    padding: "5px 0",
  },
  barBg: {
    flex: 1, height: 6, borderRadius: 3,
    backgroundColor: theme.palette.action.hover,
    margin: "0 8px",
    overflow: "hidden",
  },
  barFill: {
    height: "100%", borderRadius: 3,
    transition: "width .4s ease",
  },
  chip: {
    fontWeight: 600, fontSize: 11,
  },
  healthRow: {
    display: "flex", alignItems: "center",
    justifyContent: "space-between",
    padding: "8px 0",
    borderBottom: `1px solid ${theme.palette.divider}`,
    "&:last-child": { borderBottom: "none" },
  },
  alertRow: {
    display: "flex", alignItems: "center",
    gap: 8,
    padding: "6px 0",
    borderBottom: `1px solid ${theme.palette.divider}`,
    "&:last-child": { borderBottom: "none" },
  },
  evalRow: {
    display: "flex", alignItems: "center",
    justifyContent: "space-between",
    padding: "6px 0",
    borderBottom: `1px solid ${theme.palette.divider}`,
    "&:last-child": { borderBottom: "none" },
    fontSize: 13,
  },
  loader: {
    display: "flex", justifyContent: "center",
    alignItems: "center", minHeight: 300,
  },
  errorBox: {
    textAlign: "center", padding: theme.spacing(4),
    color: theme.palette.error.main,
  },
}));

const STATUS_COLORS = {
  draft:    { bg: "#f3f4f6", text: "#6b7280" },
  sent:     { bg: "#dbeafe", text: "#1d4ed8" },
  viewed:   { bg: "#fef9c3", text: "#a16207" },
  accepted: { bg: "#dcfce7", text: "#15803d" },
  rejected: { bg: "#fee2e2", text: "#dc2626" },
  expired:  { bg: "#f1f5f9", text: "#94a3b8" },
};

const INTENT_LABELS = {
  exploracion:      "🔍 Exploración",
  interes_precio:   "💰 Interés precio",
  vio_catalogo:     "👀 Vio catálogo",
  financiacion:     "💳 Financiación",
  permuta:          "🔄 Permuta",
  compra_inmediata: "🔥 Compra inmediata",
  consulta_general: "💬 Consulta general",
};

const INTENT_COLORS = {
  compra_inmediata: "#ef4444",
  financiacion:     "#f97316",
  permuta:          "#a855f7",
  interes_precio:   "#3b82f6",
  vio_catalogo:     "#06b6d4",
  exploracion:      "#10b981",
  consulta_general: "#6b7280",
};

function StatCard({ icon, iconBg, value, label, delta, deltaPositive }) {
  const classes = useStyles();
  return (
    <Paper className={classes.card}>
      <Box className={classes.cardIcon} style={{ background: iconBg }}>
        {icon}
      </Box>
      <Typography className={classes.cardValue}>{value}</Typography>
      <Typography className={classes.cardLabel}>{label}</Typography>
      {delta !== undefined && (
        <Box className={classes.cardDelta}
          style={{ color: deltaPositive ? "#15803d" : "#dc2626" }}>
          {deltaPositive ? <TrendingUpIcon style={{ fontSize: 14 }} /> : <TrendingDownIcon style={{ fontSize: 14 }} />}
          {delta}
        </Box>
      )}
    </Paper>
  );
}

const MetricsDashboard = () => {
  const classes = useStyles();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [quotationStats, setQuotationStats] = useState(null);
  const [leadIntents, setLeadIntents] = useState([]);
  const [vehicleCount, setVehicleCount] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);
  // Fase 5: Bot intelligence
  const [botHealth, setBotHealth] = useState(null);
  const [botMetrics, setBotMetrics] = useState(null);
  const [botAlerts, setBotAlerts] = useState([]);
  const [evalRuns, setEvalRuns] = useState([]);
  const [evalRunning, setEvalRunning] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [qStats, vehicles] = await Promise.allSettled([
        api.get("/quotations/stats"),
        api.get("/vehicles?limit=1"),
      ]);

      if (qStats.status === "fulfilled") {
        setQuotationStats(qStats.value.data);
      }

      if (vehicles.status === "fulfilled") {
        const data = vehicles.value.data;
        setVehicleCount(data?.count ?? data?.vehicles?.length ?? null);
      }

      // Lead intents from bot DB (via admin API)
      try {
        const token = localStorage.getItem("adminToken") || "";
        const intentsRes = await axios.get(`${BOT_BASE}/admin/lead-intents`, {
          headers: { "x-admin-token": token },
          timeout: 5000,
        });
        if (Array.isArray(intentsRes.data?.intents)) {
          setLeadIntents(intentsRes.data.intents);
        }
      } catch { /* bot API optional */ }

      // Fase 5: Bot health, metrics, alerts, eval runs — via panel proxy
      await Promise.allSettled([
        api.get("/bot/health/bot").then((r) => setBotHealth(r.data?.health ?? null)).catch(() => {}),
        api.get("/bot/metrics/summary").then((r) => setBotMetrics(r.data?.summary ?? null)).catch(() => {}),
        api.get("/bot/metrics/alerts").then((r) => setBotAlerts(Array.isArray(r.data?.alerts) ? r.data.alerts : [])).catch(() => {}),
        api.get("/bot/eval/runs?limit=5").then((r) => setEvalRuns(Array.isArray(r.data?.runs) ? r.data.runs : [])).catch(() => {}),
      ]);

      setLastUpdated(new Date().toLocaleTimeString("es-AR"));
    } catch (e) {
      setError("No se pudo cargar las métricas. Revisá la conexión.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return (
      <Box className={classes.loader}>
        <CircularProgress size={40} />
      </Box>
    );
  }

  if (error) {
    return (
      <Box className={classes.errorBox}>
        <Typography variant="body1">{error}</Typography>
      </Box>
    );
  }

  const qs = quotationStats ?? {};
  const byStatus = qs.byStatus ?? {};
  const total = qs.total ?? 0;
  const accepted = byStatus.accepted?.total ?? 0;
  const sent = byStatus.sent?.total ?? 0;
  const draft = byStatus.draft?.total ?? 0;
  const conversion = qs.conversionRate ?? 0;
  const totalRevenue = Object.values(byStatus).reduce((s, r) => s + (r?.totalAmount ?? 0), 0);

  const maxIntentCount = leadIntents.length > 0
    ? Math.max(...leadIntents.map(r => r.count ?? 0))
    : 1;

  return (
    <Container maxWidth="lg" className={classes.root}>
      {/* Header */}
      <Box className={classes.header}>
        <Box>
          <Typography variant="h5" style={{ fontWeight: 700 }}>
            📊 Métricas del sistema
          </Typography>
          {lastUpdated && (
            <Typography variant="caption" color="textSecondary">
              Actualizado: {lastUpdated}
            </Typography>
          )}
        </Box>
        <Tooltip title="Actualizar">
          <IconButton onClick={load} size="small">
            <RefreshIcon />
          </IconButton>
        </Tooltip>
      </Box>

      {/* KPI Cards */}
      <Grid container spacing={2} style={{ marginBottom: 24 }}>
        <Grid item xs={6} sm={3}>
          <StatCard
            icon={<AssignmentIcon style={{ color: "#3b82f6", fontSize: 20 }} />}
            iconBg="#dbeafe"
            value={total}
            label="Cotizaciones totales"
          />
        </Grid>
        <Grid item xs={6} sm={3}>
          <StatCard
            icon={<TrendingUpIcon style={{ color: "#15803d", fontSize: 20 }} />}
            iconBg="#dcfce7"
            value={`${conversion}%`}
            label="Tasa de conversión"
            delta={conversion > 0 ? `${accepted} aceptadas` : "Sin aceptadas"}
            deltaPositive={conversion > 0}
          />
        </Grid>
        <Grid item xs={6} sm={3}>
          <StatCard
            icon={<MonetizationOnIcon style={{ color: "#f97316", fontSize: 20 }} />}
            iconBg="#ffedd5"
            value={`USD ${Math.round(totalRevenue).toLocaleString("es-AR")}`}
            label="Valor total cotizado"
          />
        </Grid>
        <Grid item xs={6} sm={3}>
          <StatCard
            icon={<DirectionsCarIcon style={{ color: "#a855f7", fontSize: 20 }} />}
            iconBg="#f3e8ff"
            value={vehicleCount !== null ? vehicleCount : "—"}
            label="Vehículos activos"
          />
        </Grid>
      </Grid>

      <Grid container spacing={2}>
        {/* Cotizaciones por estado */}
        <Grid item xs={12} sm={6}>
          <Paper className={classes.card}>
            <Typography className={classes.sectionTitle}>
              Cotizaciones por estado
            </Typography>
            <Divider style={{ marginBottom: 8 }} />
            {Object.keys(STATUS_COLORS).map((status) => {
              const data = byStatus[status];
              if (!data && !["sent", "draft", "accepted"].includes(status)) return null;
              const count = data?.total ?? 0;
              const pct = total > 0 ? Math.round((count / total) * 100) : 0;
              const color = STATUS_COLORS[status] ?? { bg: "#f3f4f6", text: "#6b7280" };
              return (
                <Box key={status} className={classes.statusRow}>
                  <Chip
                    label={status}
                    size="small"
                    className={classes.chip}
                    style={{ background: color.bg, color: color.text, minWidth: 80 }}
                  />
                  <Box className={classes.barBg}>
                    <Box
                      className={classes.barFill}
                      style={{
                        width: `${pct}%`,
                        background: color.text,
                        opacity: 0.8
                      }}
                    />
                  </Box>
                  <Typography variant="body2" style={{ fontWeight: 600, minWidth: 48, textAlign: "right" }}>
                    {count} <span style={{ fontWeight: 400, color: "#94a3b8", fontSize: 11 }}>({pct}%)</span>
                  </Typography>
                </Box>
              );
            })}
            {total === 0 && (
              <Typography variant="body2" color="textSecondary" style={{ textAlign: "center", padding: 16 }}>
                Sin cotizaciones todavía
              </Typography>
            )}
          </Paper>
        </Grid>

        {/* Intenciones de leads */}
        <Grid item xs={12} sm={6}>
          <Paper className={classes.card}>
            <Typography className={classes.sectionTitle}>
              Leads por intención detectada
            </Typography>
            <Divider style={{ marginBottom: 8 }} />
            {leadIntents.length > 0 ? (
              leadIntents.map((row) => {
                const label = INTENT_LABELS[row.intent] ?? row.intent;
                const color = INTENT_COLORS[row.intent] ?? "#6b7280";
                const pct = Math.round(((row.count ?? 0) / maxIntentCount) * 100);
                return (
                  <Box key={row.intent} className={classes.intentRow}>
                    <Typography variant="body2" style={{ minWidth: 150, fontSize: 12, fontWeight: 500 }}>
                      {label}
                    </Typography>
                    <Box className={classes.barBg}>
                      <Box
                        className={classes.barFill}
                        style={{ width: `${pct}%`, background: color }}
                      />
                    </Box>
                    <Typography variant="body2" style={{ fontWeight: 700, minWidth: 36, textAlign: "right", color }}>
                      {row.count ?? 0}
                    </Typography>
                  </Box>
                );
              })
            ) : (
              <Box style={{ textAlign: "center", padding: 16 }}>
                <PeopleIcon style={{ color: "#cbd5e1", fontSize: 40 }} />
                <Typography variant="body2" color="textSecondary" style={{ marginTop: 8 }}>
                  Sin datos de intenciones todavía.
                  <br />
                  Se completan automáticamente con las conversaciones del bot.
                </Typography>
              </Box>
            )}
          </Paper>
        </Grid>

        {/* ── Fase 5: Salud del bot ── */}
        {botHealth && (
          <Grid item xs={12} sm={6}>
            <Paper className={classes.card}>
              <Box display="flex" alignItems="center" justifyContent="space-between" mb={1}>
                <Typography className={classes.sectionTitle}>
                  <SmartToyIcon style={{ fontSize: 16, marginRight: 6, verticalAlign: "middle" }} />
                  Salud del bot
                </Typography>
                <Chip
                  label={botHealth.ok ? "OK" : "DEGRADADO"}
                  size="small"
                  className={classes.chip}
                  style={{
                    background: botHealth.ok ? "#dcfce7" : "#fee2e2",
                    color: botHealth.ok ? "#15803d" : "#dc2626",
                  }}
                  icon={botHealth.ok
                    ? <CheckCircleIcon style={{ fontSize: 14 }} />
                    : <ErrorIcon style={{ fontSize: 14 }} />}
                />
              </Box>
              <Divider style={{ marginBottom: 8 }} />
              {[
                { label: "Catálogo activo", ok: botHealth.checks?.catalog?.ok, detail: `${botHealth.checks?.catalog?.vehicleCount ?? 0} vehículos` },
                { label: "Fallback rate", ok: botHealth.checks?.fallbackRate?.ok, detail: `${((botHealth.checks?.fallbackRate?.rate ?? 0) * 100).toFixed(1)}%` },
                { label: "Alucinaciones bloqueadas", ok: botHealth.checks?.hallucinationBlocks?.ok, detail: `${botHealth.checks?.hallucinationBlocks?.lastHour ?? 0} última hora` },
                { label: "Dead letters", ok: botHealth.checks?.deadLetters?.ok, detail: `${botHealth.checks?.deadLetters?.lastHour ?? 0} última hora` },
                { label: "Alertas activas", ok: (botHealth.checks?.activeAlerts ?? 0) === 0, detail: `${botHealth.checks?.activeAlerts ?? 0}` },
              ].map(({ label, ok, detail }) => (
                <Box key={label} className={classes.healthRow}>
                  <Typography variant="body2" style={{ fontSize: 12 }}>{label}</Typography>
                  <Box display="flex" alignItems="center" gap={1}>
                    <Typography variant="body2" style={{ fontSize: 12, color: "#6b7280" }}>{detail}</Typography>
                    {ok
                      ? <CheckCircleIcon style={{ fontSize: 14, color: "#15803d" }} />
                      : <ErrorIcon style={{ fontSize: 14, color: "#dc2626" }} />}
                  </Box>
                </Box>
              ))}
            </Paper>
          </Grid>
        )}

        {/* ── Fase 5: Métricas del bot ── */}
        {botMetrics && (
          <Grid item xs={12} sm={6}>
            <Paper className={classes.card}>
              <Typography className={classes.sectionTitle}>
                Inteligencia del bot — últimas 24h
              </Typography>
              <Divider style={{ marginBottom: 8 }} />
              {[
                { label: "Tasa de respuesta", value: `${((botMetrics.responseRate ?? 0) * 100).toFixed(1)}%`, color: "#3b82f6", pct: (botMetrics.responseRate ?? 0) * 100 },
                { label: "Tasa de handoff", value: `${((botMetrics.handoffRate ?? 0) * 100).toFixed(1)}%`, color: "#f97316", pct: (botMetrics.handoffRate ?? 0) * 100 },
                { label: "Fallback rate", value: `${((botMetrics.fallbackRate ?? 0) * 100).toFixed(1)}%`, color: (botMetrics.fallbackRate ?? 0) > 0.3 ? "#dc2626" : "#6b7280", pct: (botMetrics.fallbackRate ?? 0) * 100 },
                { label: "Alucinaciones bloqueadas", value: `${((botMetrics.hallucinationBlockRate ?? 0) * 100).toFixed(1)}%`, color: "#dc2626", pct: (botMetrics.hallucinationBlockRate ?? 0) * 100 },
              ].map(({ label, value, color, pct }) => (
                <Box key={label} className={classes.intentRow}>
                  <Typography variant="body2" style={{ minWidth: 190, fontSize: 12, fontWeight: 500 }}>{label}</Typography>
                  <Box className={classes.barBg}>
                    <Box className={classes.barFill} style={{ width: `${Math.min(pct, 100)}%`, background: color }} />
                  </Box>
                  <Typography variant="body2" style={{ fontWeight: 700, minWidth: 44, textAlign: "right", color, fontSize: 12 }}>
                    {value}
                  </Typography>
                </Box>
              ))}
              <Box mt={1} display="flex" alignItems="center" gap={1}>
                <Typography variant="caption" color="textSecondary">
                  Score promedio: <b>{botMetrics.avgLeadScore != null ? botMetrics.avgLeadScore.toFixed(0) : "—"}</b>
                </Typography>
                <Typography variant="caption" color="textSecondary" style={{ marginLeft: 12 }}>
                  Mensajes: <b>{botMetrics.last24hMessages ?? 0}</b>
                  {botMetrics.trendVsPrevious24h !== 0 && (
                    <span style={{ color: botMetrics.trendVsPrevious24h > 0 ? "#15803d" : "#dc2626", marginLeft: 4 }}>
                      {botMetrics.trendVsPrevious24h > 0 ? "▲" : "▼"} {Math.abs(botMetrics.trendVsPrevious24h)}%
                    </span>
                  )}
                </Typography>
              </Box>
              {/* Temperatura de leads */}
              {botMetrics.temperatureDistribution && (
                <Box mt={1}>
                  {[
                    { key: "hot", label: "Hot", color: "#ef4444" },
                    { key: "warm", label: "Warm", color: "#f97316" },
                    { key: "cold", label: "Cold", color: "#3b82f6" },
                  ].map(({ key, label, color }) => {
                    const cnt = botMetrics.temperatureDistribution[key] ?? 0;
                    const total = (botMetrics.temperatureDistribution.hot ?? 0) +
                      (botMetrics.temperatureDistribution.warm ?? 0) +
                      (botMetrics.temperatureDistribution.cold ?? 0);
                    const pct = total > 0 ? (cnt / total) * 100 : 0;
                    return (
                      <Box key={key} className={classes.intentRow}>
                        <Chip label={label} size="small" style={{ background: color + "22", color, fontWeight: 700, fontSize: 10, minWidth: 44 }} />
                        <Box className={classes.barBg} style={{ margin: "0 8px" }}>
                          <Box className={classes.barFill} style={{ width: `${pct}%`, background: color }} />
                        </Box>
                        <Typography variant="caption" style={{ fontWeight: 700, color, minWidth: 24, textAlign: "right" }}>{cnt}</Typography>
                      </Box>
                    );
                  })}
                </Box>
              )}
            </Paper>
          </Grid>
        )}

        {/* ── Fase 5: Alertas activas ── */}
        {botAlerts.length > 0 && (
          <Grid item xs={12} sm={6}>
            <Paper className={classes.card}>
              <Box display="flex" alignItems="center" justifyContent="space-between" mb={1}>
                <Typography className={classes.sectionTitle}>
                  <WarningIcon style={{ fontSize: 16, marginRight: 6, color: "#f97316", verticalAlign: "middle" }} />
                  Alertas activas
                </Typography>
                <Chip label={botAlerts.length} size="small" style={{ background: "#fee2e2", color: "#dc2626", fontWeight: 700 }} />
              </Box>
              <Divider style={{ marginBottom: 8 }} />
              {botAlerts.slice(0, 5).map((alert) => (
                <Box key={alert.id} className={classes.alertRow}>
                  {alert.severity === "critical"
                    ? <ErrorIcon style={{ fontSize: 16, color: "#dc2626", flexShrink: 0 }} />
                    : <WarningIcon style={{ fontSize: 16, color: "#f97316", flexShrink: 0 }} />}
                  <Box flex={1}>
                    <Typography variant="body2" style={{ fontSize: 12, fontWeight: 600 }}>
                      {alert.alertType.replace(/_/g, " ")}
                    </Typography>
                    <Typography variant="caption" color="textSecondary">
                      Valor: {typeof alert.metricValue === "number" ? alert.metricValue.toFixed(2) : alert.metricValue}
                      {" | "}Umbral: {typeof alert.thresholdValue === "number" ? alert.thresholdValue.toFixed(2) : alert.thresholdValue}
                    </Typography>
                  </Box>
                  <Button
                    size="small"
                    style={{ fontSize: 10, color: "#6b7280", minWidth: 0, padding: "2px 6px" }}
                    onClick={() =>
                      api.post(`/bot/metrics/alerts/${alert.id}/resolve`)
                        .then(() => setBotAlerts((prev) => prev.filter((a) => a.id !== alert.id)))
                        .catch(() => {})
                    }
                  >
                    Resolver
                  </Button>
                </Box>
              ))}
            </Paper>
          </Grid>
        )}

        {/* ── Fase 5: Historial de evaluaciones ── */}
        {evalRuns.length > 0 && (
          <Grid item xs={12} sm={6}>
            <Paper className={classes.card}>
              <Box display="flex" alignItems="center" justifyContent="space-between" mb={1}>
                <Typography className={classes.sectionTitle}>Evaluaciones automáticas</Typography>
                <Button
                  size="small"
                  disabled={evalRunning}
                  style={{ fontSize: 11, background: "#dbeafe", color: "#1d4ed8", borderRadius: 6, padding: "3px 10px" }}
                  onClick={() => {
                    setEvalRunning(true);
                    api.post("/bot/eval/run")
                      .then((r) => {
                        if (r.data?.result) {
                          setEvalRuns((prev) => [
                            {
                              run_at: r.data.result.runAt,
                              triggered_by: "manual",
                              total_cases: r.data.result.totalCases,
                              passed: r.data.result.passed,
                              failed: r.data.result.failed,
                              pass_rate: r.data.result.passRate,
                              avg_score: r.data.result.avgScore,
                              below_threshold: r.data.result.belowThreshold,
                            },
                            ...prev.slice(0, 4),
                          ]);
                        }
                      })
                      .catch(() => {})
                      .finally(() => setEvalRunning(false));
                  }}
                >
                  {evalRunning ? "Corriendo…" : "▶ Correr ahora"}
                </Button>
              </Box>
              <Divider style={{ marginBottom: 8 }} />
              {evalRuns.map((run, idx) => (
                <Box key={idx} className={classes.evalRow}>
                  <Box>
                    <Typography variant="body2" style={{ fontSize: 12, fontWeight: 600 }}>
                      {new Date(run.run_at).toLocaleString("es-AR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                      <span style={{ fontWeight: 400, color: "#94a3b8", fontSize: 11, marginLeft: 6 }}>{run.triggered_by}</span>
                    </Typography>
                    <LinearProgress
                      variant="determinate"
                      value={Math.round((Number(run.pass_rate ?? 0)) * 100)}
                      style={{ height: 4, borderRadius: 2, marginTop: 4, width: 120 }}
                      color={run.below_threshold ? "secondary" : "primary"}
                    />
                  </Box>
                  <Box textAlign="right">
                    <Chip
                      label={`${Math.round((Number(run.pass_rate ?? 0)) * 100)}%`}
                      size="small"
                      style={{
                        background: run.below_threshold ? "#fee2e2" : "#dcfce7",
                        color: run.below_threshold ? "#dc2626" : "#15803d",
                        fontWeight: 700, fontSize: 11,
                      }}
                    />
                    <Typography variant="caption" display="block" color="textSecondary" style={{ fontSize: 10, marginTop: 2 }}>
                      {run.passed}/{run.total_cases} casos
                    </Typography>
                  </Box>
                </Box>
              ))}
            </Paper>
          </Grid>
        )}

        {/* Resumen acciones rápidas */}
        <Grid item xs={12}>
          <Paper className={classes.card}>
            <Typography className={classes.sectionTitle}>
              Acciones rápidas
            </Typography>
            <Divider style={{ marginBottom: 12 }} />
            <Grid container spacing={2}>
              <Grid item>
                <Box
                  component="button"
                  onClick={async () => {
                    try {
                      const r = await api.post("/quotations/expire-stale");
                      alert(`✅ ${r.data.expired} cotizaciones marcadas como vencidas.`);
                      load();
                    } catch { alert("Error al procesar vencimientos."); }
                  }}
                  style={{
                    background: "#fee2e2", color: "#dc2626", border: "none",
                    borderRadius: 8, padding: "8px 16px", cursor: "pointer",
                    fontWeight: 600, fontSize: 13,
                  }}
                >
                  ⏳ Marcar cotizaciones vencidas
                </Box>
              </Grid>
              <Grid item>
                <Box
                  component="a"
                  href="/quotations"
                  style={{
                    background: "#dbeafe", color: "#1d4ed8", border: "none",
                    borderRadius: 8, padding: "8px 16px", cursor: "pointer",
                    fontWeight: 600, fontSize: 13, textDecoration: "none",
                    display: "inline-block",
                  }}
                >
                  📋 Ver todas las cotizaciones
                </Box>
              </Grid>
              <Grid item>
                <Box
                  component="a"
                  href="/bot"
                  style={{
                    background: "#dcfce7", color: "#15803d", border: "none",
                    borderRadius: 8, padding: "8px 16px", cursor: "pointer",
                    fontWeight: 600, fontSize: 13, textDecoration: "none",
                    display: "inline-block",
                  }}
                >
                  🤖 Panel del bot
                </Box>
              </Grid>
            </Grid>
          </Paper>
        </Grid>
      </Grid>
    </Container>
  );
};

export default MetricsDashboard;
