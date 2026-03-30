import React, { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  CircularProgress,
} from "@material-ui/core";
import { toast } from "react-toastify";
import { format, differenceInHours, parseISO } from "date-fns";
import { useLocation, useHistory } from "react-router-dom";
import api from "../../services/api";
import { buildVehicleLabel } from "../../utils/vehicleLabel";

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
  ticketId: "",
  validUntil: "",
};

// Calcula si una cotización vence en menos de N horas
function hoursUntilExpiry(validUntil) {
  if (!validUntil) return null;
  try {
    const date = typeof validUntil === "string" ? parseISO(validUntil) : new Date(validUntil);
    return differenceInHours(date, new Date());
  } catch {
    return null;
  }
}

export default function QuotationsManager() {
  const location = useLocation();
  const history = useHistory();

  const [loading, setLoading] = useState(false);
  const [quotations, setQuotations] = useState([]);
  const [search, setSearch] = useState("");

  const [dialogOpen, setDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ ...emptyForm });

  // Modal de confirmación (reemplaza window.confirm)
  const [confirmState, setConfirmState] = useState({ open: false, quotation: null });

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

  const openCreate = (overrides = {}) => {
    setForm({ ...emptyForm, ...overrides });
    setVehicleQuery("");
    setContactQuery(overrides.contactName ? overrides.contactName : "");
    setVehicleOptions([]);
    setContactOptions([]);
    setDialogOpen(true);
    loadVehicles("");
    loadContacts(overrides.contactName ? overrides.contactName : "");
  };

  // Abrir formulario pre-cargado si llegan query params desde LeadPanel
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const ticketIdParam = params.get("ticketId");
    const contactIdParam = params.get("contactId");
    const contactNameParam = params.get("contactName");
    const vehicleLabelParam = params.get("vehicleLabel");
    const priceParam = params.get("price");

    if (ticketIdParam) {
      const overrides = {
        ticketId: ticketIdParam,
        contactId: contactIdParam || "",
        contactName: contactNameParam ? decodeURIComponent(contactNameParam) : "",
        vehicleLabel: vehicleLabelParam ? decodeURIComponent(vehicleLabelParam) : "",
        price: priceParam || "",
      };
      openCreate(overrides);
      // Limpiar query params de la URL sin recargar
      history.replace({ pathname: location.pathname, search: "" });
    }
    // Solo al montar
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      ticketId: q?.ticketId ? String(q.ticketId) : "",
      validUntil: q?.validUntil
        ? (() => {
            try {
              return format(
                typeof q.validUntil === "string" ? parseISO(q.validUntil) : new Date(q.validUntil),
                "yyyy-MM-dd"
              );
            } catch { return ""; }
          })()
        : "",
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
        ticketId: form.ticketId ? Number(form.ticketId) || form.ticketId : undefined,
        validUntil: form.validUntil || undefined,
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

  const remove = (q) => {
    if (!q?.id) return;
    setConfirmState({ open: true, quotation: q });
  };

  const confirmRemove = async () => {
    const q = confirmState.quotation;
    setConfirmState({ open: false, quotation: null });
    if (!q?.id) return;
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

  const STATUS_META = {
    draft:    { label: "Borrador",  cls: "border-white/10 bg-white/[0.04] text-white/50" },
    sent:     { label: "Enviada",   cls: "border-blue-500/25 bg-blue-500/10 text-blue-400" },
    accepted: { label: "Aceptada",  cls: "border-green-500/25 bg-green-500/10 text-green-400" },
    rejected: { label: "Rechazada", cls: "border-red-500/25 bg-red-500/10 text-red-400" },
  };

  const StatusBadge = ({ status }) => {
    const meta = STATUS_META[status] || STATUS_META.draft;
    return (
      <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${meta.cls}`}>
        {meta.label}
      </span>
    );
  };

  // Genera texto formateado para copiar por WhatsApp
  const buildWhatsAppText = (q) => {
    const clientName = q.clientName ?? q.contactName ?? q.contact?.name ?? "";
    const vehicle = q.vehicleLabel ?? q.vehicle?.name ?? q.vehicle?.title ?? "";
    const currency = q.currency ?? "ARS";
    const rawPrice = q.totalPrice ?? q.basePrice ?? q.price ?? q.amount;
    const price = rawPrice !== undefined && rawPrice !== null && rawPrice !== ""
      ? `${currency} ${Number(rawPrice).toLocaleString("es-AR")}`
      : null;

    let validUntilStr = "";
    if (q.validUntil) {
      try {
        validUntilStr = format(
          typeof q.validUntil === "string" ? parseISO(q.validUntil) : new Date(q.validUntil),
          "dd/MM/yyyy"
        );
      } catch { validUntilStr = ""; }
    }

    const lines = [];
    lines.push("*Cotizacion WaPro*");
    lines.push("─────────────────");
    if (clientName) lines.push(`Cliente: ${clientName}`);
    if (vehicle) lines.push(`Vehiculo: ${vehicle}`);
    if (price) lines.push(`Precio: *${price}*`);
    if (validUntilStr) lines.push(`Vigencia: ${validUntilStr}`);
    if (q.notes) lines.push(`Notas: ${q.notes}`);
    lines.push("─────────────────");
    lines.push("Consultas por este medio.");
    return lines.join("\n");
  };

  const copyToWhatsApp = (q) => {
    const text = buildWhatsAppText(q);
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text)
        .then(() => toast.success("Texto copiado para WhatsApp"))
        .catch(() => {
          // fallback para contextos sin permisos de clipboard
          const el = document.createElement("textarea");
          el.value = text;
          el.style.position = "fixed";
          el.style.opacity = "0";
          document.body.appendChild(el);
          el.select();
          document.execCommand("copy");
          document.body.removeChild(el);
          toast.success("Texto copiado para WhatsApp");
        });
    } else {
      const el = document.createElement("textarea");
      el.value = text;
      el.style.position = "fixed";
      el.style.opacity = "0";
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      document.body.removeChild(el);
      toast.success("Texto copiado para WhatsApp");
    }
  };

  const inputCls = "h-10 w-full rounded-xl border border-white/[0.08] bg-[#1e2333] px-3 text-sm text-[#f1f5f9] outline-none transition-colors placeholder:text-white/25 focus:border-[#f59e0b]/50";
  const selectCls = "h-10 w-full rounded-xl border border-white/[0.08] bg-[#1e2333] px-3 text-sm text-[#94a3b8] outline-none transition-colors focus:border-[#f59e0b]/50 cursor-pointer";
  const labelCls = "block text-[11px] font-semibold uppercase tracking-wider text-white/35 mb-1.5";

  return (
    <div className="flex h-full flex-col bg-[#0f1117] p-4 md:p-6">
      {/* Page header */}
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#94a3b8]">CRM Automotriz</div>
          <h1 className="mt-0.5 text-xl font-semibold text-[#f1f5f9]">Cotizaciones</h1>
        </div>
        <button
          type="button"
          onClick={openCreate}
          className="inline-flex h-10 items-center gap-2 rounded-xl bg-[#f59e0b] px-4 text-sm font-bold text-black transition-colors hover:bg-[#fbbf24]"
        >
          <span className="text-base leading-none">+</span>
          <span>Nueva cotización</span>
        </button>
      </div>

      {/* Search bar */}
      <div className="mb-4 rounded-xl border border-white/[0.08] bg-[#171b26] p-3 shadow-[0_4px_24px_rgba(0,0,0,0.35)]">
        <div className="relative">
          <svg className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/30" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35m0 0A7.5 7.5 0 1 0 6.5 6.5a7.5 7.5 0 0 0 10.65 10.65z" />
          </svg>
          <input
            className="h-10 w-full rounded-xl border border-white/[0.08] bg-[#1e2333] pl-9 pr-3 text-sm text-[#f1f5f9] outline-none transition-colors placeholder:text-white/25 focus:border-[#f59e0b]/50"
            placeholder="Buscar por cliente, vehículo, estado o ID..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        {quotations.length > 0 && (
          <div className="mt-2 text-[11px] text-white/30">
            {filtered.length} de {quotations.length} cotizaciones
          </div>
        )}
      </div>

      {/* Table */}
      <div className="rounded-xl border border-white/[0.08] bg-[#171b26] shadow-[0_4px_24px_rgba(0,0,0,0.35)]">
        {loading ? (
          <div className="flex flex-col gap-2 p-4">
            {[1,2,3,4].map((i) => (
              <div key={i} className="h-14 animate-pulse rounded-lg bg-white/[0.04]" />
            ))}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[700px] text-left text-sm">
              <thead>
                <tr className="border-b border-white/[0.06]">
                  {["#", "Cliente", "Vehículo", "Precio", "Estado", "Vence", "Ticket", ""].map((h, i) => (
                    <th
                      key={i}
                      className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-white/35"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={8}>
                      <div className="flex flex-col items-center justify-center px-4 py-16 text-center">
                        <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full border border-white/[0.08] bg-white/[0.04]">
                          <svg className="h-5 w-5 text-white/30" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-3-3v6M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z" />
                          </svg>
                        </div>
                        <div className="text-sm font-medium text-white/50">
                          {search ? "Sin resultados para esta búsqueda" : "Todavía no hay cotizaciones"}
                        </div>
                        <div className="mt-1 text-xs text-white/25">
                          {search ? "Probá con otro término o limpiá la búsqueda." : "Creá la primera cotización para un lead."}
                        </div>
                      </div>
                    </td>
                  </tr>
                ) : (
                  filtered.map((q) => {
                    const rawPrice = q.totalPrice ?? q.basePrice ?? q.price ?? q.amount;
                    const hasPrice = rawPrice !== undefined && rawPrice !== null && rawPrice !== "";
                    const currency = q.currency ?? "ARS";
                    const status = q.status ?? "draft";

                    // Vehículo con jerarquía visual
                    const vehicleRaw = q.vehicleData || q.vehicle || {};
                    const vehicleMain = q.vehicleLabel ?? vehicleRaw?.name ?? vehicleRaw?.title ?? "";
                    const vehicleYear = vehicleRaw?.year ?? "";
                    const vehicleVersion = vehicleRaw?.version ?? "";
                    const vehicleSub = [vehicleVersion, vehicleYear].filter(Boolean).join(" · ");

                    // Expiry node
                    const validUntil = q.validUntil;
                    let expiryNode = <span className="text-[12px] text-white/25">—</span>;
                    if (validUntil) {
                      const hours = hoursUntilExpiry(validUntil);
                      let dateStr = "";
                      try {
                        dateStr = format(
                          typeof validUntil === "string" ? parseISO(validUntil) : new Date(validUntil),
                          "dd/MM/yy"
                        );
                      } catch { dateStr = String(validUntil); }

                      if (hours !== null && hours < 0) {
                        expiryNode = (
                          <span className="inline-flex items-center rounded-full border border-red-500/30 bg-red-500/10 px-2 py-0.5 text-[11px] font-semibold text-red-400">
                            Vencida {dateStr}
                          </span>
                        );
                      } else if (hours !== null && hours < 48) {
                        expiryNode = (
                          <span className="inline-flex items-center rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[11px] font-semibold text-amber-400">
                            {dateStr} · {hours}h
                          </span>
                        );
                      } else {
                        expiryNode = <span className="text-[12px] text-white/40">{dateStr}</span>;
                      }
                    }

                    return (
                      <tr
                        key={q.id || Math.random()}
                        className="border-b border-white/[0.05] transition-colors last:border-0 hover:bg-white/[0.02]"
                      >
                        {/* ID */}
                        <td className="px-4 py-3.5 text-[12px] font-mono text-white/40 whitespace-nowrap">
                          #{q.id ?? "-"}
                        </td>

                        {/* Cliente */}
                        <td className="px-4 py-3.5">
                          <div className="font-medium text-[#f1f5f9] leading-snug">
                            {q.clientName ?? q.contactName ?? q.contact?.name ?? "-"}
                          </div>
                          {(q.clientPhone ?? q.contact?.number) && (
                            <div className="mt-0.5 text-[11px] text-white/35 font-mono">
                              {q.clientPhone ?? q.contact?.number}
                            </div>
                          )}
                        </td>

                        {/* Vehículo con jerarquía */}
                        <td className="px-4 py-3.5 max-w-[200px]">
                          <div className="font-medium text-[#f1f5f9] leading-snug truncate" title={vehicleMain}>
                            {vehicleMain || "-"}
                          </div>
                          {vehicleSub && (
                            <div className="mt-0.5 text-[11px] text-white/40 truncate">{vehicleSub}</div>
                          )}
                        </td>

                        {/* Precio destacado */}
                        <td className="px-4 py-3.5 whitespace-nowrap">
                          {hasPrice ? (
                            <div className="flex items-baseline gap-1.5">
                              <span
                                className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-bold leading-none ${
                                  currency === "USD"
                                    ? "bg-emerald-500/15 text-emerald-400"
                                    : "bg-sky-500/15 text-sky-400"
                                }`}
                              >
                                {currency}
                              </span>
                              <span className="text-[15px] font-bold text-[#f1f5f9] tabular-nums">
                                {Number(rawPrice).toLocaleString("es-AR")}
                              </span>
                            </div>
                          ) : (
                            <span className="text-[12px] text-white/25">Sin precio</span>
                          )}
                        </td>

                        {/* Estado */}
                        <td className="px-4 py-3.5">
                          <StatusBadge status={status} />
                        </td>

                        {/* Vence */}
                        <td className="px-4 py-3.5 whitespace-nowrap">{expiryNode}</td>

                        {/* Ticket */}
                        <td className="px-4 py-3.5">
                          {q.ticketId ? (
                            <a
                              href={`/tickets/${q.ticketId}`}
                              className="inline-flex items-center rounded-lg border border-white/[0.08] bg-white/[0.03] px-2.5 py-0.5 text-[11px] font-mono text-white/50 transition-colors hover:border-white/[0.14] hover:text-[#f1f5f9]"
                            >
                              #{q.ticketId}
                            </a>
                          ) : (
                            <span className="text-[12px] text-white/25">—</span>
                          )}
                        </td>

                        {/* Acciones contextuales */}
                        <td className="px-4 py-3.5">
                          <div className="flex items-center justify-end gap-1.5 flex-wrap">
                            {/* CTA principal segun estado */}
                            {status === "draft" && (
                              <button
                                type="button"
                                onClick={() => send(q)}
                                className="inline-flex h-8 items-center rounded-lg border border-[#f59e0b]/30 bg-[#f59e0b]/10 px-3 text-xs font-semibold text-[#f59e0b] transition-colors hover:bg-[#f59e0b]/20 whitespace-nowrap"
                              >
                                Enviar
                              </button>
                            )}
                            {status === "sent" && (
                              <button
                                type="button"
                                onClick={() => openEdit(q)}
                                className="inline-flex h-8 items-center rounded-lg border border-blue-500/25 bg-blue-500/10 px-3 text-xs font-semibold text-blue-400 transition-colors hover:bg-blue-500/15 whitespace-nowrap"
                              >
                                Consultar
                              </button>
                            )}
                            {status === "accepted" && (
                              <button
                                type="button"
                                onClick={() => openEdit(q)}
                                className="inline-flex h-8 items-center rounded-lg border border-green-500/25 bg-green-500/10 px-3 text-xs font-semibold text-green-400 transition-colors hover:bg-green-500/15 whitespace-nowrap"
                              >
                                Ver deal
                              </button>
                            )}

                            {/* Copiar para WhatsApp — siempre visible */}
                            <button
                              type="button"
                              onClick={() => copyToWhatsApp(q)}
                              title="Copiar texto para WhatsApp"
                              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-white/[0.08] bg-white/[0.03] text-white/40 transition-colors hover:border-green-500/30 hover:bg-green-500/10 hover:text-green-400"
                            >
                              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor">
                                <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z" />
                              </svg>
                            </button>

                            {/* Editar — siempre visible */}
                            <button
                              type="button"
                              onClick={() => openEdit(q)}
                              className="inline-flex h-8 items-center rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 text-xs font-medium text-white/60 transition-colors hover:border-white/[0.14] hover:text-[#f1f5f9]"
                            >
                              Editar
                            </button>

                            {/* Eliminar — disponible para todos los estados */}
                            <button
                              type="button"
                              onClick={() => remove(q)}
                              className="inline-flex h-8 items-center rounded-lg border border-red-500/20 bg-red-500/[0.06] px-3 text-xs font-medium text-red-400 transition-colors hover:bg-red-500/10"
                            >
                              Eliminar
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Dialog */}
      <Dialog open={dialogOpen} onClose={closeDialog} fullWidth maxWidth="md"
        PaperProps={{
          style: {
            background: "#171b26",
            border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: 16,
            color: "#f1f5f9",
          }
        }}
      >
        <DialogTitle style={{ borderBottom: "1px solid rgba(255,255,255,0.08)", paddingBottom: 16 }}>
          <span style={{ fontSize: 16, fontWeight: 600, color: "#f1f5f9" }}>
            {form.id ? `Editar cotización #${form.id}` : "Nueva cotización"}
          </span>
        </DialogTitle>
        <DialogContent style={{ paddingTop: 20 }}>

          {/* Seccion: identificacion */}
          <div className="mb-5">
            <div className="mb-3 flex items-center gap-2">
              <span className="text-[10px] font-bold uppercase tracking-widest text-white/30">Identificacion</span>
              <div className="flex-1 border-t border-white/[0.05]" />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div>
                <label className={labelCls}>Título (opcional)</label>
                <input
                  className={inputCls}
                  placeholder="Ej: Toyota Corolla — Juan García"
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                />
              </div>
              <div>
                <label className={labelCls}>Estado</label>
                <select
                  className={selectCls}
                  value={form.status}
                  onChange={(e) => setForm({ ...form, status: e.target.value })}
                >
                  <option value="draft">Borrador</option>
                  <option value="sent">Enviada</option>
                  <option value="accepted">Aceptada</option>
                  <option value="rejected">Rechazada</option>
                </select>
              </div>
            </div>
          </div>

          {/* Seccion: cliente */}
          <div className="mb-5">
            <div className="mb-3 flex items-center gap-2">
              <span className="text-[10px] font-bold uppercase tracking-widest text-white/30">Cliente</span>
              <div className="flex-1 border-t border-white/[0.05]" />
              {lookupLoading && (
                <span className="flex items-center gap-1.5">
                  <CircularProgress size={11} style={{ color: "#f59e0b" }} />
                  <span style={{ fontSize: 11, color: "#94a3b8" }}>Buscando...</span>
                </span>
              )}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div>
                <label className={labelCls}>Buscar cliente</label>
                <input
                  className={inputCls}
                  placeholder="Nombre o número..."
                  value={contactQuery}
                  onChange={(e) => setContactQuery(e.target.value)}
                />
              </div>
              <div>
                <label className={labelCls}>Seleccionar cliente</label>
                <select
                  className={selectCls}
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
                >
                  <option value="">(Sin seleccionar)</option>
                  {contactOptions.map((c) => (
                    <option key={c.id} value={c.id}>{c.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelCls}>Nombre (manual)</label>
                <input
                  className={inputCls}
                  placeholder="Nombre completo"
                  value={form.contactName}
                  onChange={(e) => setForm({ ...form, contactName: e.target.value })}
                />
              </div>
              <div>
                <label className={labelCls}>Teléfono (manual)</label>
                <input
                  className={inputCls}
                  placeholder="+54 9 11..."
                  value={form.contactPhone}
                  onChange={(e) => setForm({ ...form, contactPhone: e.target.value })}
                />
              </div>
            </div>
          </div>

          {/* Seccion: vehículo */}
          <div className="mb-5">
            <div className="mb-3 flex items-center gap-2">
              <span className="text-[10px] font-bold uppercase tracking-widest text-white/30">Vehículo</span>
              <div className="flex-1 border-t border-white/[0.05]" />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div>
                <label className={labelCls}>Buscar vehículo</label>
                <input
                  className={inputCls}
                  placeholder="Marca, modelo, año..."
                  value={vehicleQuery}
                  onChange={(e) => setVehicleQuery(e.target.value)}
                />
              </div>
              <div>
                <label className={labelCls}>Seleccionar vehículo</label>
                <select
                  className={selectCls}
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
                >
                  <option value="">(Sin seleccionar)</option>
                  {vehicleOptions.map((v) => (
                    <option key={v.id} value={v.id}>{v.label}</option>
                  ))}
                </select>
              </div>
              <div style={{ gridColumn: "1 / -1" }}>
                <label className={labelCls}>Descripción manual</label>
                <input
                  className={inputCls}
                  placeholder="Toyota Corolla 2024 XEI"
                  value={form.vehicleLabel}
                  onChange={(e) => setForm({ ...form, vehicleLabel: e.target.value })}
                />
              </div>
            </div>
          </div>

          {/* Seccion: precio */}
          <div className="mb-5">
            <div className="mb-3 flex items-center gap-2">
              <span className="text-[10px] font-bold uppercase tracking-widest text-white/30">Precio</span>
              <div className="flex-1 border-t border-white/[0.05]" />
              {/* Preview del precio */}
              {form.price && Number(form.price) > 0 && (
                <div className="flex items-baseline gap-1.5">
                  <span
                    className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-bold leading-none ${
                      form.currency === "USD"
                        ? "bg-emerald-500/15 text-emerald-400"
                        : "bg-sky-500/15 text-sky-400"
                    }`}
                  >
                    {form.currency}
                  </span>
                  <span className="text-[14px] font-bold text-[#f1f5f9] tabular-nums">
                    {Number(form.price).toLocaleString("es-AR")}
                  </span>
                </div>
              )}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div>
                <label className={labelCls}>Moneda</label>
                <select
                  className={selectCls}
                  value={form.currency}
                  onChange={(e) => setForm({ ...form, currency: e.target.value })}
                >
                  <option value="ARS">ARS — Pesos argentinos</option>
                  <option value="USD">USD — Dólares</option>
                </select>
              </div>
              <div>
                <label className={labelCls}>Monto</label>
                <input
                  className={inputCls}
                  type="number"
                  placeholder="0"
                  value={form.price}
                  onChange={(e) => setForm({ ...form, price: e.target.value })}
                />
              </div>
            </div>
          </div>

          {/* Seccion: condiciones */}
          <div className="mb-1">
            <div className="mb-3 flex items-center gap-2">
              <span className="text-[10px] font-bold uppercase tracking-widest text-white/30">Condiciones</span>
              <div className="flex-1 border-t border-white/[0.05]" />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div>
                <label className={labelCls}>Válida hasta</label>
                <input
                  className={inputCls}
                  type="date"
                  value={form.validUntil}
                  onChange={(e) => setForm({ ...form, validUntil: e.target.value })}
                  style={{ colorScheme: "dark" }}
                />
              </div>
              <div>
                <label className={labelCls}>Ticket vinculado</label>
                <input
                  className={inputCls}
                  type="text"
                  placeholder="ID del ticket (si aplica)"
                  value={form.ticketId}
                  onChange={(e) => setForm({ ...form, ticketId: e.target.value })}
                />
              </div>
              <div style={{ gridColumn: "1 / -1" }}>
                <label className={labelCls}>
                  Notas y condiciones
                  <span className="ml-1.5 text-[10px] font-normal normal-case tracking-normal text-white/25">
                    (no se envian al cliente)
                  </span>
                </label>
                <textarea
                  rows={3}
                  className="w-full rounded-xl border border-white/[0.08] bg-[#1e2333] px-3 py-2.5 text-sm text-[#f1f5f9] outline-none transition-colors placeholder:text-white/25 focus:border-[#f59e0b]/50 resize-none"
                  placeholder="Forma de pago, descuentos acordados, condiciones especiales..."
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                />
              </div>
            </div>
          </div>

        </DialogContent>
        <DialogActions style={{ borderTop: "1px solid rgba(255,255,255,0.08)", padding: "12px 20px", gap: 8 }}>
          <button
            type="button"
            onClick={closeDialog}
            style={{
              height: 38, padding: "0 16px", borderRadius: 10,
              border: "1px solid rgba(255,255,255,0.08)", background: "transparent",
              color: "#94a3b8", fontSize: 13, cursor: "pointer",
            }}
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={save}
            disabled={saving}
            style={{
              height: 38, padding: "0 20px", borderRadius: 10,
              background: saving ? "rgba(245,158,11,0.5)" : "#f59e0b",
              border: "none", color: "#000", fontSize: 13,
              fontWeight: 700, cursor: saving ? "not-allowed" : "pointer",
            }}
          >
            {saving ? "Guardando..." : form.id ? "Guardar cambios" : "Crear cotización"}
          </button>
        </DialogActions>
      </Dialog>

      {/* Modal de confirmación de eliminación */}
      <Dialog
        open={confirmState.open}
        onClose={() => setConfirmState({ open: false, quotation: null })}
        PaperProps={{
          style: {
            background: "#1a1d2e",
            border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: 16,
            padding: "8px 4px",
            maxWidth: 360,
            width: "100%",
          },
        }}
      >
        <DialogTitle style={{ color: "#f1f5f9", fontSize: 15, fontWeight: 700, paddingBottom: 4 }}>
          Eliminar cotización
        </DialogTitle>
        <DialogContent>
          <p style={{ color: "#94a3b8", fontSize: 13, margin: 0 }}>
            ¿Confirmás la eliminación de la cotización{" "}
            <strong style={{ color: "#f1f5f9" }}>
              #{confirmState.quotation?.id}
              {confirmState.quotation?.title ? ` — ${confirmState.quotation.title}` : ""}
            </strong>
            ? Esta acción no se puede deshacer.
          </p>
        </DialogContent>
        <DialogActions style={{ padding: "8px 20px 16px" }}>
          <button
            type="button"
            onClick={() => setConfirmState({ open: false, quotation: null })}
            style={{
              height: 36, padding: "0 16px", borderRadius: 10,
              background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)",
              color: "#94a3b8", fontSize: 13, fontWeight: 600, cursor: "pointer",
            }}
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={confirmRemove}
            style={{
              height: 36, padding: "0 16px", borderRadius: 10,
              background: "#ef4444", border: "none",
              color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer",
            }}
          >
            Eliminar
          </button>
        </DialogActions>
      </Dialog>
    </div>
  );
}
