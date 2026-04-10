export type FinanceInput = {
  price: number;
  downPayment: number;
  months: number;
  apr: number; // annual percentage rate, e.g. 0.6 for 60%
};

export type FinanceResult = FinanceInput & {
  principal: number;
  monthly: number;
};

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

export function getFinanceApr(): number {
  // Priority: env FINANCE_APR (decimal) → default 0.75 (75% anual)
  const envApr = Number((process.env as any).FINANCE_APR);
  if (Number.isFinite(envApr) && envApr > 0 && envApr < 10) return envApr;
  return 0.75;
}

/** Standard amortized monthly payment. */
export function simulateFinancing(input: FinanceInput): FinanceResult {
  const price = clamp(input.price, 0, 10_000_000_000);
  const downPayment = clamp(input.downPayment, 0, price);
  const months = clamp(Math.round(input.months), 1, 240);
  const apr = clamp(input.apr, 0.0001, 10);

  const principal = Math.max(0, price - downPayment);
  const r = apr / 12;
  const pow = Math.pow(1 + r, months);
  const monthly = principal === 0 ? 0 : (principal * r * pow) / (pow - 1);

  return {
    price,
    downPayment,
    months,
    apr,
    principal,
    monthly: Number.isFinite(monthly) ? monthly : 0
  };
}

export function formatArs(n: number): string {
  try {
    return n.toLocaleString('es-AR', { maximumFractionDigits: 0 });
  } catch {
    return String(Math.round(n));
  }
}
