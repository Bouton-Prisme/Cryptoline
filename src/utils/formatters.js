export function formatMoney(value) {
  const normalized = Number(value ?? 0);
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(Number.isFinite(normalized) ? normalized : 0);
}

export function formatPct(value) {
  const number = Number(value) || 0;
  return `${number >= 0 ? "+" : ""}${number.toFixed(2)}%`;
}

export function formatCompact(value, options = {}) {
  if (!Number.isFinite(value)) return "-";
  return new Intl.NumberFormat("fr-FR", {
    notation: "compact",
    maximumFractionDigits: 2,
    ...options,
  }).format(value);
}
