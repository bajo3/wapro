import React, { useState, useCallback } from "react";

/**
 * Calculadora de crédito automotor — versión simplificada.
 *
 * El operador ingresa directamente:
 *   - Monto a financiar (en pesos)
 *   - Año del vehículo
 *
 * Luego elige el plan con botones rápidos: 6 / 12 / 18 / 24 / 36 cuotas.
 *
 * API CreditCar: https://api.cotizadorcreditcar.com.ar/2?monto=AMOUNT&modelo=YEAR
 *   - Se suman $200.000 de gastos fijos al monto ingresado.
 */

const CREDIT_API = "https://api.cotizadorcreditcar.com.ar/2";
const GASTOS_FIJOS = 200000;
const CUOTAS_OPTIONS = [6, 12, 18, 24, 36];

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
  const cleaned = String(val).replace(/[^\d]/g, "");
  return Number(cleaned) || 0;
}

function yearToModelo(year) {
  if (!year) return "";
  const y = Number(year);
  if (y >= 2000 && y <= 2099) {
    return y >= 2020 ? String(y) : String(y - 2000);
  }
  return String(y);
}

function matchCuotas(plan) {
  // Try to extract cuota count from common API field names
  const raw = plan.cuotas ?? plan.plazo ?? plan.cantidadCuotas ?? plan.plazos ?? null;
  if (raw == null) return null;
  return Number(raw) || null;
}

function getValorCuota(plan) {
  return plan.valorCuota ?? plan.cuota ?? plan.montoCuota ?? null;
}

