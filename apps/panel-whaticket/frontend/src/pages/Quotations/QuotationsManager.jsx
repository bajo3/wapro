import React, { useEffect, useMemo, useState } from 'react';
import {
  FileText, Download, Send, Eye, Edit, Trash2, Plus, Calculator,
  DollarSign, TrendingUp, Search, MessageSquare
} from 'lucide-react';
import { toast } from 'react-toastify';
import toastError from '../../errors/toastError';

import {
  listQuotations,
  createQuotation,
  updateQuotation,
  deleteQuotation,
  sendQuotation
} from '../../services/quotations';

import api from '../../services/api';

/* ----------------------------
   Helpers
---------------------------- */

const money = (n) => {
  const v = Number(n);
  return Number.isFinite(v) ? Math.round(v).toLocaleString('es-AR') : '0';
};

const normalizeQuotation = (q) => {
  const totalPrice = Number(q?.totalPrice);
  const basePrice = Number(q?.basePrice);
  const discount = Number(q?.discount);
  const additionalCosts = Number(q?.additionalCosts);
  return {
    ...q,
    number: String(q?.number ?? q?.id ?? ''),
    clientName: String(q?.clientName ?? q?.contactName ?? ''),
    clientPhone: String(q?.clientPhone ?? q?.phone ?? ''),
    vehicle: String(q?.vehicleLabel ?? q?.vehicle ?? ''),
    currency: String(q?.currency ?? 'USD').toUpperCase(),
    totalPrice: Number.isFinite(totalPrice) ? totalPrice : 0,
    basePrice: Number.isFinite(basePrice) ? basePrice : 0,
    discount: Number.isFinite(discount) ? discount : 0,
    additionalCosts: Number.isFinite(additionalCosts) ? additionalCosts : 0,
    financing: q?.financing ?? null,
    tradeIn: q?.tradeIn ?? null
  };
};

