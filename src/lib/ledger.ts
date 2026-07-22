import type {
  CashMovement,
  Company,
  CloseValidation,
  DailySummaryRow,
  LedgerRow,
  LedgerTotals,
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
  const incomeFlow = sum(rows.filter((row) => row.operationType !== 2), "flowAmount");
  const expenseFlow = sum(rows.filter((row) => row.operationType === 2), "flowAmount");
  const taxableIncome = sum(rows.filter((row) => row.operationType === 1), "taxableAmount");
  const taxableExpense = sum(rows.filter((row) => row.operationType === 2), "taxableAmount");
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
