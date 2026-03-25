import React, { useEffect, useMemo, useState } from "react";
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
  CircularProgress,
} from "@material-ui/core";
import { toast } from "react-toastify";
import { format } from "date-fns";
import api from "../../services/api";

/**
 * QuotationsManager (MVP)
 * - Lista, crea, edita, elimina y "envía" cotizaciones.
 * - Integra búsqueda simple de vehículos y clientes (best-effort).
 * - Evita crashes de build/runtime (sin JSX colgado, imports arriba).
 */

const MS_DAY = 24 * 60 * 60 * 1000;
// Compat: algunos bundles viejos referencian `msDay`
const msDay = MS_DAY; // eslint-disable-line no-unused-vars

function toastError(err, fallback = "Ocurrió un error") {
  const msg =
    err?.response?.data?.error ||
    err?.response?.data?.message ||
    err?.message ||
    fallback;
  toast.error(msg);
}

async function safeGet(url, config) {
  try {
    const { data } = await api.get(url, config);
    return data;
  } catch (e) {
    throw e;
  }
}

const normalizeVehicleToken = (value) => String(value ?? "").trim();

const normalizeVehicleCompare = (value) =>
  normalizeVehicleToken(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const compactUniqueVehicleParts = (parts) => {
  const seen = new Set();
  return (parts || []).reduce((acc, part) => {
    const value = normalizeVehicleToken(part);
    const key = normalizeVehicleCompare(value);
    if (!value || !key || seen.has(key)) return acc;
    seen.add(key);
    acc.push(value);
    return acc;
  }, []);
};

const buildVehicleLabel = (v) => {
  if (!v) return "";
  const brand = normalizeVehicleToken(v.marca || v.brand);
  const model = normalizeVehicleToken(v.modelo || v.model);
  const year = normalizeVehicleToken(v.year);
  const version = normalizeVehicleToken(v.version);
  const title = normalizeVehicleToken(v.title || v.name);
  const explicitLabel = normalizeVehicleToken(v.label);

  const base = compactUniqueVehicleParts([brand, model, year]);
  const baseNorm = normalizeVehicleCompare(base.join(" "));
  const versionNorm = normalizeVehicleCompare(version);
  const titleNorm = normalizeVehicleCompare(title);
  const extras = [];

  if (version && versionNorm && !baseNorm.includes(versionNorm)) extras.push(version);
  if (title && titleNorm && !baseNorm.includes(titleNorm) && !extras.some((x) => normalizeVehicleCompare(x) === titleNorm)) {
    extras.push(title);
  }

  return (
    compactUniqueVehicleParts([...base, ...extras]).join(" ").trim() ||
    explicitLabel ||
    title ||
    compactUniqueVehicleParts([brand, model, version, year]).join(" ").trim()
  );
};

async function safePost(url, payload) {
  const { data } = await api.post(url, payload);
  return data;
}

async function safePut(url, payload) {
  const { data } = await api.put(url, payload);
  return data;
}

async function safeDelete(url) {
  const { data } = await api.delete(url);
  return data;
}

const emptyForm = {
  id: null,
  title: "",
  contactId: "",
  contactName: "",
  contactPhone: "",
  vehicleId: "",
  vehicleLabel: "",
  vehicleData: null,
  currency: "ARS",
  price: "",
  notes: "",
  status: "draft", // draft | sent | accepted | rejected
};

export default function QuotationsManager() {
  const [loading, setLoading] = useState(false);
  const [quotations, setQuotations] = useState([]);
  const [search, setSearch] = useState("");

  const [dialogOpen, setDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ ...emptyForm });

  // lookups (best-effort)
  const [vehicleQuery, setVehicleQuery] = useState("");
  const [vehicleOptions, setVehicleOptions] = useState([]);
  const [contactQuery, setContactQuery] = useState("");
  const [contactOptions, setContactOptions] = useState([]);
  const [lookupLoading, setLookupLoading] = useState(false);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return quotations;
    return quotations.filter((it) => {
      const hay = [
        it?.id,
        it?.title,
        it?.contactName,
        it?.vehicleLabel,
        it?.vehicle?.name,
        it?.vehicle?.title,
        it?.status,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [quotations, search]);

  const fetchQuotations = async () => {
    setLoading(true);
    try {
      // API esperada: GET /quotations -> []
      const data = await safeGet("/quotations");
      setQuotations(Array.isArray(data) ? data : data?.quotations || data?.rows || []);
    } catch (e) {
      toastError(e, "No pude cargar las cotizaciones");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchQuotations();
  }, []);

  const openCreate = () => {
    setForm({ ...emptyForm });
    setVehicleQuery("");
    setContactQuery("");
    setVehicleOptions([]);
    setContactOptions([]);
    setDialogOpen(true);
    loadVehicles("");
    loadContacts("");
  };

  const openEdit = (q) => {
    setForm({
      ...emptyForm,
      id: q?.id ?? null,
      title: q?.title ?? "",
      contactId: q?.contactId ?? q?.contact?.id ?? q?.clientRefId ?? "",
      contactName: q?.contactName ?? q?.contact?.name ?? q?.clientName ?? "",
      contactPhone: q?.contact?.number ?? q?.clientPhone ?? "",
      vehicleId: q?.vehicleId ?? q?.vehicle?.id ?? q?.vehicleRefId ?? "",
      vehicleLabel: buildVehicleLabel(q?.vehicleData || q?.vehicle || { label: q?.vehicleLabel }) || q?.vehicleLabel || "",
      vehicleData: q?.vehicleData ?? null,
      currency: q?.currency ?? "ARS",
      price: q?.price ?? q?.totalPrice ?? "",
      notes: q?.notes ?? "",
      status: q?.status ?? "draft",
    });
    setDialogOpen(true);
    loadVehicles("");
    loadContacts("");
  };

  const closeDialog = () => {
    setDialogOpen(false);
    setSaving(false);
  };

  const validate = () => {
    if (!String(form.contactId || "").trim() && !String(form.contactName || "").trim()) {
      toast.error("Seleccioná un cliente o completá nombre/teléfono.");
      return false;
    }
    if (!String(form.vehicleId || "").trim() && !String(form.vehicleLabel || "").trim()) {
      toast.error("Seleccioná un vehículo (o completá el modelo).");
      return false;
    }
    return true;
  };

  const save = async () => {
    if (!validate()) return;

    setSaving(true);
    try {
      let resolvedContactName = String(form.contactName || "").trim();
      let resolvedContactPhone = String(form.contactPhone || "").trim();
      let resolvedVehicleLabel = String(form.vehicleLabel || "").trim();
      let resolvedVehicleData = form.vehicleData || null;
      let payloadPrice = form.price ? Number(form.price) : undefined;

      if (!resolvedContactName && form.contactId) {
        const found = contactOptions.find((c) => String(c.id) === String(form.contactId));
        if (found) {
          resolvedContactName = found.label || resolvedContactName;
          resolvedContactPhone = found.phone || resolvedContactPhone;
        } else {
          try {
            const data = await safeGet(`/contacts/${form.contactId}`);
            resolvedContactName = data?.name || resolvedContactName;
            resolvedContactPhone = data?.number || resolvedContactPhone;
          } catch {
            // best-effort
          }
        }
      }

      if (!resolvedVehicleLabel && form.vehicleId) {
        const found = vehicleOptions.find((v) => String(v.id) === String(form.vehicleId));
        if (found) {
          resolvedVehicleLabel = found.label || resolvedVehicleLabel;
          resolvedVehicleData = found.raw || resolvedVehicleData;
          if (payloadPrice === undefined && Number.isFinite(Number(found?.raw?.precio ?? found?.raw?.price))) {
            payloadPrice = Number(found.raw?.precio ?? found.raw?.price);
          }
        } else {
          try {
            const data = await safeGet("/vehicles", {
              params: { id: form.vehicleId, limit: 1 },
            });
            const list = data?.vehicles || data?.rows || data?.data || [];
            const match = (list || []).find((v) => String(v.id) === String(form.vehicleId));
            if (match) {
              resolvedVehicleLabel = buildVehicleLabel(match) || resolvedVehicleLabel;
              resolvedVehicleData = match;
              if (!form.price && Number.isFinite(Number(match?.precio ?? match?.price))) {
                payloadPrice = Number(match?.precio ?? match?.price);
              }
            }
          } catch (err) {
            console.error("[quotations] vehicle lookup by id failed", err);
          }
        }
      }

      const payload = {
        meta: form.title ? { title: form.title } : undefined,
        contactId: form.contactId || undefined,
        clientId: form.contactId || undefined,
        clientRefId: form.contactId || undefined,
        clientName: resolvedContactName || undefined,
        clientPhone: resolvedContactPhone || undefined,
        vehicleId: form.vehicleId || undefined,
        vehicleRefId: form.vehicleId || undefined,
        vehicleLabel: resolvedVehicleLabel || undefined,
        vehicleData: resolvedVehicleData || undefined,
        currency: form.currency,
        basePrice: payloadPrice,
        totalPrice: payloadPrice,
        notes: form.notes || undefined,
        status: form.status,
      };

      if (form.id) {
        await safePut(`/quotations/${form.id}`, payload);
        toast.success("Cotización actualizada");
      } else {
        await safePost("/quotations", payload);
        toast.success("Cotización creada");
      }

      await fetchQuotations();
      closeDialog();
    } catch (e) {
      toastError(e, "No pude guardar la cotización");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (q) => {
    if (!q?.id) return;
    // eslint-disable-next-line no-alert
    const ok = window.confirm(`Eliminar cotización #${q.id}?`);
    if (!ok) return;

    try {
      await safeDelete(`/quotations/${q.id}`);
      toast.success("Cotización eliminada");
      await fetchQuotations();
    } catch (e) {
      toastError(e, "No pude eliminar la cotización");
    }
  };

  const send = async (q) => {
    if (!q?.id) return;
    try {
      await safePost(`/quotations/${q.id}/send`, {});
      toast.success("Cotización enviada");
      await fetchQuotations();
    } catch (e) {
      toastError(e, "No pude enviar la cotización");
    }
  };

  const loadVehicles = async (q) => {
    const query = (q ?? "").trim();
    const params = query ? { q: query, searchParam: query, limit: 25 } : { limit: 20 };
    setLookupLoading(true);
    try {
      // Backend contract: /vehicles?q=... -> { vehicles: [] }
      const data = await safeGet("/vehicles", { params });
      const list =
        (Array.isArray(data) ? data : null) ||
        data?.vehicles ||
        data?.rows ||
        data?.data ||
        [];
      const normalized = (list || []).slice(0, 15).map((v) => ({
        id: v.id ?? v.vehicleId ?? v.uuid ?? "",
        label: buildVehicleLabel(v) || String(v.id || ""),
        raw: v,
      }));
      setVehicleOptions(normalized);
    } catch (e) {
      // No spamear toast por cada tecla
      setVehicleOptions([]);
    } finally {
      setLookupLoading(false);
    }
  };

  const loadContacts = async (q) => {
    const query = (q ?? "").trim();
    const params = query ? { searchParam: query, pageNumber: 1, pageSize: 25 } : { pageNumber: 1, pageSize: 20 };
    setLookupLoading(true);
    try {
      // Backend contract: /contacts?searchParam=... -> { contacts: [] }
      const data = await safeGet("/contacts", { params });
      const list =
        (Array.isArray(data) ? data : null) ||
        data?.contacts ||
        data?.rows ||
        data?.data ||
        [];
      const normalized = (list || []).slice(0, 15).map((c) => ({
        id: c.id ?? c.contactId ?? c.uuid ?? "",
        label: c.name || c.pushname || c.number || String(c.id || ""),
        phone: c.number || "",
        raw: c,
      }));
      setContactOptions(normalized);
    } catch (e) {
      setContactOptions([]);
    } finally {
      setLookupLoading(false);
    }
  };

  // debounce simple
  useEffect(() => {
    const t = setTimeout(() => loadVehicles(vehicleQuery), 250);
    return () => clearTimeout(t);
  }, [vehicleQuery]);

  useEffect(() => {
    const t = setTimeout(() => loadContacts(contactQuery), 250);
    return () => clearTimeout(t);
  }, [contactQuery]);

  return (
    <div style={{ padding: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
        <Typography variant="h5">Cotizaciones</Typography>
        <Button color="primary" variant="contained" onClick={openCreate}>
          Nueva cotización
        </Button>
      </div>

      <Paper style={{ padding: 12, marginTop: 12 }}>
        <TextField
          fullWidth
          variant="outlined"
          label="Buscar (cliente, vehículo, estado, id...)"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </Paper>

      <Paper style={{ marginTop: 12 }}>
        {loading ? (
          <div style={{ padding: 16, display: "flex", gap: 12, alignItems: "center" }}>
            <CircularProgress size={20} />
            <Typography variant="body2">Cargando...</Typography>
          </div>
        ) : (
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>#</TableCell>
                <TableCell>Cliente</TableCell>
                <TableCell>Vehículo</TableCell>
                <TableCell>Precio</TableCell>
                <TableCell>Estado</TableCell>
                <TableCell>Actualizado</TableCell>
                <TableCell align="right">Acciones</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {filtered.map((q) => {
                const updatedAt = q.updatedAt || q.updated_at || q.createdAt || q.created_at;
                const when = updatedAt ? (() => {
                  try { return format(new Date(updatedAt), "dd/MM/yyyy HH:mm"); } catch { return String(updatedAt); }
                })() : "-";
                const price = q.totalPrice ?? q.basePrice ?? q.price ?? q.amount ?? "";
                const currency = q.currency ?? "ARS";
                return (
                  <TableRow key={q.id || Math.random()}>
                    <TableCell>{q.id ?? "-"}</TableCell>
                    <TableCell>{q.clientName ?? q.contactName ?? q.contact?.name ?? "-"}</TableCell>
                    <TableCell>{q.vehicleLabel ?? q.vehicle?.name ?? q.vehicle?.title ?? "-"}</TableCell>
                    <TableCell>
                      {price !== "" ? `${currency} ${price}` : "-"}
                    </TableCell>
                    <TableCell>{q.status ?? "draft"}</TableCell>
                    <TableCell>{when}</TableCell>
                    <TableCell align="right">
                      <Button size="small" onClick={() => openEdit(q)}>Editar</Button>
                      <Button size="small" onClick={() => send(q)}>Enviar</Button>
                      <Button size="small" color="secondary" onClick={() => remove(q)}>Eliminar</Button>
                    </TableCell>
                  </TableRow>
                );
              })}
              {filtered.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7}>
                    <Typography variant="body2" style={{ padding: 12 }}>
                      No hay cotizaciones.
                    </Typography>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        )}
      </Paper>

      <Dialog open={dialogOpen} onClose={closeDialog} fullWidth maxWidth="md">
        <DialogTitle>{form.id ? `Editar cotización #${form.id}` : "Nueva cotización"}</DialogTitle>
        <DialogContent dividers>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <TextField
              variant="outlined"
              label="Título (opcional)"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              fullWidth
            />

            <FormControl variant="outlined" fullWidth>
              <InputLabel>Estado</InputLabel>
              <Select
                value={form.status}
                onChange={(e) => setForm({ ...form, status: e.target.value })}
                label="Estado"
              >
                <MenuItem value="draft">draft</MenuItem>
                <MenuItem value="sent">sent</MenuItem>
                <MenuItem value="accepted">accepted</MenuItem>
                <MenuItem value="rejected">rejected</MenuItem>
              </Select>
            </FormControl>

            <TextField
              variant="outlined"
              label="Buscar cliente"
              value={contactQuery}
              onChange={(e) => setContactQuery(e.target.value)}
              fullWidth
              helperText="Escribí para buscar en /contacts (best-effort)."
            />

            <FormControl variant="outlined" fullWidth>
              <InputLabel>Cliente</InputLabel>
              <Select
                value={form.contactId || ""}
                onChange={(e) => {
                  const id = e.target.value;
                  const found = contactOptions.find((c) => String(c.id) === String(id));
                  setForm({
                    ...form,
                    contactId: id,
                    contactName: found?.label || form.contactName,
                    contactPhone: found?.phone || form.contactPhone,
                  });
                }}
                label="Cliente"
              >
                <MenuItem value="">
                  <em>(Sin seleccionar)</em>
                </MenuItem>
                {contactOptions.map((c) => (
                  <MenuItem key={c.id} value={c.id}>
                    {c.label}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            <TextField
              variant="outlined"
              label="Nombre cliente (manual)"
              value={form.contactName}
              onChange={(e) => setForm({ ...form, contactName: e.target.value })}
              fullWidth
            />

            <TextField
              variant="outlined"
              label="Teléfono cliente (manual)"
              value={form.contactPhone}
              onChange={(e) => setForm({ ...form, contactPhone: e.target.value })}
              fullWidth
            />

            <TextField
              variant="outlined"
              label="Buscar vehículo"
              value={vehicleQuery}
              onChange={(e) => setVehicleQuery(e.target.value)}
              fullWidth
              helperText="Escribí para buscar en /vehicles (best-effort)."
            />

            <FormControl variant="outlined" fullWidth>
              <InputLabel>Vehículo</InputLabel>
              <Select
                value={form.vehicleId || ""}
                onChange={(e) => {
                  const id = e.target.value;
                  const found = vehicleOptions.find((v) => String(v.id) === String(id));
                  setForm({
                    ...form,
                    vehicleId: id,
                    vehicleLabel: found?.label || form.vehicleLabel,
                    vehicleData: found?.raw || form.vehicleData,
                  });
                }}
                label="Vehículo"
              >
                <MenuItem value="">
                  <em>(Sin seleccionar)</em>
                </MenuItem>
                {vehicleOptions.map((v) => (
                  <MenuItem key={v.id} value={v.id}>
                    {v.label}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            <TextField
              variant="outlined"
              label="Vehículo (manual)"
              value={form.vehicleLabel}
              onChange={(e) => setForm({ ...form, vehicleLabel: e.target.value })}
              fullWidth
            />

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <FormControl variant="outlined" fullWidth>
                <InputLabel>Moneda</InputLabel>
                <Select
                  value={form.currency}
                  onChange={(e) => setForm({ ...form, currency: e.target.value })}
                  label="Moneda"
                >
                  <MenuItem value="ARS">ARS</MenuItem>
                  <MenuItem value="USD">USD</MenuItem>
                </Select>
              </FormControl>

              <TextField
                variant="outlined"
                label="Precio"
                value={form.price}
                onChange={(e) => setForm({ ...form, price: e.target.value })}
                fullWidth
                type="number"
              />
            </div>

            <TextField
              variant="outlined"
              label="Notas (opcional)"
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              fullWidth
              multiline
              rows={4}
              style={{ gridColumn: "1 / -1" }}
            />
          </div>

          {lookupLoading && (
            <div style={{ marginTop: 12, display: "flex", gap: 10, alignItems: "center" }}>
              <CircularProgress size={16} />
              <Typography variant="caption">Buscando...</Typography>
            </div>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={closeDialog}>Cancelar</Button>
          <Button color="primary" variant="contained" onClick={save} disabled={saving}>
            {saving ? "Guardando..." : "Guardar"}
          </Button>
        </DialogActions>
      </Dialog>
    </div>
  );
}
