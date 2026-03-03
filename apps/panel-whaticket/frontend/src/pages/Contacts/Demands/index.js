import React, { useEffect, useMemo, useState } from "react";
import { toast } from "react-toastify";

import {
  Box,
  Button,
  Collapse,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  IconButton,
  MenuItem,
  Paper,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography
} from "@material-ui/core";

import AddIcon from "@material-ui/icons/Add";
import RefreshIcon from "@material-ui/icons/Refresh";
import ExpandMoreIcon from "@material-ui/icons/ExpandMore";
import ExpandLessIcon from "@material-ui/icons/ExpandLess";
import DoneAllIcon from "@material-ui/icons/DoneAll";
import CloseIcon from "@material-ui/icons/Close";
import EditIcon from "@material-ui/icons/Edit";

import MainHeader from "../../../components/MainHeader";
import MainHeaderButtonsWrapper from "../../../components/MainHeaderButtonsWrapper";
import MainContainer from "../../../components/MainContainer";
import Title from "../../../components/Title";
import toastError from "../../../errors/toastError";

import openSocket from "../../../services/socket-io";
import {
  closeDemand,
  createDemand,
  listDemandMatches,
  listDemandRecontacts,
  listDemands,
  runDemandScan,
  runRecontact,
  updateDemand
} from "../../../services/demands";

// IMPORTANT:
// Always create a *fresh* form object when opening the modal.
// Reusing the same object reference can lead to subtle controlled-input bugs
// (e.g. characters "disappearing" when state gets overwritten by a stale reference).
const makeDefaultForm = () => ({
  query: "",
  brand: "",
  model: "",
  minYear: "",
  maxYear: "",
  maxPrice: "",
  currency: "ARS",
  transmission: "",
  contactName: "",
  phone: "",
  remoteJid: "",
  instance: "",
  notifyOnMatch: true,
  notifyMinScore: 0.72,
  notifyCooldownMin: 240,
  matchTemplate: "",
  recontactEnabled: false,
  recontactEveryDays: 7,
  recontactMax: 3,
  recontactTemplate: ""
});

function fmtDate(iso) {
  try {
    const d = new Date(iso);
    return d.toLocaleString("es-AR");
  } catch {
    return iso || "";
  }
}

function scorePct(s) {
  const n = Number(s);
  if (!Number.isFinite(n)) return "";
  return `${Math.round(n * 100)}%`;
}

