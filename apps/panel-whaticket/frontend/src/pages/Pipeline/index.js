import React, { useEffect, useMemo, useState } from "react";
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  MenuItem,
  Paper,
  TextField,
  Tooltip,
  Typography
} from "@material-ui/core";
import SettingsIcon from "@material-ui/icons/Settings";
import AddIcon from "@material-ui/icons/Add";
import DeleteIcon from "@material-ui/icons/Delete";
import ArrowUpwardIcon from "@material-ui/icons/ArrowUpward";
import ArrowDownwardIcon from "@material-ui/icons/ArrowDownward";

import { toast } from "react-toastify";
import MainContainer from "../../components/MainContainer";
import MainHeader from "../../components/MainHeader";
import MainHeaderButtonsWrapper from "../../components/MainHeaderButtonsWrapper";
import Title from "../../components/Title";
import toastError from "../../errors/toastError";

import {
  createPipelineStage,
  deletePipelineStage,
  getPipelineBoard,
  listPipelineStages,
  updatePipelineStage,
  updateTicketStage,
  updateTicketValue
} from "../../services/pipeline";

function moneyFmt(currency, value) {
  const v = Number(value);
  if (!Number.isFinite(v)) return "—";
  return `${currency} ${v.toLocaleString("es-AR")}`;
}

function avgHours(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return 0;
  return Math.round((ms / (1000 * 60 * 60)) * 10) / 10;
}

