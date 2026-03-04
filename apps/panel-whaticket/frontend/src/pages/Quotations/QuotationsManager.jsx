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

<<<<<<< HEAD
const MS_DAY = 24 * 60 * 60 * 1000;
// Back-compat alias (older code may reference msDay)
const msDay = MS_DAY;


// Calculadora de Financiamiento
const FinanceCalculator = ({ price, onCalculate }) => {
  const [downPayment, setDownPayment] = useState(price * 0.2);
  const [months, setMonths] = useState(60);
  const [interestRate, setInterestRate] = useState(35);
  const [monthlyPayment, setMonthlyPayment] = useState(0);
  const [totalAmount, setTotalAmount] = useState(0);
=======
function toastError(err, fallback = "Ocurrió un error") {
  const msg =
    err?.response?.data?.error ||
    err?.response?.data?.message ||
    err?.message ||
    fallback;
  toast.error(msg);
}
>>>>>>> 841cb67 (fix(panel): demandas + cotizaciones v2)

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
  vehicleId: "",
  vehicleLabel: "",
  currency: "ARS",
  price: "",
  notes: "",
  status: "draft", // draft | sent | accepted | rejected
};

<<<<<<< HEAD
// Card de Cotización
const QuotationCard = ({ quotation, onView, onEdit, onDelete, onSend, onDownload }) => {
  const [expanded, setExpanded] = useState(false);

  const statusConfig = {
    draft: {
      label: 'Borrador',
      color: 'bg-gray-100 text-gray-800',
      icon: Edit
    },
    sent: {
      label: 'Enviada',
      color: 'bg-blue-100 text-blue-800',
      icon: Send
    },
    viewed: {
      label: 'Vista',
      color: 'bg-purple-100 text-purple-800',
      icon: Eye
    },
    accepted: {
      label: 'Aceptada',
      color: 'bg-green-100 text-green-800',
      icon: CheckCircle
    },
    rejected: {
      label: 'Rechazada',
      color: 'bg-red-100 text-red-800',
      icon: XCircle
    }
  };

  const status = statusConfig[quotation.status];
  const StatusIcon = status.icon;

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-5 hover:shadow-md transition-shadow">
      {/* Header */}
      <div className="flex items-start justify-between mb-4">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-2">
            <h3 className="font-semibold text-gray-900">
              Cotización #{quotation.number}
            </h3>
            <span className={`px-2 py-1 rounded-full text-xs font-medium flex items-center gap-1 ${status.color}`}>
              <StatusIcon className="w-3 h-3" />
              {status.label}
            </span>
          </div>

          <div className="space-y-1 text-sm text-gray-600">
            <div className="flex items-center gap-2">
              <User className="w-4 h-4" />
              <span>{quotation.clientName}</span>
            </div>
            <div className="flex items-center gap-2">
              <Car className="w-4 h-4" />
              <span>{quotation.vehicle}</span>
            </div>
            <div className="flex items-center gap-2">
              <Calendar className="w-4 h-4" />
              <span>{format(new Date(quotation.createdAt), "dd MMM yyyy", { locale: es })}</span>
            </div>
          </div>
        </div>

        <div className="text-right">
          <p className="text-2xl font-bold text-gray-900">
            ${quotation.totalPrice.toLocaleString()}
          </p>
          {quotation.financing && (
            <p className="text-sm text-blue-600 mt-1">
              ${Math.round(quotation.monthlyPayment).toLocaleString()}/mes
            </p>
          )}
        </div>
      </div>

      {/* Detalles expandibles */}
      {expanded && (
        <div className="mt-4 pt-4 border-t border-gray-200 space-y-3">
          {quotation.financing && (
            <div className="bg-blue-50 rounded-lg p-3">
              <h4 className="font-medium text-blue-900 mb-2">Detalles de Financiamiento</h4>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div>
                  <span className="text-blue-700">Entrada:</span>
                  <span className="ml-2 font-medium">${quotation.financing.downPayment.toLocaleString()}</span>
                </div>
                <div>
                  <span className="text-blue-700">Plazo:</span>
                  <span className="ml-2 font-medium">{quotation.financing.months} meses</span>
                </div>
                <div>
                  <span className="text-blue-700">Tasa:</span>
                  <span className="ml-2 font-medium">{quotation.financing.interestRate}% anual</span>
                </div>
                <div>
                  <span className="text-blue-700">Total:</span>
                  <span className="ml-2 font-medium">${quotation.financing.totalAmount.toLocaleString()}</span>
                </div>
              </div>
            </div>
          )}

          {quotation.tradeIn && (
            <div className="bg-green-50 rounded-lg p-3">
              <h4 className="font-medium text-green-900 mb-2">Vehículo en Parte de Pago</h4>
              <div className="text-sm">
                <p className="text-green-700">
                  {quotation.tradeIn.brand} {quotation.tradeIn.model} {quotation.tradeIn.year}
                </p>
                <p className="font-medium mt-1">
                  Valor estimado: ${quotation.tradeIn.value.toLocaleString()}
                </p>
              </div>
            </div>
          )}

          {quotation.notes && (
            <div className="text-sm text-gray-600">
              <p className="font-medium text-gray-700 mb-1">Notas:</p>
              <p>{quotation.notes}</p>
            </div>
          )}

          {quotation.validUntil && (
            <div className="flex items-center gap-2 text-sm text-amber-600">
              <Clock className="w-4 h-4" />
              <span>Válida hasta: {format(new Date(quotation.validUntil), "dd MMM yyyy", { locale: es })}</span>
            </div>
          )}
        </div>
      )}

      {/* Acciones */}
      <div className="mt-4 pt-4 border-t border-gray-200">
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setExpanded(!expanded)}
            className="flex items-center gap-1 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
          >
            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            {expanded ? 'Menos' : 'Más'} detalles
          </button>

          <button
            onClick={() => onView(quotation)}
            className="flex items-center gap-1 px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            <Eye className="w-4 h-4" />
            Ver
          </button>

          <button
            onClick={() => onDownload(quotation)}
            className="flex items-center gap-1 px-3 py-1.5 text-sm border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
          >
            <Download className="w-4 h-4" />
            PDF
          </button>

          {quotation.status === 'draft' && (
            <>
              <button
                onClick={() => onEdit(quotation)}
                className="flex items-center gap-1 px-3 py-1.5 text-sm border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
              >
                <Edit className="w-4 h-4" />
                Editar
              </button>

              <button
                onClick={() => onSend(quotation)}
                className="flex items-center gap-1 px-3 py-1.5 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
              >
                <Send className="w-4 h-4" />
                Enviar
              </button>
            </>
          )}

          {quotation.status !== 'draft' && (
            <button
              onClick={() => onSend(quotation)}
              className="flex items-center gap-1 px-3 py-1.5 text-sm border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
            >
              <MessageSquare className="w-4 h-4" />
              Reenviar
            </button>
          )}

          <button
            onClick={() => onDelete(quotation)}
            className="flex items-center gap-1 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 rounded-lg transition-colors ml-auto"
          >
            <Trash2 className="w-4 h-4" />
            Eliminar
          </button>
        </div>
      </div>
    </div>
  );
};