const buildPrintableHtml = (q) => {
  const currency = String(q?.currency || 'USD').toUpperCase();
  const fin = q?.financing;
  const trade = q?.tradeIn;

  return `<!doctype html>
  <html>
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>Cotización ${String(q?.number || '')}</title>
      <style>
        body{font-family:Arial,Helvetica,sans-serif;margin:24px;color:#111}
        .row{display:flex;justify-content:space-between;gap:16px}
        .card{border:1px solid #e5e7eb;border-radius:12px;padding:16px;margin-top:12px}
        .muted{color:#6b7280}
        h1{font-size:20px;margin:0}
        h2{font-size:14px;margin:0 0 8px 0}
        table{width:100%;border-collapse:collapse}
        td{padding:6px 0;border-bottom:1px solid #f3f4f6;font-size:13px}
        .right{text-align:right}
        .total{font-size:18px;font-weight:700}
        .badge{display:inline-block;padding:2px 8px;border-radius:999px;background:#f3f4f6;font-size:12px}
        @media print{.no-print{display:none}}
      </style>
    </head>
    <body>
      <div class="row">
        <div>
          <h1>Cotización #${String(q?.number || '')}</h1>
          <div class="muted" style="margin-top:6px">${String(q?.clientName || '')}${q?.clientPhone ? ' · ' + String(q.clientPhone) : ''}</div>
          <div class="muted" style="margin-top:2px">Vehículo: ${String(q?.vehicle || q?.vehicleLabel || '')}</div>
          <div class="muted" style="margin-top:2px">Fecha: ${q?.createdAt ? new Date(q.createdAt).toLocaleDateString('es-AR') : ''}</div>
          ${q?.validUntil ? `<div class="muted" style="margin-top:2px">Válida hasta: ${new Date(q.validUntil).toLocaleDateString('es-AR')}</div>` : ''}
        </div>
        <div class="right">
          <div class="badge">${String(q?.status || 'draft').toUpperCase()}</div>
          <div class="total" style="margin-top:10px">${currency} ${money(q?.totalPrice)}</div>
        </div>
      </div>

      <div class="card">
        <h2>Detalle</h2>
        <table>
          <tr><td>Precio base</td><td class="right">${currency} ${money(q?.basePrice)}</td></tr>
          <tr><td>Descuento</td><td class="right">${currency} ${money(q?.discount)}</td></tr>
          <tr><td>Extras</td><td class="right">${currency} ${money(q?.additionalCosts)}</td></tr>
          <tr><td><b>Total</b></td><td class="right"><b>${currency} ${money(q?.totalPrice)}</b></td></tr>
        </table>
      </div>

      ${fin ? `
      <div class="card">
        <h2>Financiación</h2>
        <table>
          <tr><td>Entrada</td><td class="right">${currency} ${money(fin.downPayment)}</td></tr>
          <tr><td>Plazo</td><td class="right">${money(fin.months)} meses</td></tr>
          <tr><td>Tasa</td><td class="right">${money(fin.interestRate)}% anual</td></tr>
          <tr><td>Cuota estimada</td><td class="right">${currency} ${money(fin.monthlyPayment)}/mes</td></tr>
          <tr><td>Total a pagar</td><td class="right">${currency} ${money(fin.totalAmount)}</td></tr>
        </table>
      </div>
      ` : ''}

      ${trade ? `
      <div class="card">
        <h2>Parte de pago</h2>
        <div class="muted">${[trade.brand, trade.model, trade.year].filter(Boolean).join(' ')}</div>
        ${trade.value ? `<div style="margin-top:8px"><b>Valor estimado:</b> ${currency} ${money(trade.value)}</div>` : ''}
      </div>
      ` : ''}

      ${q?.notes ? `
      <div class="card">
        <h2>Notas</h2>
        <div style="white-space:pre-wrap;font-size:13px">${String(q.notes).replace(/</g, '&lt;')}</div>
      </div>
      ` : ''}

      <div class="no-print" style="margin-top:16px">
        <button onclick="window.print()" style="padding:10px 14px;border:1px solid #111;border-radius:10px;background:#111;color:#fff;cursor:pointer">Imprimir / Guardar PDF</button>
      </div>
    </body>
  </html>`;
};

