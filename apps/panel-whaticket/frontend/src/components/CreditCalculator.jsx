import React, { useState, useCallback } from "react";

/**
 * Calculadora de crédito automotor integrada al panel de tickets.
 *
 * Reglas de negocio:
 * - API CreditCar: https://api.cotizadorcreditcar.com.ar/2?monto=AMOUNT&modelo=YEAR
 *   - modelo: año del vehículo (2026 para nuevo, 12 para 2012, etc.)
 *   - monto: monto a financiar en pesos
 * - Siempre se suma $200.000 arriba del TOTAL (no por cuota)
 * - Se financia hasta el 50% del precio del vehículo como máximo
 */

const CREDIT_API = "https://api.cotizadorcreditcar.com.ar/2";
const GASTOS_FIJOS = 200000; // $200k arriba del total siempre
const MAX_FINANCIACION_PCT = 50; // Hasta 50% del precio

function formatARS(n) {
  if (n == null || isNaN(n)) return "-";
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n);
}

function parseInputNumber(val) {
  if (!val) return 0;
  // Accept both "15500000" and "15.500.000" and "15,500,000"
  const cleaned = String(val).replace(/[^\d]/g, "");
  return Number(cleaned) || 0;
}

function yearToModelo(year) {
  if (!year) return "";
  const y = Number(year);
  if (y >= 2000 && y <= 2099) {
    // 2026 → "2026", 2012 → "12"
    return y >= 2020 ? String(y) : String(y - 2000);
  }
  return String(y);
}