export default function Demands() {
  const [status, setStatus] = useState("open");
  const [loading, setLoading] = useState(false);
  const [demands, setDemands] = useState([]);
  const [expanded, setExpanded] = useState({});
  const [matches, setMatches] = useState({}); // demandId -> matches[]
  const [recontacts, setRecontacts] = useState({}); // demandId -> recontacts[]

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(() => makeDefaultForm());

  const canSave = useMemo(() => String(form.query || "").trim().length > 0, [form.query]);

  const load = async () => {
    setLoading(true);
    try {
      const r = await listDemands({ status, limit: 200 });
      setDemands(r?.demands || []);
    } catch (e) {
      toastError(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  useEffect(() => {
    const socket = openSocket();
    socket.on("vehicle_demand_scan", (payload) => {
      const m = Number(payload?.matches || 0);
      const n = Number(payload?.notificationsSent || 0);
      if (m > 0) {
        toast.info(`Demandas: ${m} match(es) nuevos · Notificados: ${n}`);
        load();
      }
    });
    socket.on("vehicle_demand_recontact", (payload) => {
      const sent = Number(payload?.sent || 0);
      if (sent > 0) {
        toast.info(`Recontactos enviados: ${sent}`);
        load();
      }
    });
    return () => {
      socket.off("vehicle_demand_scan");
      socket.off("vehicle_demand_recontact");
      socket.off();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleExpand = async (id) => {
    const isOpen = !!expanded[id];
    setExpanded((p) => ({ ...p, [id]: !isOpen }));
    if (!isOpen && !matches[id]) {
      try {
        const r = await listDemandMatches(id, { limit: 30 });
        setMatches((p) => ({ ...p, [id]: r?.matches || [] }));
        const rr = await listDemandRecontacts(id, { limit: 30 });
        setRecontacts((p) => ({ ...p, [id]: rr?.recontacts || [] }));
      } catch (e) {
        toastError(e);
      }
    }
  };

  const openNew = () => {
    setEditing(null);
    setForm(makeDefaultForm());
    setModalOpen(true);
  };

  const openEdit = (d) => {
    setEditing(d);
    setForm({
      ...makeDefaultForm(),
      query: d.query || "",
      brand: d.brand || "",
      model: d.model || "",
      minYear: d.minYear ?? "",
      maxYear: d.maxYear ?? "",
      maxPrice: d.maxPrice ?? "",
      currency: d.currency || "ARS",
      transmission: d.transmission || "",
      contactName: d.contactName || "",
      phone: d.phone || "",
      remoteJid: d.remoteJid || "",
      instance: d.instance || "",
      notifyOnMatch: !!d.notifyOnMatch,
      notifyMinScore: Number(d.notifyMinScore ?? 0.72),
      notifyCooldownMin: Number(d.notifyCooldownMin ?? 240),
      matchTemplate: d.matchTemplate || "",
      recontactEnabled: !!d.recontactEnabled,
      recontactEveryDays: Number(d.recontactEveryDays ?? 7),
      recontactMax: Number(d.recontactMax ?? 3),
      recontactTemplate: d.recontactTemplate || ""
    });
    setModalOpen(true);
  };

  const save = async () => {
    try {
      const payload = {
        ...form,
        query: String(form.query || "").trim(),
        brand: String(form.brand || "").trim() || undefined,
        model: String(form.model || "").trim() || undefined,
        transmission: String(form.transmission || "").trim() || undefined,
        minYear: form.minYear === "" ? undefined : Number(form.minYear),
        maxYear: form.maxYear === "" ? undefined : Number(form.maxYear),
        maxPrice: form.maxPrice === "" ? undefined : Number(form.maxPrice),
        currency: String(form.currency || "").trim() || undefined,
        contactName: String(form.contactName || "").trim() || undefined,
        phone: String(form.phone || "").trim() || undefined,
        remoteJid: String(form.remoteJid || "").trim() || undefined,
        instance: String(form.instance || "").trim() || undefined,
        notifyMinScore: Number(form.notifyMinScore),
        notifyCooldownMin: Number(form.notifyCooldownMin),
        matchTemplate: String(form.matchTemplate || "").trim() || undefined,
        recontactEveryDays: Number(form.recontactEveryDays),
        recontactMax: Number(form.recontactMax),
        recontactTemplate: String(form.recontactTemplate || "").trim() || undefined
      };

      if (editing?.id) {
        await updateDemand(editing.id, payload);
        toast.success("Demanda actualizada");
      } else {
        await createDemand(payload);
        toast.success("Demanda creada");
      }
      setModalOpen(false);
      await load();
    } catch (e) {
      toastError(e);
    }
  };

  const doClose = async (id) => {
    try {
      await closeDemand(id);
      toast.success("Demanda cerrada");
      load();
    } catch (e) {
      toastError(e);
    }
  };

  const forceScan = async () => {
    try {
      const r = await runDemandScan({ sinceMinutes: 120 });
      const m = Number(r?.matches || 0);
      const n = Number(r?.notificationsSent || 0);
      toast.info(`Scan OK · matches: ${m} · notificados: ${n}`);
      load();
    } catch (e) {
      toastError(e);
    }
  };

  const forceRecontact = async () => {
    try {
      const r = await runRecontact();
      toast.info(`Recontactos: enviados ${Number(r?.sent || 0)}`);
      load();
    } catch (e) {
      toastError(e);
    }
  };

  return (
    <MainContainer>
      <MainHeader>
        <Title>CRM · Demandas</Title>
        <MainHeaderButtonsWrapper>
          <TextField
            select
            size="small"
            variant="outlined"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            style={{ minWidth: 140, marginRight: 8 }}
          >
            <MenuItem value="open">Abiertas</MenuItem>
            <MenuItem value="closed">Cerradas</MenuItem>
          </TextField>
          <Button variant="outlined" onClick={forceScan} startIcon={<RefreshIcon />}>
            Scan
          </Button>
          <Button variant="outlined" onClick={forceRecontact} startIcon={<DoneAllIcon />} style={{ marginLeft: 8 }}>
            Recontactar
          </Button>
          <Button
            variant="contained"
            color="primary"
            onClick={openNew}
            startIcon={<AddIcon />}
            style={{ marginLeft: 8 }}
          >
            Nueva
          </Button>
        </MainHeaderButtonsWrapper>
      </MainHeader>

      <Paper style={{ flex: 1, padding: 8, overflowY: "auto" }}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell />
              <TableCell>Cliente</TableCell>
              <TableCell>Pedido</TableCell>
              <TableCell>Años</TableCell>
              <TableCell>Presupuesto</TableCell>
              <TableCell>Auto-notify</TableCell>
              <TableCell>Recontacto</TableCell>
              <TableCell>Actualizado</TableCell>
              <TableCell align="right">Acciones</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {demands.map((d) => (
              <React.Fragment key={d.id}>
                <TableRow hover>
                  <TableCell width={48}>
                    <IconButton size="small" onClick={() => toggleExpand(d.id)}>
                      {expanded[d.id] ? <ExpandLessIcon /> : <ExpandMoreIcon />}
                    </IconButton>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2" style={{ fontWeight: 600 }}>
                      {d.contactName || "(sin nombre)"}
                    </Typography>
                    <Typography variant="caption" color="textSecondary">
                      {d.remoteJid || d.phone || ""}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2" style={{ fontWeight: 600 }}>
                      {d.query}
                    </Typography>
                    <Typography variant="caption" color="textSecondary">
                      {(d.brand || d.model) ? `${d.brand || ""} ${d.model || ""}`.trim() : ""}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    {(d.minYear || d.maxYear) ? `${d.minYear || ""}–${d.maxYear || ""}` : "—"}
                  </TableCell>
                  <TableCell>
                    {d.maxPrice ? `${d.currency || ""} ${d.maxPrice}` : "—"}
                  </TableCell>
                  <TableCell>
                    <Tooltip title={`Min score: ${scorePct(d.notifyMinScore)} · Cooldown: ${d.notifyCooldownMin} min`}>
                      <span>
                        <Switch
                          checked={!!d.notifyOnMatch}
                          onChange={async (e) => {
                            try {
                              await updateDemand(d.id, { notifyOnMatch: e.target.checked });
                              load();
                            } catch (err) {
                              toastError(err);
                            }
                          }}
                          color="primary"
                        />
                      </span>
                    </Tooltip>
                  </TableCell>
                  <TableCell>
                    <Tooltip title={`Cada ${d.recontactEveryDays} días · ${d.recontactCount}/${d.recontactMax} · Próx: ${d.recontactNextAt ? fmtDate(d.recontactNextAt) : "—"}`}>
                      <span>
                        <Box display="flex" alignItems="center" gridGap={8}>
                          <Switch
                            checked={!!d.recontactEnabled}
                            onChange={async (e) => {
                              try {
                                await updateDemand(d.id, { recontactEnabled: e.target.checked });
                                load();
                              } catch (err) {
                                toastError(err);
                              }
                            }}
                            color="primary"
                          />
                          <Typography variant="caption" color="textSecondary">
                            {`${Number(d.recontactCount || 0)}/${Number(d.recontactMax || 0)} · quedan ${Math.max(0, Number(d.recontactMax || 0) - Number(d.recontactCount || 0))}`}
                          </Typography>
                        </Box>
                      </span>
                    </Tooltip>
                  </TableCell>
                  <TableCell>{fmtDate(d.updatedAt)}</TableCell>
                  <TableCell align="right">
                    <Tooltip title="Editar">
                      <IconButton size="small" onClick={() => openEdit(d)}>
                        <EditIcon />
                      </IconButton>
                    </Tooltip>
                    {d.status === "open" && (
                      <Tooltip title="Cerrar">
                        <IconButton size="small" onClick={() => doClose(d.id)}>
                          <CloseIcon />
                        </IconButton>
                      </Tooltip>
                    )}
                  </TableCell>
                </TableRow>

                <TableRow>
                  <TableCell style={{ paddingBottom: 0, paddingTop: 0 }} colSpan={9}>
                    <Collapse in={!!expanded[d.id]} timeout="auto" unmountOnExit>
                      <Box margin={1}>
                        <Typography variant="subtitle2" gutterBottom>
                          Matches (top 30)
                        </Typography>
                        <Table size="small">
                          <TableHead>
                            <TableRow>
                              <TableCell>Score</TableCell>
                              <TableCell>Auto</TableCell>
                              <TableCell>Año</TableCell>
                              <TableCell>Precio</TableCell>
                              <TableCell>Notificado</TableCell>
                            </TableRow>
                          </TableHead>
                          <TableBody>
                            {(matches[d.id] || []).map((m) => (
                              <TableRow key={m.id}>
                                <TableCell style={{ fontWeight: 700 }}>{scorePct(m.score)}</TableCell>
                                <TableCell>
                                  {m.vehicle?.title || `${m.vehicle?.brand || ""} ${m.vehicle?.model || ""}`.trim() || m.vehicleId}
                                </TableCell>
                                <TableCell>{m.vehicle?.year || "—"}</TableCell>
                                <TableCell>
                                  {m.vehicle?.price ? `${m.vehicle?.currency || ""} ${m.vehicle?.price}` : "—"}
                                </TableCell>
                                <TableCell>{m.notifiedAt ? fmtDate(m.notifiedAt) : "—"}</TableCell>
                              </TableRow>
                            ))}
                            {!matches[d.id]?.length && (
                              <TableRow>
                                <TableCell colSpan={5}>
                                  <Typography variant="caption" color="textSecondary">
                                    Sin matches todavía.
                                  </Typography>
                                </TableCell>
                              </TableRow>
                            )}
                          </TableBody>
                        </Table>

                        <Box mt={2}>
                          <Typography variant="subtitle2" gutterBottom>
                            Historial de recontactos (últimos 30)
                          </Typography>
                          <Table size="small">
                            <TableHead>
                              <TableRow>
                                <TableCell>Fecha</TableCell>
                                <TableCell>Intento</TableCell>
                                <TableCell>Incluyó matches</TableCell>
                                <TableCell>Mensaje</TableCell>
                              </TableRow>
                            </TableHead>
                            <TableBody>
                              {(recontacts[d.id] || []).map((rc) => (
                                <TableRow key={rc.id}>
                                  <TableCell>{fmtDate(rc.sentAt)}</TableCell>
                                  <TableCell>{rc.attempt}</TableCell>
                                  <TableCell>{Array.isArray(rc.matchVehicleIds) && rc.matchVehicleIds.length ? rc.matchVehicleIds.length : 0}</TableCell>
                                  <TableCell>
                                    <Typography variant="caption" style={{ whiteSpace: "pre-wrap" }}>
                                      {String(rc.message || "").slice(0, 300)}
                                      {String(rc.message || "").length > 300 ? "…" : ""}
                                    </Typography>
                                  </TableCell>
                                </TableRow>
                              ))}
                              {!recontacts[d.id]?.length && (
                                <TableRow>
                                  <TableCell colSpan={4}>
                                    <Typography variant="caption" color="textSecondary">
                                      Sin recontactos aún.
                                    </Typography>
                                  </TableCell>
                                </TableRow>
                              )}
                            </TableBody>
                          </Table>
                        </Box>
                      </Box>
                    </Collapse>
                  </TableCell>
                </TableRow>
              </React.Fragment>
            ))}

            {!loading && demands.length === 0 && (
              <TableRow>
                <TableCell colSpan={9}>
                  <Typography variant="body2" color="textSecondary">
                    No hay demandas.
                  </Typography>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Paper>

      <Dialog open={modalOpen} onClose={() => setModalOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>{editing ? `Editar demanda #${editing.id}` : "Nueva demanda"}</DialogTitle>
        <DialogContent>
          <Box display="flex" gridGap={12} flexWrap="wrap">
            <TextField
              label="Pedido (texto)"
              value={form.query}
              onChange={(e) => setForm((p) => ({ ...p, query: e?.target?.value ?? "" }))}
              variant="outlined"
              fullWidth
            />
            <TextField
              label="Marca"
              value={form.brand}
              onChange={(e) => setForm((p) => ({ ...p, brand: e?.target?.value ?? "" }))}
              variant="outlined"
              style={{ width: 200 }}
            />
            <TextField
              label="Modelo"
              value={form.model}
              onChange={(e) => setForm((p) => ({ ...p, model: e?.target?.value ?? "" }))}
              variant="outlined"
              style={{ width: 200 }}
            />
            <TextField
              label="Año min"
              value={form.minYear}
              onChange={(e) => setForm((p) => ({ ...p, minYear: e?.target?.value ?? "" }))}
              variant="outlined"
              style={{ width: 120 }}
              type="number"
            />
            <TextField
              label="Año max"
              value={form.maxYear}
              onChange={(e) => setForm((p) => ({ ...p, maxYear: e?.target?.value ?? "" }))}
              variant="outlined"
              style={{ width: 120 }}
              type="number"
            />
            <TextField
              label="Presupuesto max"
              value={form.maxPrice}
              onChange={(e) => setForm((p) => ({ ...p, maxPrice: e?.target?.value ?? "" }))}
              variant="outlined"
              style={{ width: 200 }}
              type="number"
            />
            <TextField
              select
              label="Moneda"
              value={form.currency}
              onChange={(e) => setForm((p) => ({ ...p, currency: e?.target?.value ?? "" }))}
              variant="outlined"
              style={{ width: 120 }}
            >
              <MenuItem value="ARS">ARS</MenuItem>
              <MenuItem value="USD">USD</MenuItem>
            </TextField>
            <TextField
              label="Transmisión (opcional)"
              value={form.transmission}
              onChange={(e) => setForm((p) => ({ ...p, transmission: e?.target?.value ?? "" }))}
              variant="outlined"
              style={{ width: 220 }}
            />
          </Box>

          <Box mt={2} mb={1}>
            <Typography variant="subtitle2">Cliente (para auto-notify / recontacto)</Typography>
          </Box>
          <Box display="flex" gridGap={12} flexWrap="wrap">
            <TextField
              label="Nombre"
              value={form.contactName}
              onChange={(e) => setForm((p) => ({ ...p, contactName: e?.target?.value ?? "" }))}
              variant="outlined"
              style={{ width: 240 }}
            />
            <TextField
              label="Teléfono"
              value={form.phone}
              onChange={(e) => setForm((p) => ({ ...p, phone: e?.target?.value ?? "" }))}
              variant="outlined"
              style={{ width: 200 }}
            />
            <TextField
              label="remoteJid (549..@s.whatsapp.net)"
              value={form.remoteJid}
              onChange={(e) => setForm((p) => ({ ...p, remoteJid: e?.target?.value ?? "" }))}
              variant="outlined"
              style={{ width: 320 }}
            />
            <TextField
              label="Instance (opcional)"
              value={form.instance}
              onChange={(e) => setForm((p) => ({ ...p, instance: e?.target?.value ?? "" }))}
              variant="outlined"
              style={{ width: 220 }}
            />
          </Box>

          <Box mt={2} mb={1}>
            <Typography variant="subtitle2">Automatizaciones</Typography>
          </Box>

          <Box display="flex" flexWrap="wrap" gridGap={12}>
            <FormControlLabel
              control={
                <Switch
                  checked={!!form.notifyOnMatch}
                  onChange={(e) => setForm((p) => ({ ...p, notifyOnMatch: e?.target?.checked ?? false }))}
                  color="primary"
                />
              }
              label="Enviar WhatsApp cuando haya match"
            />
            <TextField
              label="Min score notify (0-1)"
              type="number"
              value={form.notifyMinScore}
              onChange={(e) => setForm((p) => ({ ...p, notifyMinScore: e?.target?.value ?? "" }))}
              variant="outlined"
              style={{ width: 200 }}
              inputProps={{ step: 0.01, min: 0, max: 1 }}
            />
            <TextField
              label="Cooldown (min)"
              type="number"
              value={form.notifyCooldownMin}
              onChange={(e) => setForm((p) => ({ ...p, notifyCooldownMin: e?.target?.value ?? "" }))}
              variant="outlined"
              style={{ width: 180 }}
            />
            <FormControlLabel
              control={
                <Switch
                  checked={!!form.recontactEnabled}
                  onChange={(e) => setForm((p) => ({ ...p, recontactEnabled: e?.target?.checked ?? false }))}
                  color="primary"
                />
              }
              label="Recontacto automático"
            />
            <TextField
              label="Cada (días)"
              type="number"
              value={form.recontactEveryDays}
              onChange={(e) => setForm((p) => ({ ...p, recontactEveryDays: e?.target?.value ?? "" }))}
              variant="outlined"
              style={{ width: 140 }}
            />
            <TextField
              label="Máx envíos"
              type="number"
              value={form.recontactMax}
              onChange={(e) => setForm((p) => ({ ...p, recontactMax: e?.target?.value ?? "" }))}
              variant="outlined"
              style={{ width: 140 }}
            />
          </Box>

          <TextField
            label="Plantilla de mensaje (match) — opcional"
            value={form.matchTemplate}
            onChange={(e) => setForm((p) => ({ ...p, matchTemplate: e?.target?.value ?? "" }))}
            variant="outlined"
            fullWidth
            multiline
            minRows={3}
            helperText="Variables: {name} {query} {title} {year} {price} {currency} {score} {url}"
            style={{ marginTop: 12 }}
          />

          <TextField
            label="Plantilla de recontacto — opcional"
            value={form.recontactTemplate}
            onChange={(e) => setForm((p) => ({ ...p, recontactTemplate: e?.target?.value ?? "" }))}
            variant="outlined"
            fullWidth
            multiline
            minRows={3}
            helperText="Variables: {name} {query} {count}"
            style={{ marginTop: 12 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setModalOpen(false)}>Cancelar</Button>
          <Button onClick={save} color="primary" variant="contained" disabled={!canSave}>
            Guardar
          </Button>
        </DialogActions>
      </Dialog>
    </MainContainer>
  );
}
