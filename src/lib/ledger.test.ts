import { describe, expect, it } from "vitest";
import { buildDailySummary, buildLedger, calculateTotals, suggestedTaxableAmount, validateClose } from "./ledger";
import type { CashMovement, RcvDocument } from "./types";

const movements: CashMovement[] = [
  { id: "opening", companyId: "c", accountId: "a", period: "2026-06", operationType: 0, occurredOn: "2026-06-01", description: "Saldo inicial", amount: 1000, taxableAmount: 0, category: "other", source: "manual", reconciled: true, createdOrder: "0" },
  { id: "income", companyId: "c", accountId: "a", period: "2026-06", operationType: 1, occurredOn: "2026-06-03", description: "Cobro", amount: 1190, taxableAmount: 1000, category: "sale", source: "bank", reconciled: true, createdOrder: "1" },
  { id: "expense", companyId: "c", accountId: "a", period: "2026-06", operationType: 2, occurredOn: "2026-06-03", description: "Pago", amount: -595, taxableAmount: 500, category: "purchase", source: "bank", reconciled: true, createdOrder: "2" },
];

describe("libro de caja", () => {
  it("ordena cronológicamente, enumera correlativos y calcula C10-C15", () => {
    const ledger = buildLedger([...movements].reverse());
    expect(ledger.map((row) => row.correlation)).toEqual([1, 2, 3]);
    expect(calculateTotals(ledger)).toEqual({ incomeFlow: 2190, expenseFlow: 595, cashBalance: 1595, taxableIncome: 1000, taxableExpense: 500, netResult: 500 });
  });

  it("resume por fecha y tipo de operación sin mezclar ingresos y egresos", () => {
    const rows = buildDailySummary(buildLedger(movements));
    expect(rows).toHaveLength(3);
    expect(rows.find((row) => row.operationType === 1)?.totalFlow).toBe(1190);
  });

  it("exige clasificación, conciliación, saldo y revisión de pagos parciales", () => {
    const dirty = { ...movements[1], reconciled: false, category: undefined };
    const doc = { status: "partial" } as RcvDocument;
    const validation = validateClose([dirty], [doc], false);
    expect(validation.canClose).toBe(false);
    expect(validation.blockers.map((item) => item.code)).toEqual(["opening", "unclassified", "unreconciled", "partial"]);
  });

  it("excluye IVA proporcionalmente y deja préstamos fuera de la base", () => {
    const document = { totalAmount: 1190, netAmount: 1000, exemptAmount: 0 } as RcvDocument;
    expect(suggestedTaxableAmount({ ...movements[1], amount: 595 }, document)).toBe(500);
    expect(suggestedTaxableAmount({ ...movements[1], category: "loan" }, document)).toBe(0);
  });
});