export default function CreditCalculator() {
  const [precio, setPrecio] = useState("");
  const [entrega, setEntrega] = useState("");
  const [anio, setAnio] = useState(String(new Date().getFullYear()));
  const [resultado, setResultado] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const precioNum = parseInputNumber(precio);
  const entregaNum = parseInputNumber(entrega);
  const montoBase = Math.max(0, precioNum - entregaNum);
  const montoConGastos = montoBase + GASTOS_FIJOS;
  const maxFinanciable = Math.floor(precioNum * (MAX_FINANCIACION_PCT / 100));
  const excede50 = montoBase > maxFinanciable && precioNum > 0;

  const calcular = useCallback(async () => {
    if (!precioNum || precioNum <= 0) {
      setError("Ingresá el precio del vehículo");
      return;
    }
    if (excede50) {
      setError(`El monto a financiar supera el 50% del precio. Máximo financiable: ${formatARS(maxFinanciable)}`);
      return;
    }
    if (montoBase <= 0) {
      setError("La entrega cubre el total del vehículo");
      return;
    }

    setLoading(true);
    setError(null);
    setResultado(null);

    const modelo = yearToModelo(anio);

    try {
      const url = `${CREDIT_API}?monto=${montoConGastos}&modelo=${modelo}`;
      const res = await fetch(url);

      if (!res.ok) throw new Error(`Error ${res.status}`);

      const data = await res.json();
      setResultado(data);
    } catch (err) {
      console.error("[CreditCalculator]", err);
      setError("No se pudo conectar con el cotizador. Intentá de nuevo.");
    } finally {
      setLoading(false);
    }
  }, [precioNum, entregaNum, anio, montoConGastos, excede50, maxFinanciable, montoBase]);

  const inputClass =
    "w-full rounded-lg border border-auto-border bg-auto-surface px-3 py-2 text-sm text-auto-text outline-none transition-colors placeholder:text-auto-hint focus:border-auto-accent/50 focus:ring-1 focus:ring-auto-accent/30";
  const labelClass = "block text-[11px] font-medium uppercase tracking-wide text-auto-muted mb-1";

  return (
    <div className="space-y-3">
      {/* Inputs */}
      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className={labelClass}>Precio vehículo</label>
          <input
            type="text"
            value={precio}
            onChange={(e) => setPrecio(e.target.value)}
            placeholder="15.500.000"
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass}>Entrega / Permuta</label>
          <input
            type="text"
            value={entrega}
            onChange={(e) => setEntrega(e.target.value)}
            placeholder="9.000.000"
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass}>Año vehículo</label>
          <input
            type="text"
            value={anio}
            onChange={(e) => setAnio(e.target.value)}
            placeholder="2026"
            className={inputClass}
          />
        </div>
      </div>

      {/* Resumen rápido */}
      {precioNum > 0 ? (
        <div className="flex flex-wrap items-center gap-3 text-xs text-auto-muted">
          <span>A financiar: <strong className="text-auto-text">{formatARS(montoBase)}</strong></span>
          <span>+ Gastos: <strong className="text-auto-text">{formatARS(GASTOS_FIJOS)}</strong></span>
          <span>=</span>
          <span className="text-sm font-semibold text-auto-text">{formatARS(montoConGastos)}</span>
          {excede50 ? (
            <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-[11px] font-medium text-red-400">
              Excede 50% (máx {formatARS(maxFinanciable)})
            </span>
          ) : (
            <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-medium text-emerald-400">
              {precioNum > 0 ? `${Math.round((montoBase / precioNum) * 100)}%` : "0%"} del precio
            </span>
          )}
        </div>
      ) : null}

      {/* Botón calcular */}
      <button
        type="button"
        onClick={calcular}
        disabled={loading || excede50}
        className="inline-flex items-center gap-2 rounded-lg border border-auto-accent/30 bg-auto-accent/15 px-4 py-2 text-sm font-medium text-auto-accent transition-colors hover:bg-auto-accent/25 disabled:opacity-50"
      >
        {loading ? "Calculando..." : "Calcular cuotas"}
      </button>

      {/* Error */}
      {error ? (
        <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-400">
          {error}
        </div>
      ) : null}

      {/* Resultados */}
      {resultado ? (
        <div className="space-y-2">
          <div className="text-[11px] font-medium uppercase tracking-wide text-auto-muted">
            Planes disponibles
          </div>
          {Array.isArray(resultado) ? (
            <div className="grid gap-2 sm:grid-cols-2">
              {resultado.map((plan, idx) => (
                <div
                  key={idx}
                  className="rounded-lg border border-auto-border bg-auto-surface p-3"
                >
                  {plan.cuotas || plan.plazo ? (
                    <div className="text-xs font-semibold text-auto-accent">
                      {plan.cuotas || plan.plazo} cuotas
                    </div>
                  ) : null}
                  {plan.valorCuota || plan.cuota || plan.montoCuota ? (
                    <div className="mt-1 text-lg font-bold text-auto-text">
                      {formatARS(plan.valorCuota || plan.cuota || plan.montoCuota)}
                      <span className="text-xs font-normal text-auto-muted"> /mes</span>
                    </div>
                  ) : null}
                  {plan.tna || plan.tasaNominal ? (
                    <div className="mt-1 text-[11px] text-auto-muted">
                      TNA: {plan.tna || plan.tasaNominal}%
                    </div>
                  ) : null}
                  {plan.cft || plan.costoFinancieroTotal ? (
                    <div className="text-[11px] text-auto-muted">
                      CFT: {plan.cft || plan.costoFinancieroTotal}%
                    </div>
                  ) : null}
                  {/* Fallback: mostrar todas las keys si no matchean los nombres esperados */}
                  {!plan.cuotas && !plan.plazo && !plan.valorCuota && !plan.cuota && !plan.montoCuota ? (
                    <pre className="text-xs text-auto-muted whitespace-pre-wrap">
                      {JSON.stringify(plan, null, 2)}
                    </pre>
                  ) : null}
                </div>
              ))}
            </div>
          ) : typeof resultado === "object" ? (
            /* Si la API devuelve un objeto en vez de array */
            <div className="rounded-lg border border-auto-border bg-auto-surface p-3">
              {Object.entries(resultado).map(([key, val]) => (
                <div key={key} className="flex items-baseline justify-between py-1 text-sm">
                  <span className="text-auto-muted">{key}</span>
                  <span className="font-medium text-auto-text">
                    {typeof val === "number" ? formatARS(val) : String(val)}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-sm text-auto-muted">{String(resultado)}</div>
          )}
        </div>
      ) : null}
    </div>
  );
}
