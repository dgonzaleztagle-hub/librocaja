export type TaxRegime = "transparent" | "general_simplified";
export type PeriodStatus = "draft" | "in_review" | "closed";
export type OperationType = 0 | 1 | 2;
export type SourceType = "rcv" | "bank" | "cash" | "manual";
export type MovementCategory =
  | "sale"
  | "purchase"
  | "loan"
  | "capital_contribution"
  | "owner_withdrawal"
  | "tax"
  | "payroll"
  | "internal_transfer"
  | "refund"
  | "other";

export interface Company {
  id: string;
  rut: string;
  name: string;
  regime: TaxRegime;
  status: "active" | "paused";
  lastClosedPeriod?: string;
  currentPeriod: string;
  accounts: CashAccount[];
}

export interface CashAccount {
  id: string;
  companyId: string;
  name: string;
  kind: "bank" | "cash";
  bank?: string;
  numberLast4?: string;
  openingBalance: number;
}

export interface RcvDocument {
  id: string;
  companyId: string;
  period: string;
  direction: "purchase" | "sale";
  documentType: string;
  documentCode: number;
  folio: string;
  counterpartyRut: string;
  counterpartyName: string;
  issuedOn: string;
  exemptAmount: number;
  netAmount: number;
  vatAmount: number;
  totalAmount: number;
  allocatedAmount: number;
  status: "pending" | "partial" | "settled" | "excluded";
  snapshotId: string;
}

export interface CashMovement {
  id: string;
  companyId: string;
  accountId: string;
  period: string;
  operationType: OperationType;
  occurredOn: string;
  description: string;
  reference?: string;
  amount: number;
  taxableAmount: number;
  category?: MovementCategory;
  source: SourceType;
  documentNumber?: string;
  documentType?: string;
  issuerRut?: string;
  reconciled: boolean;
  excluded?: boolean;
  counterpartMovementId?: string;
}

export interface Allocation {
  id: string;
  movementId: string;
  documentId: string;
  amount: number;
}

export interface LedgerRow {
  correlation: number;
  operationType: OperationType;
  documentNumber: string;
  documentType: string;
  issuerRut: string;
  occurredOn: string;
  description: string;
  flowAmount: number;
  taxableAmount: number;
  movementId: string;
}

export interface LedgerTotals {
  incomeFlow: number;
  expenseFlow: number;
  cashBalance: number;
  taxableIncome: number;
  taxableExpense: number;
  netResult: number;
}

export interface DailySummaryRow {
  date: string;
  operationType: OperationType;
  totalFlow: number;
  taxableAmount: number;
}

export interface CloseValidation {
  canClose: boolean;
  blockers: { code: string; label: string; count?: number }[];
}