export default function Pipeline() {
  const [loading, setLoading] = useState(false);
  const [board, setBoard] = useState({ stages: [], ticketsByStage: {}, lookbackDays: 120 });

  // Stages modal
  const [stagesOpen, setStagesOpen] = useState(false);
  const [stages, setStages] = useState([]);
  const [stageForm, setStageForm] = useState({ name: "", category: "OPEN", isDefault: false });
  const [editingStage, setEditingStage] = useState(null);

  const loadBoard = async () => {
    setLoading(true);
    try {
      const data = await getPipelineBoard();
      setBoard(data);
    } catch (e) {
      toastError(e);
    } finally {
      setLoading(false);
    }
  };

  const loadStages = async () => {
    try {
      const data = await listPipelineStages();
      setStages(data?.stages || []);
    } catch (e) {
      toastError(e);
    }
  };

  useEffect(() => {
    loadBoard();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const metricsByStage = useMemo(() => {
    const out = {};
    for (const s of board.stages || []) {
      const arr = board.ticketsByStage?.[String(s.id)] || [];
      const now = Date.now();
      let totalMs = 0;
      let countWithTime = 0;
      let sumARS = 0;
      let sumUSD = 0;

      for (const t of arr) {
        const changedAt = t.stageChangedAt ? new Date(t.stageChangedAt).getTime() : null;
        if (changedAt) {
          totalMs += Math.max(0, now - changedAt);
          countWithTime += 1;
        }
        const v = Number(t.dealValue);
        if (Number.isFinite(v) && v > 0) {
          const c = String(t.dealCurrency || "ARS").toUpperCase();
          if (c === "USD") sumUSD += v;
          else sumARS += v;
        }
      }

      out[s.id] = {
        count: arr.length,
        avgHours: countWithTime ? avgHours(totalMs / countWithTime) : 0,
        sumARS,
        sumUSD
      };
    }
    return out;
  }, [board]);

  const onDragStart = (e, ticketId, fromStageId) => {
    e.dataTransfer.setData("text/plain", JSON.stringify({ ticketId, fromStageId }));
    e.dataTransfer.effectAllowed = "move";
  };

  const onDrop = async (e, toStageId) => {
    e.preventDefault();
    try {
      const raw = e.dataTransfer.getData("text/plain");
      if (!raw) return;
      const { ticketId } = JSON.parse(raw);
      if (!ticketId) return;
      await updateTicketStage(ticketId, toStageId);
      await loadBoard();
      toast.success("Movido");
    } catch (err) {
      toastError(err);
    }
  };

  const saveTicketValue = async (ticketId, dealValue, dealCurrency) => {
    try {
      await updateTicketValue(ticketId, { dealValue, dealCurrency });
    } catch (e) {
      toastError(e);
    }
  };

  const openStagesModal = async () => {
    await loadStages();
    setStagesOpen(true);
  };

  const resetStageForm = () => {
    setEditingStage(null);
    setStageForm({ name: "", category: "OPEN", isDefault: false });
  };

  const submitStage = async () => {
    try {
      const payload = {
        name: stageForm.name,
        category: stageForm.category,
        isDefault: !!stageForm.isDefault
      };
      if (editingStage?.id) {
        await updatePipelineStage(editingStage.id, payload);
        toast.success("Etapa actualizada");
      } else {
        await createPipelineStage(payload);
        toast.success("Etapa creada");
      }
      resetStageForm();
      await loadStages();
      await loadBoard();
    } catch (e) {
      toastError(e);
    }
  };

  const moveStageOrder = async (stage, dir) => {
    try {
      const idx = stages.findIndex((s) => s.id === stage.id);
      const swapIdx = idx + dir;
      if (swapIdx < 0 || swapIdx >= stages.length) return;
      const other = stages[swapIdx];
      await updatePipelineStage(stage.id, { order: other.order });
      await updatePipelineStage(other.id, { order: stage.order });
      await loadStages();
      await loadBoard();
    } catch (e) {
      toastError(e);
    }
  };

  const setDefault = async (stage) => {
    try {
      await updatePipelineStage(stage.id, { isDefault: true });
      await loadStages();
      await loadBoard();
    } catch (e) {
      toastError(e);
    }
  };

  const removeStage = async (stage) => {
    try {
      await deletePipelineStage(stage.id);
      await loadStages();
      await loadBoard();
      toast.success("Etapa eliminada");
    } catch (e) {
      toastError(e);
    }
  };

  return (
    <MainContainer>
      <MainHeader>
        <Title>Pipeline</Title>
        <MainHeaderButtonsWrapper>
          <Button
            variant="outlined"
            onClick={loadBoard}
            disabled={loading}
            style={{ marginRight: 8 }}
          >
            Refrescar
          </Button>
          <Button
            variant="outlined"
            startIcon={<SettingsIcon />}
            onClick={openStagesModal}
          >
            Etapas
          </Button>
        </MainHeaderButtonsWrapper>
      </MainHeader>

      <Box style={{ display: "flex", gap: 12, overflowX: "auto", paddingBottom: 8 }}>
        {(board.stages || []).map((stage) => {
          const arr = board.ticketsByStage?.[String(stage.id)] || [];
          const m = metricsByStage?.[stage.id] || { count: 0, avgHours: 0, sumARS: 0, sumUSD: 0 };
          return (
            <Paper
              key={stage.id}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => onDrop(e, stage.id)}
              style={{
                minWidth: 320,
                maxWidth: 360,
                flex: "0 0 auto",
                padding: 10,
                borderRadius: 12
              }}
            >
              <Box style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                <Typography variant="subtitle1" style={{ fontWeight: 700 }}>
                  {stage.name}
                </Typography>
                <Typography variant="caption" color="textSecondary">
                  {stage.category}
                </Typography>
              </Box>

              <Box style={{ display: "flex", gap: 10, marginTop: 6, flexWrap: "wrap" }}>
                <Typography variant="caption" color="textSecondary">
                  {m.count} tickets
                </Typography>
                <Typography variant="caption" color="textSecondary">
                  Avg: {m.avgHours}h
                </Typography>
                <Typography variant="caption" color="textSecondary">
                  {moneyFmt("ARS", m.sumARS)}
                </Typography>
                <Typography variant="caption" color="textSecondary">
                  {moneyFmt("USD", m.sumUSD)}
                </Typography>
              </Box>

              <Box style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 10 }}>
                {arr.map((t) => (
                  <Paper
                    key={t.id}
                    draggable
                    onDragStart={(e) => onDragStart(e, t.id, stage.id)}
                    style={{ padding: 10, borderRadius: 12, cursor: "grab" }}
                  >
                    <Box style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                      <Box style={{ minWidth: 0 }}>
                        <Typography variant="body2" style={{ fontWeight: 700 }} noWrap>
                          {t.contact?.name || "Contacto"}
                        </Typography>
                        <Typography variant="caption" color="textSecondary" noWrap>
                          #{t.id} · {t.status}
                        </Typography>
                      </Box>
                      <Tooltip title="Abrir ticket">
                        <Button
                          size="small"
                          variant="outlined"
                          href={`/tickets/${t.id}`}
                        >
                          Ver
                        </Button>
                      </Tooltip>
                    </Box>

                    <Box style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 10 }}>
                      <TextField
                        size="small"
                        variant="outlined"
                        label="Valor"
                        defaultValue={t.dealValue || ""}
                        onBlur={(e) => saveTicketValue(t.id, e.target.value === "" ? null : Number(e.target.value), t.dealCurrency || "ARS")}
                        style={{ flex: 1 }}
                      />
                      <TextField
                        size="small"
                        variant="outlined"
                        select
                        label="Moneda"
                        defaultValue={(t.dealCurrency || "ARS").toUpperCase()}
                        onChange={(e) => saveTicketValue(t.id, t.dealValue || null, e.target.value)}
                        style={{ width: 120 }}
                      >
                        <MenuItem value="ARS">ARS</MenuItem>
                        <MenuItem value="USD">USD</MenuItem>
                      </TextField>
                    </Box>

                    <Typography variant="caption" color="textSecondary" style={{ display: "block", marginTop: 8 }}>
                      Cambió: {t.stageChangedAt ? new Date(t.stageChangedAt).toLocaleString("es-AR") : "—"}
                    </Typography>
                  </Paper>
                ))}
              </Box>
            </Paper>
          );
        })}
      </Box>

      <Dialog open={stagesOpen} onClose={() => { setStagesOpen(false); resetStageForm(); }} maxWidth="sm" fullWidth>
        <DialogTitle>Etapas del Pipeline</DialogTitle>
        <DialogContent>
          <Box style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12 }}>
            <TextField
              label="Nombre"
              variant="outlined"
              size="small"
              value={stageForm.name}
              onChange={(e) => setStageForm((p) => ({ ...p, name: e.target.value }))}
              style={{ flex: 1 }}
            />
            <TextField
              select
              label="Categoría"
              variant="outlined"
              size="small"
              value={stageForm.category}
              onChange={(e) => setStageForm((p) => ({ ...p, category: e.target.value }))}
              style={{ width: 160 }}
            >
              <MenuItem value="OPEN">OPEN</MenuItem>
              <MenuItem value="WON">WON</MenuItem>
              <MenuItem value="LOST">LOST</MenuItem>
            </TextField>
            <Button
              variant="contained"
              color="primary"
              startIcon={<AddIcon />}
              onClick={submitStage}
              disabled={!String(stageForm.name || "").trim()}
            >
              {editingStage ? "Guardar" : "Agregar"}
            </Button>
          </Box>

          {(stages || []).map((s, idx) => (
            <Paper key={s.id} style={{ padding: 10, borderRadius: 12, marginBottom: 8 }}>
              <Box style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <Box style={{ minWidth: 0 }}>
                  <Typography variant="subtitle2" style={{ fontWeight: 700 }} noWrap>
                    {s.name} {s.isDefault ? "(default)" : ""}
                  </Typography>
                  <Typography variant="caption" color="textSecondary">
                    {s.category} · orden {s.order}
                  </Typography>
                </Box>
                <Box>
                  <Tooltip title="Subir">
                    <span>
                      <IconButton size="small" onClick={() => moveStageOrder(s, -1)} disabled={idx === 0}>
                        <ArrowUpwardIcon fontSize="small" />
                      </IconButton>
                    </span>
                  </Tooltip>
                  <Tooltip title="Bajar">
                    <span>
                      <IconButton size="small" onClick={() => moveStageOrder(s, +1)} disabled={idx === stages.length - 1}>
                        <ArrowDownwardIcon fontSize="small" />
                      </IconButton>
                    </span>
                  </Tooltip>
                  <Tooltip title="Editar">
                    <IconButton
                      size="small"
                      onClick={() => {
                        setEditingStage(s);
                        setStageForm({ name: s.name, category: s.category, isDefault: !!s.isDefault });
                      }}
                    >
                      <SettingsIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title="Set default">
                    <IconButton size="small" onClick={() => setDefault(s)}>
                      <Typography variant="caption" style={{ fontWeight: 800 }}>D</Typography>
                    </IconButton>
                  </Tooltip>
                  <Tooltip title="Eliminar">
                    <IconButton size="small" onClick={() => removeStage(s)}>
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </Box>
              </Box>
            </Paper>
          ))}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => { setStagesOpen(false); resetStageForm(); }}>Cerrar</Button>
        </DialogActions>
      </Dialog>
    </MainContainer>
  );
}
