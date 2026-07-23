import type {
  CashMovement,
  Company,
  CloseValidation,
  DailySummaryRow,
  LedgerRow,
  LedgerTotals,
  MovementCategory,
  RcvDocument,
} from "./types";

export function buildLedger(movements: CashMovement[]): LedgerRow[] {
  return movements
    // El borrador legal solo contiene flujos con clasificación confirmada.
    // La cartola pendiente queda visible en Conciliación, no se transforma en
    // un asiento de libro por el solo hecho de haber sido importada.
    .filter((movement) => !movement.excluded && (movement.operationType === 0 || movement.reconciled))
    .sort((a, b) =>
      a.occurredOn.localeCompare(b.occurredOn) || a.createdOrder.localeCompare(b.createdOrder),
    )
    .map((movement, index) => ({
      correlation: index + 1,
      operationType: movement.operationType,
      documentNumber: movement.documentNumber ?? movement.reference ?? "",
      documentType: movement.documentType ?? sourceDocumentLabel(movement),
      issuerRut: movement.issuerRut ?? "",
      occurredOn: movement.occurredOn,
      description: movement.description,
      flowAmount: Math.abs(movement.amount),
      taxableAmount: Math.abs(movement.taxableAmount),
      movementId: movement.id,
    }));
}

export function buildRcvLedger(company: Company, documents: RcvDocument[]): LedgerRow[] {
  return documents
    .sort((a, b) => a.issuedOn.localeCompare(b.issuedOn) || a.folio.localeCompare(b.folio))
    .map((document, index) => ({
      correlation: index + 1,
      operationType: document.direction === "sale" ? 1 : 2,
      documentNumber: document.folio,
      documentType: document.documentType,
      issuerRut: document.direction === "sale" ? company.rut : document.counterpartyRut,
      occurredOn: document.issuedOn,
      description: `${document.direction === "sale" ? "Venta" : "Compra"} RCV · ${document.counterpartyName}`,
      flowAmount: document.totalAmount,
      taxableAmount: document.netAmount,
      movementId: document.id,
    }));
}

/** Libro oficial: documentos RCV más movimientos manuales clasificados. */
export function buildCompleteLedger(
  company: Company,
  documents: RcvDocument[],
  movements: CashMovement[],
): LedgerRow[] {
  const rcvRows = buildRcvLedger(company, documents);
  const manualRows = buildLedger(movements);
  return [...rcvRows, ...manualRows]
    .sort((a, b) =>
      a.occurredOn.localeCompare(b.occurredOn)
      || a.documentNumber.localeCompare(b.documentNumber)
      || a.movementId.localeCompare(b.movementId),
    )
    .map((row, index) => ({ ...row, correlation: index + 1 }));
}

declare module "./types" {
  interface CashMovement {
    createdOrder: string;
  }
}

function sourceDocumentLabel(movement: CashMovement) {
  if (movement.source === "bank") return "Cartola bancaria";
  if (movement.source === "cash") return "Comprobante de caja";
  return "Comprobante interno";
}

export function calculateTotals(rows: LedgerRow[]): LedgerTotals {
  // operationType 0 es el saldo inicial traspasado (ver Workspace): se
  // muestra como primera línea del libro pero nunca es "ingreso" del
  // período — sumarlo aquí infla C10 y duplica el saldo en closePeriod(),
  // que ya suma el saldo inicial por su cuenta para sacar C12/cierre.
  const flowRows = rows.filter((row) => row.operationType !== 0);
  const incomeFlow = sum(flowRows.filter((row) => row.operationType !== 2), "flowAmount");
  const expenseFlow = sum(flowRows.filter((row) => row.operationType === 2), "flowAmount");
  const taxableIncome = sum(flowRows.filter((row) => row.operationType === 1), "taxableAmount");
  const taxableExpense = sum(flowRows.filter((row) => row.operationType === 2), "taxableAmount");
  return {
    incomeFlow,
    expenseFlow,
    cashBalance: incomeFlow - expenseFlow,
    taxableIncome,
    taxableExpense,
    netResult: taxableIncome - taxableExpense,
  };
}

function sum<T>(rows: T[], key: keyof T) {
  return rows.reduce((total, row) => total + Number(row[key] ?? 0), 0);
}

