import React, { useEffect, useMemo, useState } from "react";
import { useHistory } from "react-router-dom";
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
import api from "../../../services/api";

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
  // Bot/db can store either 0..1 or 0..100 depending on version.
  // Normalize to a readable percentage.
  if (n > 1.5) return `${Math.round(n)}%`;
  return `${Math.round(n * 100)}%`;
}

function pickScore(m) {
  if (!m) return undefined;
  // Bot can return different field names depending on version.
  return (
    m.score ??
    m.finalScore ??
    m.matchScore ??
    m.totalScore ??
    m.similarity ??
    m.rank
  );
}

export default function Demands() {
  const history = useHistory();
  const [status, setStatus] = useState("open");
  const [loading, setLoading] = useState(false);
  const [demands, setDemands] = useState([]);
  const [expanded, setExpanded] = useState({});
  const [matches, setMatches] = useState({}); // demandId -> matches[]
  const [recontacts, setRecontacts] = useState({}); // demandId -> recontacts[]

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(() => makeDefaultForm());

  // Avoid using e.target inside setState updater (can cause truncated input in some builds).
  const onFieldChange = (field) => (e) => {
    const value = e?.target?.value ?? "";
    setForm((p) => ({ ...p, [field]: value }));
  };

  const onFieldCheck = (field) => (e) => {
    const checked = !!(e?.target?.checked);
    setForm((p) => ({ ...p, [field]: checked }));
  };

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
      const r = await runDemandScan({ sinceMinutes: 60 * 24 * 3650, threshold: 0.45 });
      const m = Number(r?.matches || 0);
      const n = Number(r?.notificationsSent || 0);
      toast.info(`Scan completo OK · matches: ${m} · notificados: ${n}`);
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

  const openDemandChat = async (demand) => {
    try {
      const rawNumber = String(demand?.remoteJid || demand?.phone || "");
      const digits = rawNumber.replace(/\D/g, "");
      const searchParam = digits || String(demand?.contactName || "").trim();
      if (!searchParam) {
        toast.info("Esta demanda no tiene teléfono o contacto vinculado todavía.");
        return;
      }

      const { data } = await api.get("/contacts", {
        params: { searchParam, pageNumber: 1, pageSize: 20 }
      });
      const contacts = Array.isArray(data?.contacts) ? data.contacts : [];
      const target = contacts.find((c) => {
        const candidate = String(c?.number || "").replace(/\D/g, "");
        return digits ? (candidate === digits || candidate.endsWith(digits) || digits.endsWith(candidate)) : false;
      }) || contacts[0];

      if (!target?.id) {
        toast.info("No encontré un contacto/ticket para este recontacto todavía.");
        return;
      }

      const ticketsResp = await api.get(`/contacts/${target.id}/tickets`, { params: { limit: 10 } });
      const tickets = Array.isArray(ticketsResp?.data?.tickets) ? ticketsResp.data.tickets : [];
      const ticket = tickets.find((t) => t?.status !== "closed") || tickets[0];

      if (!ticket?.id) {
        toast.info("Encontré el contacto, pero no tiene ticket abierto para navegar.");
        return;
      }

      history.push(`/tickets/${ticket.id}`);
    } catch (e) {
      toastError(e);
    }
  };

  return (
    <div className="flex h-full flex-col bg-[#0f1117]">
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between border-b border-white/[0.06] px-6 py-4">
        <div>
          <h1 className="text-lg font-bold text-white">Demandas</h1>
          <p className="mt-0.5 text-xs text-white/40">Búsquedas activas de clientes con alertas automáticas</p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="h-9 rounded-lg border border-white/[0.1] bg-[#1a1f2e] px-3 text-sm text-white/80 focus:outline-none focus:ring-1 focus:ring-amber-400/40"
          >
            <option value="open">Abiertas</option>
            <option value="closed">Cerradas</option>
          </select>
          <button
            onClick={forceScan}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-white/[0.1] bg-[#1a1f2e] px-3 text-sm text-white/70 hover:bg-white/[0.06] transition-colors"
          >
            <RefreshIcon style={{ fontSize: 16 }} /> Scan
          </button>
          <button
            onClick={forceRecontact}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-white/[0.1] bg-[#1a1f2e] px-3 text-sm text-white/70 hover:bg-white/[0.06] transition-colors"
          >
            <DoneAllIcon style={{ fontSize: 16 }} /> Recontactar
          </button>
          <button
            onClick={openNew}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-amber-400 px-4 text-sm font-bold text-black hover:bg-amber-300 transition-colors"
          >
            <AddIcon style={{ fontSize: 16 }} /> Nueva demanda
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto px-6 py-4">
        <div className="rounded-xl border border-white/[0.08] bg-[#171b26] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-left text-sm">
              <thead>
                <tr className="border-b border-white/[0.06]">
                  <th className="w-10 px-4 py-3" />
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-white/40">Cliente</th>
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-white/40">Pedido</th>
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-white/40">Años</th>
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-white/40">Presupuesto</th>
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-white/40">Notify</th>
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-white/40">Recontacto</th>
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-white/40">Actualizado</th>
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-white/40 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {demands.map((d) => (
                  <React.Fragment key={d.id}>
                    <tr className="border-b border-white/[0.04] hover:bg-white/[0.02] transition-colors">
                      <td className="px-4 py-3">
                        <button
                          onClick={() => toggleExpand(d.id)}
                          className="flex h-7 w-7 items-center justify-center rounded-lg text-white/40 hover:bg-white/[0.08] hover:text-white/80 transition-colors"
                        >
                          {expanded[d.id] ? <ExpandLessIcon style={{ fontSize: 18 }} /> : <ExpandMoreIcon style={{ fontSize: 18 }} />}
                        </button>
                      </td>
                      <td className="px-4 py-3">
                        <button
                          type="button"
                          onClick={() => openDemandChat(d)}
                          className="group text-left"
                          title="Abrir chat vinculado"
                        >
                          <p className="font-semibold text-white group-hover:text-amber-300 transition-colors">{d.contactName || "(sin nombre)"}</p>
                          <p className="text-xs text-white/40 group-hover:text-white/60 transition-colors">{d.remoteJid || d.phone || ""}</p>
                        </button>
                      </td>
                      <td className="px-4 py-3">
                        <p className="font-semibold text-white">{d.query}</p>
                        {(d.brand || d.model) && (
                          <p className="text-xs text-white/40">{`${d.brand || ""} ${d.model || ""}`.trim()}</p>
                        )}
                      </td>
                      <td className="px-4 py-3 text-white/60">
                        {(d.minYear || d.maxYear) ? `${d.minYear || ""}–${d.maxYear || ""}` : "—"}
                      </td>
                      <td className="px-4 py-3 text-white/60">
                        {d.maxPrice ? `${d.currency || ""} ${Number(d.maxPrice).toLocaleString("es-AR")}` : "—"}
                      </td>
                      <td className="px-4 py-3">
                        <Tooltip title={`Min score: ${scorePct(d.notifyMinScore)} · Cooldown: ${d.notifyCooldownMin} min`}>
                          <span>
                            <Switch
                              checked={!!d.notifyOnMatch}
                              onChange={async (e) => {
                                try { await updateDemand(d.id, { notifyOnMatch: e.target.checked }); load(); }
                                catch (err) { toastError(err); }
                              }}
                              color="primary"
                            />
                          </span>
                        </Tooltip>
                      </td>
                      <td className="px-4 py-3">
                        <Tooltip title={`Cada ${d.recontactEveryDays} días · Próx: ${d.recontactNextAt ? fmtDate(d.recontactNextAt) : "—"}`}>
                          <span className="flex items-center gap-2">
                            <Switch
                              checked={!!d.recontactEnabled}
                              onChange={async (e) => {
                                try { await updateDemand(d.id, { recontactEnabled: e.target.checked }); load(); }
                                catch (err) { toastError(err); }
                              }}
                              color="primary"
                            />
                            <span className="text-xs text-white/40">
                              {`${Number(d.recontactCount || 0)}/${Number(d.recontactMax || 0)}`}
                            </span>
                          </span>
                        </Tooltip>
                      </td>
                      <td className="px-4 py-3 text-xs text-white/40">{fmtDate(d.updatedAt)}</td>
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={() => openDemandChat(d)}
                          className="mr-1 inline-flex h-7 items-center justify-center rounded-lg border border-white/[0.08] px-2 text-xs text-white/50 hover:bg-white/[0.08] hover:text-white transition-colors"
                          title="Abrir chat"
                        >
                          Chat
                        </button>
                        <button
                          onClick={() => openEdit(d)}
                          className="mr-1 inline-flex h-7 w-7 items-center justify-center rounded-lg text-white/40 hover:bg-white/[0.08] hover:text-white/80 transition-colors"
                          title="Editar"
                        >
                          <EditIcon style={{ fontSize: 16 }} />
                        </button>
                        {d.status === "open" && (
                          <button
                            onClick={() => doClose(d.id)}
                            className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-white/40 hover:bg-red-500/20 hover:text-red-400 transition-colors"
                            title="Cerrar demanda"
                          >
                            <CloseIcon style={{ fontSize: 16 }} />
                          </button>
                        )}
                      </td>
                    </tr>

                    {/* Expanded row */}
                    {expanded[d.id] && (
                      <tr className="border-b border-white/[0.04] bg-[#13172000]">
                        <td colSpan={9} className="px-6 py-4">
                          <div className="rounded-lg border border-white/[0.06] bg-[#0f1117] p-4">
                            <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-white/40">Matches (top 30)</p>
                            <table className="w-full text-sm">
                              <thead>
                                <tr className="border-b border-white/[0.06]">
                                  <th className="py-2 pr-4 text-left text-xs text-white/30">Score</th>
                                  <th className="py-2 pr-4 text-left text-xs text-white/30">Auto</th>
                                  <th className="py-2 pr-4 text-left text-xs text-white/30">Año</th>
                                  <th className="py-2 pr-4 text-left text-xs text-white/30">Precio</th>
                                  <th className="py-2 text-left text-xs text-white/30">Notificado</th>
                                </tr>
                              </thead>
                              <tbody>
                                {(matches[d.id] || []).map((m) => (
                                  <tr key={m.id || `${m.vehicleId}-${m.notifiedAt || ""}`} className="border-b border-white/[0.03]">
                                    <td className="py-2 pr-4 font-bold text-amber-400">{scorePct(pickScore(m))}</td>
                                    <td className="py-2 pr-4 text-white/80">{m.vehicle?.title || `${m.vehicle?.brand || ""} ${m.vehicle?.model || ""}`.trim() || m.vehicleId}</td>
                                    <td className="py-2 pr-4 text-white/60">{m.vehicle?.year || "—"}</td>
                                    <td className="py-2 pr-4 text-white/60">{m.vehicle?.price ? `${m.vehicle?.currency || ""} ${m.vehicle?.price}` : "—"}</td>
                                    <td className="py-2 text-white/40 text-xs">{m.notifiedAt ? fmtDate(m.notifiedAt) : "—"}</td>
                                  </tr>
                                ))}
                                {!matches[d.id]?.length && (
                                  <tr><td colSpan={5} className="py-3 text-xs text-white/30">Sin matches todavía.</td></tr>
                                )}
                              </tbody>
                            </table>

                            <p className="mb-3 mt-5 text-xs font-semibold uppercase tracking-wider text-white/40">Historial de recontactos</p>
                            <table className="w-full text-sm">
                              <thead>
                                <tr className="border-b border-white/[0.06]">
                                  <th className="py-2 pr-4 text-left text-xs text-white/30">Fecha</th>
                                  <th className="py-2 pr-4 text-left text-xs text-white/30">Intento</th>
                                  <th className="py-2 pr-4 text-left text-xs text-white/30">Matches</th>
                                  <th className="py-2 text-left text-xs text-white/30">Mensaje</th>
                                </tr>
                              </thead>
                              <tbody>
                                {(recontacts[d.id] || []).map((rc) => (
                                  <tr key={rc.id} className="border-b border-white/[0.03]">
                                    <td className="py-2 pr-4 text-white/60 text-xs">{fmtDate(rc.sentAt)}</td>
                                    <td className="py-2 pr-4 text-white/60">{rc.attempt}</td>
                                    <td className="py-2 pr-4 text-white/60">{Array.isArray(rc.matchVehicleIds) && rc.matchVehicleIds.length ? rc.matchVehicleIds.length : 0}</td>
                                    <td className="py-2 text-white/40 text-xs whitespace-pre-wrap">{String(rc.message || "").slice(0, 300)}{String(rc.message || "").length > 300 ? "…" : ""}</td>
                                  </tr>
                                ))}
                                {!recontacts[d.id]?.length && (
                                  <tr><td colSpan={4} className="py-3 text-xs text-white/30">Sin recontactos aún.</td></tr>
                                )}
                              </tbody>
                            </table>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}

                {!loading && demands.length === 0 && (
                  <tr>
                    <td colSpan={9} className="py-16 text-center">
                      <p className="text-sm text-white/30">No hay demandas {status === "open" ? "abiertas" : "cerradas"}.</p>
                      <p className="mt-1 text-xs text-white/20">Creá una nueva demanda para empezar a rastrear búsquedas de clientes.</p>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <Dialog open={modalOpen} onClose={() => setModalOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>{editing ? `Editar demanda #${editing.id}` : "Nueva demanda"}</DialogTitle>
        <DialogContent>
          <Box display="flex" gridGap={12} flexWrap="wrap">
            <TextField
              label="Pedido (texto)"
              value={String(form.query ?? "")}
              onChange={onFieldChange("query")}
              variant="outlined"
              fullWidth
            />
            <TextField
              label="Marca"
              value={String(form.brand ?? "")}
              onChange={onFieldChange("brand")}
              variant="outlined"
              style={{ width: 200 }}
            />
            <TextField
              label="Modelo"
              value={String(form.model ?? "")}
              onChange={onFieldChange("model")}
              variant="outlined"
              style={{ width: 200 }}
            />
            <TextField
              label="Año min"
              value={String(form.minYear ?? "")}
              onChange={onFieldChange("minYear")}
              variant="outlined"
              style={{ width: 120 }}
              type="number"
            />
            <TextField
              label="Año max"
              value={String(form.maxYear ?? "")}
              onChange={onFieldChange("maxYear")}
              variant="outlined"
              style={{ width: 120 }}
              type="number"
            />
            <TextField
              label="Presupuesto max"
              value={String(form.maxPrice ?? "")}
              onChange={onFieldChange("maxPrice")}
              variant="outlined"
              style={{ width: 200 }}
              type="number"
            />
            <TextField
              select
              label="Moneda"
              value={String(form.currency ?? "ARS")}
              onChange={onFieldChange("currency")}
              variant="outlined"
              style={{ width: 120 }}
            >
              <MenuItem value="ARS">ARS</MenuItem>
              <MenuItem value="USD">USD</MenuItem>
            </TextField>
            <TextField
              label="Transmisión (opcional)"
              value={String(form.transmission ?? "")}
              onChange={onFieldChange("transmission")}
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
              value={String(form.contactName ?? "")}
              onChange={onFieldChange("contactName")}
              variant="outlined"
              style={{ width: 240 }}
            />
            <TextField
              label="Teléfono"
              value={String(form.phone ?? "")}
              onChange={onFieldChange("phone")}
              variant="outlined"
              style={{ width: 200 }}
            />
            <TextField
              label="remoteJid (549..@s.whatsapp.net)"
              value={String(form.remoteJid ?? "")}
              onChange={onFieldChange("remoteJid")}
              variant="outlined"
              style={{ width: 320 }}
            />
            <TextField
              label="Instance (opcional)"
              value={String(form.instance ?? "")}
              onChange={onFieldChange("instance")}
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
                  onChange={onFieldCheck("notifyOnMatch")}
                  color="primary"
                />
              }
              label="Enviar WhatsApp cuando haya match"
            />
            <TextField
              label="Min score notify (0-1)"
              type="number"
              value={String(form.notifyMinScore ?? "")}
              onChange={onFieldChange("notifyMinScore")}
              variant="outlined"
              style={{ width: 200 }}
              inputProps={{ step: 0.01, min: 0, max: 1 }}
            />
            <TextField
              label="Cooldown (min)"
              type="number"
              value={String(form.notifyCooldownMin ?? "")}
              onChange={onFieldChange("notifyCooldownMin")}
              variant="outlined"
              style={{ width: 180 }}
            />
            <FormControlLabel
              control={
                <Switch
                  checked={!!form.recontactEnabled}
                  onChange={onFieldCheck("recontactEnabled")}
                  color="primary"
                />
              }
              label="Recontacto automático"
            />
            <TextField
              label="Cada (días)"
              type="number"
              value={String(form.recontactEveryDays ?? "")}
              onChange={onFieldChange("recontactEveryDays")}
              variant="outlined"
              style={{ width: 140 }}
            />
            <TextField
              label="Máx envíos"
              type="number"
              value={String(form.recontactMax ?? "")}
              onChange={onFieldChange("recontactMax")}
              variant="outlined"
              style={{ width: 140 }}
            />
          </Box>

          <TextField
            label="Plantilla de mensaje (match) — opcional"
            value={String(form.matchTemplate ?? "")}
            onChange={onFieldChange("matchTemplate")}
            variant="outlined"
            fullWidth
            multiline
            minRows={3}
            helperText="Variables: {name} {query} {title} {year} {price} {currency} {score} {url}"
            style={{ marginTop: 12 }}
          />

          <TextField
            label="Plantilla de recontacto — opcional"
            value={String(form.recontactTemplate ?? "")}
            onChange={onFieldChange("recontactTemplate")}
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
    </div>
  );
}