// Formulario de Nueva Cotización
const QuotationForm = ({ onSubmit, onCancel, vehicles = [], clients = [], initialData = null }) => {
  const [formData, setFormData] = useState(() => {
        const validUntil = initialData?.validUntil ? new Date(initialData.validUntil) : null;
    const validDays = validUntil && Number.isFinite(validUntil.getTime())
      ? Math.max(1, Math.ceil((validUntil.getTime() - Date.now()) / MS_DAY))
      : 7;

    return {
      clientId: String(initialData?.clientRefId ?? initialData?.clientId ?? ''),
      vehicleId: String(initialData?.vehicleRefId ?? initialData?.vehicleId ?? ''),
      currency: String(initialData?.currency || 'USD'),
      basePrice: Number(initialData?.basePrice ?? 0),
      discount: Number(initialData?.discount ?? 0),
      additionalCosts: Number(initialData?.additionalCosts ?? 0),
      financing: !!initialData?.financing,
      financeData: initialData?.financing ?? null,
      tradeIn: !!initialData?.tradeIn,
      tradeInData: initialData?.tradeIn ?? null,
      validDays,
      notes: String(initialData?.notes || '')
    };
  });

  const [selectedVehicle, setSelectedVehicle] = useState(null);
  const [finalPrice, setFinalPrice] = useState(0);

  useEffect(() => {
    if (formData.vehicleId && vehicles.length > 0) {
      const vehicle = vehicles.find(v => String(v.id) === String(formData.vehicleId));
      setSelectedVehicle(vehicle);
      setFormData(prev => ({ ...prev, basePrice: prev.basePrice || vehicle?.precio || 0 }));
    }
  }, [formData.vehicleId, vehicles]);

  useEffect(() => {
    let price = formData.basePrice - formData.discount + formData.additionalCosts;
    if (formData.tradeIn && formData.tradeInData?.value) {
      price -= formData.tradeInData.value;
    }
    setFinalPrice(Math.max(0, price));
  }, [formData.basePrice, formData.discount, formData.additionalCosts, formData.tradeIn, formData.tradeInData]);

  const handleSubmit = (e) => {
    e.preventDefault();

    const quotation = {
      clientId: formData.clientId,
      vehicleId: formData.vehicleId,
      currency: formData.currency,
      basePrice: Number(formData.basePrice) || 0,
      discount: Number(formData.discount) || 0,
      additionalCosts: Number(formData.additionalCosts) || 0,
      financing: formData.financing ? (formData.financeData || null) : null,
      tradeIn: formData.tradeIn ? (formData.tradeInData || null) : null,
      notes: formData.notes,
      totalPrice: finalPrice,
      status: String(initialData?.status || 'draft'),
      validUntil: new Date(Date.now() + (Number(formData.validDays) || 7) * 24 * 60 * 60 * 1000)
    };

    onSubmit(quotation);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Datos Básicos</h3>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Cliente */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Cliente *
            </label>
            <select
              required
              value={formData.clientId}
              onChange={(e) => setFormData({ ...formData, clientId: e.target.value })}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              <option value="">Seleccionar cliente</option>
              {clients.map(client => (
                <option key={client.id} value={client.id}>
                  {client.name} - {client.phone}
                </option>
              ))}
            </select>
          </div>

          {/* Vehículo */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Vehículo *
            </label>
            <select
              required
              value={formData.vehicleId}
              onChange={(e) => setFormData({ ...formData, vehicleId: e.target.value })}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              <option value="">Seleccionar vehículo</option>
              {vehicles.map(vehicle => (
                <option key={vehicle.id} value={vehicle.id}>
                  {vehicle.marca} {vehicle.modelo} {vehicle.version} - ${vehicle.precio.toLocaleString()}
                </option>
              ))}
            </select>
          </div>

          {/* Moneda */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Moneda
            </label>
            <select
              value={formData.currency}
              onChange={(e) => setFormData({ ...formData, currency: e.target.value })}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              <option value="USD">USD</option>
              <option value="ARS">ARS</option>
            </select>
          </div>
        </div>
      </div>

      {/* Precios */}
      {selectedVehicle && (
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Precios</h3>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Precio Base */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Precio Base
              </label>
              <input
                type="number"
                value={formData.basePrice}
                onChange={(e) => setFormData({ ...formData, basePrice: Number(e.target.value) })}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
              <p className="text-xs text-gray-500 mt-1">
                Precio sugerido: ${selectedVehicle.precio.toLocaleString()}
              </p>
            </div>

            {/* Descuento */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Descuento
              </label>
              <input
                type="number"
                value={formData.discount}
                onChange={(e) => setFormData({ ...formData, discount: Number(e.target.value) })}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>

            {/* Gastos Adicionales */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Gastos Adicionales
              </label>
              <input
                type="number"
                value={formData.additionalCosts}
                onChange={(e) => setFormData({ ...formData, additionalCosts: Number(e.target.value) })}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
          </div>

          {/* Precio Final */}
          <div className="mt-6 p-4 bg-gradient-to-r from-blue-50 to-indigo-50 rounded-lg border border-blue-200">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600 mb-1">Precio Final</p>
                <p className="text-3xl font-bold text-blue-600">
                  ${finalPrice.toLocaleString()}
                </p>
              </div>
              <TrendingUp className="w-8 h-8 text-blue-600" />
            </div>
          </div>
        </div>
      )}

      {/* Financiamiento */}
      {formData.financing && (
        <FinanceCalculator
          price={finalPrice}
          onCalculate={(data) => setFormData({ ...formData, financeData: data })}
        />
      )}

      {/* Acciones */}
      <div className="flex gap-3">
        <button
          type="submit"
          disabled={!formData.clientId || !formData.vehicleId}
          className={`flex-1 py-3 rounded-lg font-medium transition-colors ${(!formData.clientId || !formData.vehicleId)
            ? 'bg-gray-200 text-gray-500 cursor-not-allowed'
            : 'bg-blue-600 text-white hover:bg-blue-700'
            }`}
        >
          Guardar Cotización
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="px-6 py-3 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
        >
          Cancelar
        </button>
      </div>
    </form>
  );
};

/* ----------------------------
   RESTO DEL ARCHIVO
   (No se alteró salvo el fix de vehicleId string en create/update)
---------------------------- */

const QuotationsManager = () => {
=======
export default function QuotationsManager() {
  const [loading, setLoading] = useState(false);
>>>>>>> 841cb67 (fix(panel): demandas + cotizaciones v2)
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
      setQuotations(Array.isArray(data) ? data : data?.rows || []);
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
  };

  const openEdit = (q) => {
    setForm({
      ...emptyForm,
      id: q?.id ?? null,
      title: q?.title ?? "",
      contactId: q?.contactId ?? q?.contact?.id ?? "",
      contactName: q?.contactName ?? q?.contact?.name ?? "",
      vehicleId: q?.vehicleId ?? q?.vehicle?.id ?? "",
      vehicleLabel: q?.vehicleLabel ?? q?.vehicle?.name ?? q?.vehicle?.title ?? "",
      currency: q?.currency ?? "ARS",
      price: q?.price ?? "",
      notes: q?.notes ?? "",
      status: q?.status ?? "draft",
    });
    setDialogOpen(true);
  };

  const closeDialog = () => {
    setDialogOpen(false);
    setSaving(false);
  };

  const validate = () => {
    if (!String(form.contactId || "").trim() && !String(form.contactName || "").trim()) {
      toast.error("Seleccioná un cliente (o completá el nombre).");
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
      const payload = {
        title: form.title || undefined,
        contactId: form.contactId || undefined,
        contactName: form.contactName || undefined,
        vehicleId: form.vehicleId || undefined,
        vehicleLabel: form.vehicleLabel || undefined,
        currency: form.currency,
        price: form.price ? Number(form.price) : undefined,
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
    if (!query) {
      setVehicleOptions([]);
      return;
    }
    setLookupLoading(true);
    try {
      // Best-effort: /vehicles?search=...
      const data = await safeGet("/vehicles", { params: { search: query } });
      const list = Array.isArray(data) ? data : data?.rows || data?.data || [];
      const normalized = (list || []).slice(0, 15).map((v) => ({
        id: v.id ?? v.vehicleId ?? v.uuid ?? "",
        label:
          v.name ||
          v.title ||
          [v.brand, v.model, v.year].filter(Boolean).join(" ") ||
          String(v.id || ""),
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
    if (!query) {
      setContactOptions([]);
      return;
    }
    setLookupLoading(true);
    try {
      // Best-effort: /contacts?search=...
      const data = await safeGet("/contacts", { params: { search: query } });
      const list = Array.isArray(data) ? data : data?.rows || data?.data || [];
      const normalized = (list || []).slice(0, 15).map((c) => ({
        id: c.id ?? c.contactId ?? c.uuid ?? "",
        label: c.name || c.pushname || c.number || String(c.id || ""),
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
                const price = q.price ?? q.amount ?? "";
                const currency = q.currency ?? "ARS";
                return (
                  <TableRow key={q.id || Math.random()}>
                    <TableCell>{q.id ?? "-"}</TableCell>
                    <TableCell>{q.contactName ?? q.contact?.name ?? "-"}</TableCell>
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

            <div />

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