const viewQuotation = (q, { print = false } = {}) => {
  try {
    const w = window.open('', '_blank');
    if (!w) return;
    w.document.open();
    w.document.write(buildPrintableHtml(q));
    w.document.close();
    if (print) {
      setTimeout(() => {
        try { w.print(); } catch { }
      }, 250);
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error(e);
  }
};

/* ----------------------------
   Finance component
---------------------------- */

const FinanceCalculator = ({ price, onCalculate }) => {
  const [downPayment, setDownPayment] = useState(Math.round(Number(price || 0) * 0.2));
  const [months, setMonths] = useState(60);
  const [interestRate, setInterestRate] = useState(35);

  useEffect(() => {
    const principal = Math.max(0, Number(price || 0) - Number(downPayment || 0));
    const monthlyRate = (Number(interestRate || 0) / 100) / 12;

    let payment = 0;
    if (months > 0) {
      if (monthlyRate === 0) payment = principal / months;
      else payment = principal * (monthlyRate * Math.pow(1 + monthlyRate, months)) / (Math.pow(1 + monthlyRate, months) - 1);
    }

    const total = payment * months + Number(downPayment || 0);

    onCalculate?.({
      downPayment: Number(downPayment || 0),
      months: Number(months || 0),
      interestRate: Number(interestRate || 0),
      monthlyPayment: payment,
      totalAmount: total,
      financedAmount: principal
    });
  }, [downPayment, months, interestRate, price, onCalculate]);

  return (
    <div className="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-xl p-6 border border-blue-200">
      <div className="flex items-center gap-2 mb-6">
        <Calculator className="w-5 h-5 text-blue-600" />
        <h3 className="text-lg font-semibold text-gray-900">Simulador de Financiamiento</h3>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Entrada</label>
          <div className="relative">
            <DollarSign className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="number"
              value={downPayment}
              onChange={(e) => setDownPayment(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Plazo (meses)</label>
          <input
            type="number"
            value={months}
            onChange={(e) => setMonths(e.target.value)}
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Tasa anual (%)</label>
          <input
            type="number"
            value={interestRate}
            onChange={(e) => setInterestRate(e.target.value)}
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>
      </div>
    </div>
  );
};

/* ----------------------------
   Form
---------------------------- */

const QuotationForm = ({ onSubmit, onCancel, vehicles = [], clients = [], initialData = null }) => {
  const [formData, setFormData] = useState(() => {
    const msDay = 24 * 60 * 60 * 1000;
    const validUntil = initialData?.validUntil ? new Date(initialData.validUntil) : null;
    const validDays = validUntil && Number.isFinite(validUntil.getTime())
      ? Math.max(1, Math.ceil((validUntil.getTime() - Date.now()) / msDay))
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

  const selectedVehicle = useMemo(() => {
    if (!formData.vehicleId) return null;
    return vehicles.find(v => String(v.id) === String(formData.vehicleId)) || null;
  }, [formData.vehicleId, vehicles]);

  useEffect(() => {
    // Autocompleta precio base desde el vehículo seleccionado (si aún está en 0).
    if (selectedVehicle && (!formData.basePrice || Number(formData.basePrice) === 0)) {
      setFormData((p) => ({ ...p, basePrice: Number(selectedVehicle?.precio ?? 0) || 0 }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedVehicle?.id]);

  const finalPrice = useMemo(() => {
    let price = Number(formData.basePrice || 0) - Number(formData.discount || 0) + Number(formData.additionalCosts || 0);
    if (formData.tradeIn && formData.tradeInData?.value) price -= Number(formData.tradeInData.value || 0);
    return Math.max(0, price);
  }, [formData.basePrice, formData.discount, formData.additionalCosts, formData.tradeIn, formData.tradeInData]);

  const canSubmit = Boolean(String(formData.clientId || '').trim()) && Boolean(String(formData.vehicleId || '').trim());

  const handleSubmit = (e) => {
    e.preventDefault();

    onSubmit({
      clientId: String(formData.clientId || ''),
      vehicleId: String(formData.vehicleId || ''),
      currency: String(formData.currency || 'USD').toUpperCase(),
      basePrice: Number(formData.basePrice) || 0,
      discount: Number(formData.discount) || 0,
      additionalCosts: Number(formData.additionalCosts) || 0,
      financing: formData.financing ? (formData.financeData || null) : null,
      tradeIn: formData.tradeIn ? (formData.tradeInData || null) : null,
      notes: String(formData.notes || ''),
      totalPrice: finalPrice,
      status: String(initialData?.status || 'draft'),
      validUntil: new Date(Date.now() + (Number(formData.validDays) || 7) * msDay)
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Datos Básicos</h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Cliente</label>
            <select
              value={formData.clientId}
              onChange={(e) => setFormData({ ...formData, clientId: e.target.value })}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              <option value="">Seleccionar cliente</option>
              {clients.map((c) => (
                <option key={String(c.id)} value={String(c.id)}>
                  {c.name} {c.phone ? `(${c.phone})` : ''}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Vehículo</label>
            <select
              value={formData.vehicleId}
              onChange={(e) => setFormData({ ...formData, vehicleId: e.target.value })}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              <option value="">Seleccionar vehículo</option>
              {vehicles.map((v) => (
                <option key={String(v.id)} value={String(v.id)}>
                  {`${v.marca} ${v.modelo} ${v.version}`.trim()} — {String(v.currency || 'USD').toUpperCase()} {money(v.precio)}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {selectedVehicle && (
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Precios</h3>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Precio Base</label>
              <input
                type="number"
                value={formData.basePrice}
                onChange={(e) => setFormData({ ...formData, basePrice: Number(e.target.value) })}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
              <p className="text-xs text-gray-500 mt-1">Sugerido: {String(selectedVehicle.currency || 'USD').toUpperCase()} {money(selectedVehicle.precio)}</p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Descuento</label>
              <input
                type="number"
                value={formData.discount}
                onChange={(e) => setFormData({ ...formData, discount: Number(e.target.value) })}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Gastos Adicionales</label>
              <input
                type="number"
                value={formData.additionalCosts}
                onChange={(e) => setFormData({ ...formData, additionalCosts: Number(e.target.value) })}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
          </div>

          <div className="mt-6 p-4 bg-gradient-to-r from-blue-50 to-indigo-50 rounded-lg border border-blue-200">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600 mb-1">Precio Final</p>
                <p className="text-3xl font-bold text-blue-600">
                  {String(formData.currency || selectedVehicle.currency || 'USD').toUpperCase()} {money(finalPrice)}
                </p>
              </div>
              <TrendingUp className="w-8 h-8 text-blue-600" />
            </div>
          </div>
        </div>
      )}

      {formData.financing && (
        <FinanceCalculator
          price={finalPrice}
          onCalculate={(data) => setFormData({ ...formData, financeData: data })}
        />
      )}

      <div className="flex gap-3 justify-end">
        <button
          type="button"
          onClick={onCancel}
          className="px-6 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
        >
          Cancelar
        </button>
        <button
          type="submit"
          disabled={!canSubmit}
          className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed"
        >
          Crear Cotización
        </button>
      </div>
    </form>
  );
};

/* ----------------------------
   Card
---------------------------- */

const QuotationCard = ({ quotation, onView, onEdit, onDelete, onSend, onDownload }) => {
  const status = String(quotation?.status || 'draft');

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <div className="text-sm font-semibold text-gray-900">#{quotation.number}</div>
            <div className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-700">{status.toUpperCase()}</div>
          </div>
          <div className="mt-2 text-sm text-gray-700 truncate">{quotation.clientName || '—'} {quotation.clientPhone ? `· ${quotation.clientPhone}` : ''}</div>
          <div className="mt-1 text-sm text-gray-500 truncate">{quotation.vehicle || '—'}</div>
        </div>

        <div className="text-right shrink-0">
          <div className="text-sm text-gray-500">Total</div>
          <div className="text-lg font-bold text-gray-900">{quotation.currency} {money(quotation.totalPrice)}</div>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <button onClick={() => onView(quotation)} className="flex items-center gap-1 px-3 py-1.5 text-sm border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50">
          <Eye className="w-4 h-4" /> Ver
        </button>
        <button onClick={() => onDownload(quotation)} className="flex items-center gap-1 px-3 py-1.5 text-sm border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50">
          <Download className="w-4 h-4" /> Descargar
        </button>
        <button onClick={() => onEdit(quotation)} className="flex items-center gap-1 px-3 py-1.5 text-sm border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50">
          <Edit className="w-4 h-4" /> Editar
        </button>
        <button onClick={() => onSend(quotation)} className="flex items-center gap-1 px-3 py-1.5 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700">
          <Send className="w-4 h-4" /> Enviar
        </button>
        <button onClick={() => onDelete(quotation)} className="flex items-center gap-1 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 rounded-lg ml-auto">
          <Trash2 className="w-4 h-4" /> Eliminar
        </button>
      </div>
    </div>
  );
};

/* ----------------------------
   Manager
---------------------------- */

const QuotationsManager = () => {
  const [quotations, setQuotations] = useState([]);
  const [clients, setClients] = useState([]);
  const [vehicles, setVehicles] = useState([]);

  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);

  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  const fetchQuotations = async () => {
    setLoading(true);
    try {
      const r = await listQuotations({ status: 'all', q: '', limit: 200 });
      const list = Array.isArray(r?.quotations) ? r.quotations : [];
      setQuotations(list.map(normalizeQuotation));
    } catch (e) {
      toastError(e);
    } finally {
      setLoading(false);
    }
  };

  const fetchClients = async () => {
    try {
      const { data } = await api.get('/contacts', { params: { pageNumber: 1, pageSize: 500 } });
      const list = Array.isArray(data?.contacts) ? data.contacts : [];
      setClients(list.map((c) => ({
        id: String(c.id),
        name: String(c.name || ''),
        phone: String(c.number || c.phone || '')
      })));
    } catch {
      setClients([]);
    }
  };

  const fetchVehicles = async () => {
    try {
      const { data } = await api.get('/vehicles', { params: { q: '', limit: 500 } });
      const list = Array.isArray(data?.vehicles)
        ? data.vehicles
        : Array.isArray(data)
          ? data
          : [];

      setVehicles(list.map((v) => ({
        id: String(v.id),
        marca: v.marca ?? v.brand ?? v.make ?? '',
        modelo: v.modelo ?? v.model ?? '',
        version: v.version ?? v.trim ?? v.title ?? '',
        precio: Number(v.precio ?? v.price ?? 0) || 0,
        currency: String(v.currency ?? v.moneda ?? 'USD').toUpperCase(),
        year: v.year ?? v.anio ?? null,
        raw: v
      })));
    } catch {
      setVehicles([]);
    }
  };

  useEffect(() => {
    fetchQuotations();
    fetchClients();
    fetchVehicles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filteredQuotations = useMemo(() => {
    let filtered = [...quotations];

    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      filtered = filtered.filter(q =>
        String(q.number || '').toLowerCase().includes(term) ||
        String(q.clientName || '').toLowerCase().includes(term) ||
        String(q.vehicle || '').toLowerCase().includes(term)
      );
    }

    if (statusFilter !== 'all') {
      filtered = filtered.filter(q => String(q.status) === String(statusFilter));
    }

    return filtered;
  }, [quotations, searchTerm, statusFilter]);

  const handleCreateQuotation = async (quotationData) => {
    try {
      const clientId = String(quotationData?.clientId || '');
      const vehicleId = String(quotationData?.vehicleId || '');

      const client = clients.find(c => String(c.id) === clientId);
      const vehicle = vehicles.find(v => String(v.id) === vehicleId);

      const vehicleLabel = vehicle
        ? `${vehicle.marca} ${vehicle.modelo} ${vehicle.version}`.trim()
        : String(quotationData?.vehicleLabel || quotationData?.vehicle || '').trim();

      const payload = {
        ...quotationData,
        contactId: clientId ? Number(clientId) : null,
        clientRefId: clientId ? Number(clientId) : null,
        clientName: client?.name || String(quotationData?.clientName || '').trim(),
        clientPhone: client?.phone || String(quotationData?.clientPhone || '').trim(),
        vehicleId,
        vehicleRefId: null,
        vehicleLabel,
        vehicleData: vehicle?.raw || vehicle || null
      };

      await createQuotation(payload);
      toast.success('Cotización creada');
      await fetchQuotations();
      setShowForm(false);
      setEditing(null);
    } catch (e) {
      toastError(e);
    }
  };

  const handleUpdateQuotation = async (id, quotationData) => {
    try {
      const clientId = String(quotationData?.clientId || '');
      const vehicleId = String(quotationData?.vehicleId || '');

      const client = clients.find(c => String(c.id) === clientId);
      const vehicle = vehicles.find(v => String(v.id) === vehicleId);

      const vehicleLabel = vehicle
        ? `${vehicle.marca} ${vehicle.modelo} ${vehicle.version}`.trim()
        : String(quotationData?.vehicleLabel || quotationData?.vehicle || '').trim();

      const payload = {
        ...quotationData,
        contactId: clientId ? Number(clientId) : null,
        clientRefId: clientId ? Number(clientId) : null,
        clientName: client?.name || String(quotationData?.clientName || '').trim(),
        clientPhone: client?.phone || String(quotationData?.clientPhone || '').trim(),
        vehicleId,
        vehicleRefId: null,
        vehicleLabel,
        vehicleData: vehicle?.raw || vehicle || null
      };

      await updateQuotation(id, payload);
      toast.success('Cotización actualizada');
      await fetchQuotations();
      setShowForm(false);
      setEditing(null);
    } catch (e) {
      toastError(e);
    }
  };

  const handleDeleteQuotation = async (q) => {
    const ok = window.confirm(`Eliminar cotización #${q?.number || q?.id}?`);
    if (!ok) return;
    try {
      await deleteQuotation(q.id);
      toast.success('Cotización eliminada');
      await fetchQuotations();
    } catch (e) {
      toastError(e);
    }
  };

  const handleSendQuotation = async (q) => {
    try {
      await sendQuotation(q.id);
      toast.success('Cotización enviada por WhatsApp');
      await fetchQuotations();
    } catch (e) {
      toastError(e);
    }
  };

  const handleEditQuotation = (q) => {
    setEditing(q);
    setShowForm(true);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Cargando cotizaciones...</p>
        </div>
      </div>
    );
  }

  if (showForm) {
    return (
      <div className="min-h-screen bg-gray-50 p-6">
        <div className="max-w-5xl mx-auto">
          <div className="mb-6">
            <h1 className="text-2xl font-bold text-gray-900">{editing ? 'Editar Cotización' : 'Nueva Cotización'}</h1>
            <p className="text-gray-500 mt-1">Genera una propuesta para tu cliente</p>
          </div>

          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <QuotationForm
              vehicles={vehicles}
              clients={clients}
              initialData={editing}
              onSubmit={(data) => (editing ? handleUpdateQuotation(editing.id, data) : handleCreateQuotation(data))}
              onCancel={() => { setShowForm(false); setEditing(null); }}
            />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-7xl mx-auto">
        <div className="mb-6 bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Cotizaciones</h1>
              <p className="text-gray-500 mt-1">{filteredQuotations.length} cotizaciones</p>
            </div>

            <button
              onClick={() => { setEditing(null); setShowForm(true); }}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              <Plus className="w-4 h-4" />
              Nueva Cotización
            </button>
          </div>

          <div className="flex flex-wrap gap-4">
            <div className="flex-1 min-w-[300px]">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="text"
                  placeholder="Buscar por número, cliente, vehículo..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
            </div>

            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              <option value="all">Todos los estados</option>
              <option value="draft">Borrador</option>
              <option value="sent">Enviadas</option>
              <option value="viewed">Vistas</option>
              <option value="accepted">Aceptadas</option>
              <option value="rejected">Rechazadas</option>
            </select>
          </div>
        </div>

        <div className="space-y-4">
          {filteredQuotations.length === 0 ? (
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-12 text-center">
              <FileText className="w-16 h-16 text-gray-400 mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-gray-900 mb-2">No hay cotizaciones</h3>
              <p className="text-gray-500 mb-4">Crea tu primera cotización para comenzar</p>
              <button
                onClick={() => { setEditing(null); setShowForm(true); }}
                className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
              >
                <Plus className="w-4 h-4" />
                Nueva Cotización
              </button>
            </div>
          ) : (
            filteredQuotations.map((q) => (
              <QuotationCard
                key={q.id}
                quotation={q}
                onView={(qq) => viewQuotation(qq)}
                onDownload={(qq) => viewQuotation(qq, { print: true })}
                onEdit={handleEditQuotation}
                onDelete={handleDeleteQuotation}
                onSend={handleSendQuotation}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
};

export default QuotationsManager;
