import React, { useState, useEffect } from 'react';
import {
  FileText, Download, Send, Eye, Edit, Trash2, Plus, Calculator,
  DollarSign, Calendar, User, Car, Percent, TrendingUp, CheckCircle,
  Clock, XCircle, Search, Filter, Mail, Phone, MessageSquare,
  Printer, Share2, Copy, ArrowRight, ChevronDown, ChevronUp
} from 'lucide-react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';

// Calculadora de Financiamiento
const FinanceCalculator = ({ price, onCalculate }) => {
  const [downPayment, setDownPayment] = useState(price * 0.2);
  const [months, setMonths] = useState(60);
  const [interestRate, setInterestRate] = useState(35);
  const [monthlyPayment, setMonthlyPayment] = useState(0);
  const [totalAmount, setTotalAmount] = useState(0);

  useEffect(() => {
    calculateFinance();
  }, [downPayment, months, interestRate, price]);

  const calculateFinance = () => {
    const principal = price - downPayment;
    const monthlyRate = (interestRate / 100) / 12;
    
    let payment;
    if (monthlyRate === 0) {
      payment = principal / months;
    } else {
      payment = principal * (monthlyRate * Math.pow(1 + monthlyRate, months)) / 
                (Math.pow(1 + monthlyRate, months) - 1);
    }
    
    const total = payment * months + downPayment;
    
    setMonthlyPayment(payment);
    setTotalAmount(total);
    
    if (onCalculate) {
      onCalculate({
        downPayment,
        months,
        interestRate,
        monthlyPayment: payment,
        totalAmount: total,
        financedAmount: principal
      });
    }
  };

  return (
    <div className="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-xl p-6 border border-blue-200">
      <div className="flex items-center gap-2 mb-6">
        <Calculator className="w-5 h-5 text-blue-600" />
        <h3 className="text-lg font-semibold text-gray-900">Simulador de Financiamiento</h3>
      </div>

      <div className="space-y-4">
        {/* Entrada */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Entrada (Anticipo)
          </label>
          <div className="relative">
            <DollarSign className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="number"
              value={downPayment}
              onChange={(e) => setDownPayment(Number(e.target.value))}
              className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
          <div className="mt-2">
            <input
              type="range"
              min={price * 0.1}
              max={price * 0.5}
              step={1000}
              value={downPayment}
              onChange={(e) => setDownPayment(Number(e.target.value))}
              className="w-full"
            />
            <div className="flex justify-between text-xs text-gray-500 mt-1">
              <span>{((downPayment / price) * 100).toFixed(0)}% del total</span>
              <span>${downPayment.toLocaleString()}</span>
            </div>
          </div>
        </div>

        {/* Plazo */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Plazo (meses)
          </label>
          <div className="grid grid-cols-4 gap-2">
            {[12, 24, 36, 48, 60, 72, 84, 96].map((m) => (
              <button
                key={m}
                onClick={() => setMonths(m)}
                className={`py-2 rounded-lg text-sm font-medium transition-colors ${
                  months === m
                    ? 'bg-blue-600 text-white'
                    : 'bg-white border border-gray-300 text-gray-700 hover:bg-gray-50'
                }`}
              >
                {m}
              </button>
            ))}
          </div>
        </div>

        {/* Tasa de Interés */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Tasa de Interés Anual (%)
          </label>
          <div className="relative">
            <Percent className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="number"
              value={interestRate}
              onChange={(e) => setInterestRate(Number(e.target.value))}
              step="0.5"
              className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
          <input
            type="range"
            min="0"
            max="100"
            step="0.5"
            value={interestRate}
            onChange={(e) => setInterestRate(Number(e.target.value))}
            className="w-full mt-2"
          />
        </div>

        {/* Resultados */}
        <div className="mt-6 space-y-3">
          <div className="bg-white rounded-lg p-4 border-2 border-blue-600">
            <p className="text-sm text-gray-600 mb-1">Cuota Mensual</p>
            <p className="text-3xl font-bold text-blue-600">
              ${Math.round(monthlyPayment).toLocaleString()}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="bg-white rounded-lg p-3 border border-gray-200">
              <p className="text-xs text-gray-600 mb-1">Monto Financiado</p>
              <p className="text-lg font-semibold text-gray-900">
                ${Math.round(price - downPayment).toLocaleString()}
              </p>
            </div>
            <div className="bg-white rounded-lg p-3 border border-gray-200">
              <p className="text-xs text-gray-600 mb-1">Total a Pagar</p>
              <p className="text-lg font-semibold text-gray-900">
                ${Math.round(totalAmount).toLocaleString()}
              </p>
            </div>
          </div>

          <div className="bg-amber-50 rounded-lg p-3 border border-amber-200">
            <p className="text-xs text-amber-800 mb-1">Intereses Totales</p>
            <p className="text-lg font-semibold text-amber-900">
              ${Math.round(totalAmount - price).toLocaleString()}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

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
const QuotationForm = ({ onSubmit, onCancel, vehicles = [], clients = [] }) => {
  const [formData, setFormData] = useState({
    clientId: '',
    vehicleId: '',
    basePrice: 0,
    discount: 0,
    additionalCosts: 0,
    financing: false,
    financeData: null,
    tradeIn: false,
    tradeInData: null,
    validDays: 7,
    notes: ''
  });

  const [selectedVehicle, setSelectedVehicle] = useState(null);
  const [finalPrice, setFinalPrice] = useState(0);

  useEffect(() => {
    if (formData.vehicleId && vehicles.length > 0) {
      const vehicle = vehicles.find(v => v.id === parseInt(formData.vehicleId));
      setSelectedVehicle(vehicle);
      setFormData(prev => ({ ...prev, basePrice: vehicle?.precio || 0 }));
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
      ...formData,
      totalPrice: finalPrice,
      status: 'draft',
      createdAt: new Date(),
      validUntil: new Date(Date.now() + formData.validDays * 24 * 60 * 60 * 1000)
    };
    
    onSubmit(quotation);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Datos Básicos</h3>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
        </div>
      </div>

      {/* Precios */}
      {selectedVehicle && (
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Precios</h3>
          
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Precio Base
                </label>
                <div className="relative">
                  <DollarSign className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input
                    type="number"
                    value={formData.basePrice}
                    onChange={(e) => setFormData({ ...formData, basePrice: Number(e.target.value) })}
                    className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Descuento
                </label>
                <div className="relative">
                  <DollarSign className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input
                    type="number"
                    value={formData.discount}
                    onChange={(e) => setFormData({ ...formData, discount: Number(e.target.value) })}
                    className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Costos Adicionales
                </label>
                <div className="relative">
                  <DollarSign className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input
                    type="number"
                    value={formData.additionalCosts}
                    onChange={(e) => setFormData({ ...formData, additionalCosts: Number(e.target.value) })}
                    placeholder="Patentamiento, seguro..."
                    className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
              </div>
            </div>

            <div className="bg-blue-50 rounded-lg p-4 border border-blue-200">
              <div className="flex items-center justify-between">
                <span className="text-lg font-medium text-gray-700">Precio Final</span>
                <span className="text-3xl font-bold text-blue-600">
                  ${finalPrice.toLocaleString()}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Financiamiento */}
      {selectedVehicle && (
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-gray-900">Financiamiento</h3>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={formData.financing}
                onChange={(e) => setFormData({ ...formData, financing: e.target.checked })}
                className="w-5 h-5 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
              />
              <span className="text-sm font-medium text-gray-700">Incluir financiamiento</span>
            </label>
          </div>

          {formData.financing && (
            <FinanceCalculator
              price={finalPrice}
              onCalculate={(financeData) => setFormData({ ...formData, financeData })}
            />
          )}
        </div>
      )}

      {/* Trade-In */}
      {selectedVehicle && (
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-gray-900">Vehículo en Parte de Pago</h3>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={formData.tradeIn}
                onChange={(e) => setFormData({ ...formData, tradeIn: e.target.checked })}
                className="w-5 h-5 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
              />
              <span className="text-sm font-medium text-gray-700">Incluir usado</span>
            </label>
          </div>

          {formData.tradeIn && (
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <input
                type="text"
                placeholder="Marca"
                onChange={(e) => setFormData({
                  ...formData,
                  tradeInData: { ...formData.tradeInData, brand: e.target.value }
                })}
                className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
              <input
                type="text"
                placeholder="Modelo"
                onChange={(e) => setFormData({
                  ...formData,
                  tradeInData: { ...formData.tradeInData, model: e.target.value }
                })}
                className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
              <input
                type="number"
                placeholder="Año"
                onChange={(e) => setFormData({
                  ...formData,
                  tradeInData: { ...formData.tradeInData, year: Number(e.target.value) }
                })}
                className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
              <div className="relative">
                <DollarSign className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="number"
                  placeholder="Valor estimado"
                  onChange={(e) => setFormData({
                    ...formData,
                    tradeInData: { ...formData.tradeInData, value: Number(e.target.value) }
                  })}
                  className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
            </div>
          )}
        </div>
      )}

      {/* Notas y Validez */}
      {selectedVehicle && (
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-4">
            <div className="md:col-span-3">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Notas / Condiciones
              </label>
              <textarea
                value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                rows={3}
                placeholder="Condiciones especiales, accesorios incluidos, etc."
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Válida por (días)
              </label>
              <input
                type="number"
                value={formData.validDays}
                onChange={(e) => setFormData({ ...formData, validDays: Number(e.target.value) })}
                min="1"
                max="90"
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
          </div>
        </div>
      )}

      {/* Botones */}
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
          disabled={!selectedVehicle || !formData.clientId}
          className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed"
        >
          Crear Cotización
        </button>
      </div>
    </form>
  );
};

// Componente Principal
const QuotationsManager = () => {
  const [quotations, setQuotations] = useState([]);
  const [filteredQuotations, setFilteredQuotations] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [loading, setLoading] = useState(true);

  // Mock data
  const mockVehicles = [
    { id: 1, marca: 'Toyota', modelo: 'Corolla', version: 'XEi', precio: 35000 },
    { id: 2, marca: 'Honda', modelo: 'Civic', version: 'EX-L', precio: 40000 },
  ];

  const mockClients = [
    { id: 1, name: 'Juan Pérez', phone: '+54 9 11 2345-6789' },
    { id: 2, name: 'María López', phone: '+54 9 11 3456-7890' },
  ];

  useEffect(() => {
    fetchQuotations();
  }, []);

  useEffect(() => {
    applyFilters();
  }, [quotations, searchTerm, statusFilter]);

  const fetchQuotations = async () => {
    setLoading(true);
    try {
      // Mock data
      const mockQuotations = [
        {
          id: 1,
          number: '2024-001',
          clientName: 'Juan Pérez',
          vehicle: 'Toyota Corolla XEi',
          totalPrice: 33500,
          status: 'sent',
          financing: {
            downPayment: 7000,
            months: 60,
            interestRate: 35,
            monthlyPayment: 680,
            totalAmount: 47800
          },
          createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
          validUntil: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000)
        },
        {
          id: 2,
          number: '2024-002',
          clientName: 'María López',
          vehicle: 'Honda Civic EX-L',
          totalPrice: 38000,
          status: 'accepted',
          monthlyPayment: 850,
          createdAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000)
        }
      ];
      setQuotations(mockQuotations);
    } catch (error) {
      console.error('Error fetching quotations:', error);
    } finally {
      setLoading(false);
    }
  };

  const applyFilters = () => {
    let filtered = [...quotations];

    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      filtered = filtered.filter(q =>
        q.number.toLowerCase().includes(term) ||
        q.clientName.toLowerCase().includes(term) ||
        q.vehicle.toLowerCase().includes(term)
      );
    }

    if (statusFilter !== 'all') {
      filtered = filtered.filter(q => q.status === statusFilter);
    }

    setFilteredQuotations(filtered);
  };

  const handleCreateQuotation = (quotationData) => {
    const newQuotation = {
      ...quotationData,
      id: quotations.length + 1,
      number: `2024-${String(quotations.length + 1).padStart(3, '0')}`,
      clientName: mockClients.find(c => c.id === parseInt(quotationData.clientId))?.name,
      vehicle: mockVehicles.find(v => v.id === parseInt(quotationData.vehicleId))?.modelo,
      monthlyPayment: quotationData.financeData?.monthlyPayment
    };

    setQuotations([newQuotation, ...quotations]);
    setShowForm(false);
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
            <h1 className="text-2xl font-bold text-gray-900">Nueva Cotización</h1>
            <p className="text-gray-500 mt-1">Genera una propuesta profesional para tu cliente</p>
          </div>
          
          <QuotationForm
            vehicles={mockVehicles}
            clients={mockClients}
            onSubmit={handleCreateQuotation}
            onCancel={() => setShowForm(false)}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-6 bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Cotizaciones</h1>
              <p className="text-gray-500 mt-1">{filteredQuotations.length} cotizaciones</p>
            </div>
            
            <button
              onClick={() => setShowForm(true)}
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

        {/* Stats */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
            <p className="text-sm text-gray-600 mb-1">Total</p>
            <p className="text-2xl font-bold text-gray-900">{quotations.length}</p>
          </div>
          <div className="bg-blue-50 rounded-lg border border-blue-200 p-4">
            <p className="text-sm text-blue-600 mb-1">Enviadas</p>
            <p className="text-2xl font-bold text-blue-900">
              {quotations.filter(q => q.status === 'sent').length}
            </p>
          </div>
          <div className="bg-green-50 rounded-lg border border-green-200 p-4">
            <p className="text-sm text-green-600 mb-1">Aceptadas</p>
            <p className="text-2xl font-bold text-green-900">
              {quotations.filter(q => q.status === 'accepted').length}
            </p>
          </div>
          <div className="bg-amber-50 rounded-lg border border-amber-200 p-4">
            <p className="text-sm text-amber-600 mb-1">Tasa Conversión</p>
            <p className="text-2xl font-bold text-amber-900">
              {quotations.length > 0 
                ? Math.round((quotations.filter(q => q.status === 'accepted').length / quotations.length) * 100)
                : 0}%
            </p>
          </div>
        </div>

        {/* Lista de Cotizaciones */}
        <div className="space-y-4">
          {filteredQuotations.length === 0 ? (
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-12 text-center">
              <FileText className="w-16 h-16 text-gray-400 mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-gray-900 mb-2">
                No hay cotizaciones
              </h3>
              <p className="text-gray-500 mb-4">
                Crea tu primera cotización para comenzar
              </p>
              <button
                onClick={() => setShowForm(true)}
                className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
              >
                <Plus className="w-4 h-4" />
                Nueva Cotización
              </button>
            </div>
          ) : (
            filteredQuotations.map(quotation => (
              <QuotationCard
                key={quotation.id}
                quotation={quotation}
                onView={(q) => console.log('View', q)}
                onEdit={(q) => console.log('Edit', q)}
                onDelete={(q) => console.log('Delete', q)}
                onSend={(q) => console.log('Send', q)}
                onDownload={(q) => console.log('Download PDF', q)}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
};

export default QuotationsManager;