export default function CreditCalculator() {
  const [monto, setMonto] = useState("");
  const [anio, setAnio] = useState(String(new Date().getFullYear()));
  const [resultado, setResultado] = useState(null);
  const [activeCuotas, setActiveCuotas] = useState(null); // cuota filter or null = all
  const [loading, setLoading] = useState(false);
  const [loadingCuotas, setLoadingCuotas] = useState(null);
  const [error, setError] = useState(null);

  const montoNum = parseInputNumber(monto);
  const montoConGastos = montoNum + GASTOS_FIJOS;

  const calcular = useCallback(
    async (cuotasFilter) => {
      if (!montoNum || montoNum <= 0) {
        setError("Ingresá el monto a financiar");
        return;
      }
      setError(null);
      setLoadingCuotas(cuotasFilter);
      setLoading(true);
      setActiveCuotas(cuotasFilter);

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
        setResultado(null);
      } finally {
        setLoading(false);
        setLoadingCuotas(null);
      }
    },
    [montoNum, anio, montoConGastos]
  );

  // Filter plans by cuota count when a specific plan is selected
  const planes = Array.isArray(resultado) ? resultado : resultado && typeof resultado === "object" ? [resultado] : [];
  const planesFiltrados =
    activeCuotas != null
      ? planes.filter((p) => matchCuotas(p) === activeCuotas)
      : planes;

  const inputClass =
    "w-full rounded-lg border border-auto-border bg-auto-surface px-3 py-2 text-sm text-auto-text outline-none transition-colors placeholder:text-auto-hint focus:border-auto-accent/50 focus:ring-1 focus:ring-auto-accent/30";
  const labelClass =
    "block text-[11px] font-medium uppercase tracking-wide text-auto-muted mb-1";

  return (
    <div className="space-y-3">
      {/* Inputs: monto + año */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelClass}>Monto a financiar</label>
          <input
            type="text"
            value={monto}
            onChange={(e) => {
              setMonto(e.target.value);
              setResultado(null);
              setError(null);
            }}
            placeholder="6.500.000"
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass}>Año vehículo</label>
          <input
            type="text"
            value={anio}
            onChange={(e) => {
              setAnio(e.target.value);
              setResultado(null);
              setError(null);
            }}
            placeholder="2026"
            className={inputClass}
          />
        </div>
      </div>

      {/* Resumen: monto + gastos */}
      {montoNum > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-auto-muted">
          <span>
            A financiar:{" "}
            <strong className="text-auto-text">{formatARS(montoNum)}</strong>
          </span>
          <span className="text-auto-border">+</span>
          <span>
            Gastos:{" "}
            <strong className="text-auto-text">{formatARS(GASTOS_FIJOS)}</strong>
          </span>
          <span className="text-auto-border">=</span>
          <span className="font-semibold text-auto-text">
            {formatARS(montoConGastos)}
          </span>
        </div>
      )}

      {/* Botones rápidos de cuotas */}
      <div>
        <div className={labelClass} style={{ marginBottom: 6 }}>
          Cuotas
        </div>
        <div className="flex flex-wrap gap-1.5">
          {CUOTAS_OPTIONS.map((c) => {
            const isActive = activeCuotas === c && resultado !== null;
            const isLoading = loadingCuotas === c;
            return (
              <button
                key={c}
                type="button"
                disabled={loading}
                onClick={() => calcular(c)}
                className={[
                  "inline-flex h-9 items-center justify-center rounded-lg border px-3 text-sm font-semibold transition-colors disabled:opacity-50",
                  isActive
                    ? "border-auto-accent/50 bg-auto-accent/20 text-auto-accent"
                    : "border-auto-border bg-auto-surface text-auto-text hover:border-auto-accent/30 hover:bg-auto-accent/10 hover:text-auto-accent",
                ].join(" ")}
              >
                {isLoading ? "…" : `${c}`}
              </button>
            );
          })}
          {/* Ver todos los planes */}
          <button
            type="button"
            disabled={loading}
            onClick={() => calcular(null)}
            className={[
              "inline-flex h-9 items-center justify-center rounded-lg border px-3 text-xs transition-colors disabled:opacity-50",
              activeCuotas === null && resultado !== null
                ? "border-auto-accent/30 bg-auto-accent/10 text-auto-accent"
                : "border-auto-border bg-auto-surface text-auto-muted hover:bg-auto-panel2",
            ].join(" ")}
          >
            {loading && activeCuotas === null ? "…" : "Todos"}
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-400">
          {error}
        </div>
      )}

      {/* Resultados */}
      {resultado !== null && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className={labelClass} style={{ marginBottom: 0 }}>
              {activeCuotas != null
                ? `Plan ${activeCuotas} cuotas`
                : "Todos los planes"}
            </div>
            {activeCuotas !== null && planes.length > 0 && (
              <button
                type="button"
                onClick={() => setActiveCuotas(null)}
                className="text-[11px] text-auto-muted hover:text-auto-text transition-colors"
              >
                Ver todos
              </button>
            )}
          </div>

          {planesFiltrados.length === 0 && (
            <div className="rounded-lg border border-auto-border bg-auto-surface px-3 py-2 text-sm text-auto-muted">
              No se encontró plan de {activeCuotas} cuotas en la respuesta.
            </div>
          )}

          <div className="grid gap-2 sm:grid-cols-2">
            {planesFiltrados.map((plan, idx) => {
              const cuotas = matchCuotas(plan);
              const valorCuota = getValorCuota(plan);
              const hasKnownFields = cuotas != null || valorCuota != null;
              return (
                <div
                  key={idx}
                  className="rounded-lg border border-auto-border bg-auto-surface p-3"
                >
                  {cuotas != null && (
                    <div className="text-xs font-semibold text-auto-accent">
                      {cuotas} cuotas
                    </div>
                  )}
                  {valorCuota != null && (
                    <div className="mt-1 text-lg font-bold text-auto-text">
                      {formatARS(valorCuota)}
                      <span className="text-xs font-normal text-auto-muted"> /mes</span>
                    </div>
                  )}
                  {plan.tna != null || plan.tasaNominal != null ? (
                    <div className="mt-1 text-[11px] text-auto-muted">
                      TNA: {plan.tna ?? plan.tasaNominal}%
                    </div>
                  ) : null}
                  {plan.cft != null || plan.costoFinancieroTotal != null ? (
                    <div className="text-[11px] text-auto-muted">
                      CFT: {plan.cft ?? plan.costoFinancieroTotal}%
                    </div>
                  ) : null}
                  {!hasKnownFields && (
                    <pre className="whitespace-pre-wrap text-xs text-auto-muted">
                      {JSON.stringify(plan, null, 2)}
                    </pre>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