export function buildDailySummary(rows: LedgerRow[]): DailySummaryRow[] {
  const grouped = new Map<string, DailySummaryRow>();
  for (const row of rows) {
    const key = `${row.occurredOn}:${row.operationType}`;
    const current = grouped.get(key) ?? {
      date: row.occurredOn,
      operationType: row.operationType,
      totalFlow: 0,
      taxableAmount: 0,
    };
    current.totalFlow += row.flowAmount;
    current.taxableAmount += row.taxableAmount;
    grouped.set(key, current);
  }
  return [...grouped.values()].sort(
    (a, b) => a.date.localeCompare(b.date) || a.operationType - b.operationType,
  );
}

export function validateClose(
  movements: CashMovement[],
  documents: RcvDocument[],
  openingBalanceConfirmed: boolean,
): CloseValidation {
  const blockers: CloseValidation["blockers"] = [];
  const unclassified = movements.filter(
    (movement) => !movement.excluded && !movement.category && movement.operationType !== 0,
  );
  const unreconciled = movements.filter(
    (movement) => !movement.excluded && !movement.reconciled && movement.operationType !== 0,
  );
  const partialDocuments = documents.filter((document) => document.status === "partial");
  if (!openingBalanceConfirmed) blockers.push({ code: "opening", label: "Saldo inicial sin confirmar" });
  if (unclassified.length)
    blockers.push({ code: "unclassified", label: "Movimientos sin clasificar", count: unclassified.length });
  if (unreconciled.length)
    blockers.push({ code: "unreconciled", label: "Movimientos sin conciliar", count: unreconciled.length });
  if (partialDocuments.length)
    blockers.push({ code: "partial", label: "Documentos con pago parcial", count: partialDocuments.length });
  return { canClose: blockers.length === 0, blockers };
}

export function suggestedTaxableAmount(movement: CashMovement, document?: RcvDocument) {
  if (["loan", "capital_contribution", "owner_withdrawal", "internal_transfer"].includes(movement.category ?? "")) {
    return 0;
  }
  if (!document) return Math.abs(movement.amount);
  const paidRatio = Math.min(1, Math.abs(movement.amount) / Math.max(1, document.totalAmount));
  return Math.round((document.netAmount + document.exemptAmount) * paidRatio);
}

/** Reglas de base imponible para el ingreso manual, según el contador (ver INGRESO_MANUAL.pdf). */
export type ManualDocumentKind =
  | "factura_afecta"
  | "factura_exenta"
  | "factura_compra"
  | "boleta_honorarios"
  | "boleta_afecta"
  | "boleta_exenta"
  | "nota_credito"
  | "nota_debito"
  | "sin_documento";

export const manualDocumentKindLabels: Record<ManualDocumentKind, string> = {
  factura_afecta: "Factura afecta",
  factura_exenta: "Factura exenta",
  factura_compra: "Factura de compra",
  boleta_honorarios: "Boleta de honorarios",
  boleta_afecta: "Boleta afecta",
  boleta_exenta: "Boleta exenta",
  nota_credito: "Nota de crédito",
  nota_debito: "Nota de débito",
  sin_documento: "Sin documento tributario",
};

/**
 * Solo "purchase" y "sale" llevan documento tributario; el resto (pago de
 * impuestos, remuneraciones, préstamos, aportes, retiros, transferencias
 * internas, devoluciones, ajustes) nunca genera base imponible.
 */
export function manualTaxableAmount(
  category: MovementCategory,
  documentKind: ManualDocumentKind | "",
  amount: number,
  affectsIva: boolean,
): number {
  if (category !== "purchase" && category !== "sale") return 0;
  switch (documentKind) {
    case "factura_afecta":
    case "factura_compra":
    case "boleta_afecta":
    case "nota_credito":
    case "nota_debito":
      return Math.round(amount / 1.19);
    case "factura_exenta":
    case "boleta_exenta":
    case "boleta_honorarios":
      // Exentas: la base es el propio total. Honorarios: la retención es
      // Impuesto a la Renta, no IVA, así que el bruto también es la base.
      return amount;
    case "sin_documento":
      // Compra sin documento (menor, sin boleta): no genera base.
      // Venta manual excepcional: depende de si el monto declarado afecta IVA.
      if (category === "purchase") return 0;
      return affectsIva ? Math.round(amount / 1.19) : amount;
    default:
      return 0;
  }
}
