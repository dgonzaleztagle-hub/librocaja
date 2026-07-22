export const clp = new Intl.NumberFormat("es-CL", {
  style: "currency",
  currency: "CLP",
  maximumFractionDigits: 0,
});

export const integer = new Intl.NumberFormat("es-CL", { maximumFractionDigits: 0 });

export function formatRut(value: string) {
  const clean = value.replace(/[^0-9kK]/g, "").toUpperCase();
  if (clean.length < 2) return value;
  const body = clean.slice(0, -1);
  const dv = clean.slice(-1);
  return `${integer.format(Number(body))}-${dv}`;
}

export function normalizeRut(value: string) {
  return value.replace(/[^0-9kK]/g, "").toUpperCase();
}

export function formatDate(value: string) {
  if (!value) return "—";
  const [year, month, day] = value.slice(0, 10).split("-");
  return `${day}/${month}/${year}`;
}

export function periodLabel(period: string) {
  const [year, month] = period.split("-").map(Number);
  return new Intl.DateTimeFormat("es-CL", { month: "long", year: "numeric" }).format(
    new Date(year, month - 1, 1),
  );
}

export function safeFilenamePart(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9_-]/g, "-");
}

