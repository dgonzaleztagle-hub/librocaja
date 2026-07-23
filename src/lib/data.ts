import "server-only";
import { demoCompanies, demoDocuments, demoMovements } from "./demo-data";
import { createClient } from "./supabase/server";
import type { CashMovement, Company, RcvDocument } from "./types";

const isConfigured = () =>
  Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );

function previousPeriodOf(period: string) {
  const [year, month] = period.split("-").map(Number);
  const previous = new Date(year, month - 1 - 1, 1);
  return `${previous.getFullYear()}-${String(previous.getMonth() + 1).padStart(2, "0")}`;
}

export async function listCompanies(): Promise<Company[]> {
  if (!isConfigured()) return demoCompanies;
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("companies")
      .select("*, cash_accounts(*), sii_credentials(company_id)")
      .order("name");
    if (error) throw error;
    return (data ?? []).map((row) => ({
      id: row.id,
      rut: row.rut,
      name: row.name,
      regime: row.regime,
      status: row.active ? "active" : "paused",
      currentPeriod: new Date().toISOString().slice(0, 7),
      hasSiiCredential: Boolean(row.sii_credentials),
      accounts: (row.cash_accounts ?? []).map(
        (account: Record<string, unknown>) => ({
          id: String(account.id),
          companyId: row.id,
          name: String(account.name),
          kind: account.kind as "bank" | "cash",
          bank: account.bank ? String(account.bank) : undefined,
          numberLast4: account.number_last4
            ? String(account.number_last4)
            : undefined,
          openingBalance: Number(account.opening_balance ?? 0),
        }),
      ),
    }));
  } catch (error) {
    console.error("No se pudo cargar la cartera desde Supabase", error);
    return demoCompanies;
  }
}

export async function getWorkspace(
  companyId: string,
  period: string,
): Promise<{
  company: Company;
  movements: CashMovement[];
  documents: RcvDocument[];
  closure: { closed: boolean; version: number };
  openingBalance: number;
  openingBalanceCarried: boolean;
} | null> {
  if (!isConfigured()) {
    const company = demoCompanies.find((item) => item.id === companyId);
    return company
      ? {
          company,
          movements: demoMovements.filter(
            (item) => item.companyId === companyId && item.period === period,
          ),
          documents: demoDocuments.filter(
            (item) => item.companyId === companyId,
          ),
          closure: { closed: false, version: 0 },
          openingBalance: company.accounts.reduce(
            (sum, account) => sum + account.openingBalance,
            0,
          ),
          openingBalanceCarried: false,
        }
      : null;
  }
  const supabase = await createClient();
  const [
    { data: companyRow },
    { data: movementRows },
    { data: documentRows },
    { data: closureRow },
    { data: previousClosureRow },
  ] = await Promise.all([
    supabase
      .from("companies")
      .select("*, cash_accounts(*), sii_credentials(company_id)")
      .eq("id", companyId)
      .single(),
    supabase
      .from("cash_movements")
      .select("*")
      .eq("company_id", companyId)
      .eq("period", period)
      .order("occurred_on"),
    supabase
      .from("rcv_documents")
      .select("*")
      .eq("company_id", companyId)
      .eq("period", period)
      .order("issued_on", { ascending: false })
      .limit(500),
    supabase
      .from("period_closures")
      .select("status,version")
      .eq("company_id", companyId)
      .eq("period", period)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle(),
    // El saldo inicial del mes es el saldo final del cierre anterior: nunca
    // se vuelve a pedir a mano. Solo el primer período usa el saldo
    // configurado en las cuentas. No se filtra por status="closed": si el
    // período anterior está reabierto ("in_review") su closing_balance
    // sigue siendo el último valor válido hasta que se vuelva a cerrar.
    supabase
      .from("period_closures")
      .select("closing_balance")
      .eq("company_id", companyId)
      .eq("period", previousPeriodOf(period))
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  if (!companyRow) return null;
  const company: Company = {
    id: companyRow.id,
    rut: companyRow.rut,
    name: companyRow.name,
    regime: companyRow.regime,
    status: companyRow.active ? "active" : "paused",
    currentPeriod: period,
    hasSiiCredential: Boolean(companyRow.sii_credentials),
    accounts: (companyRow.cash_accounts ?? []).map(
      (account: Record<string, unknown>) => ({
        id: String(account.id),
        companyId,
        name: String(account.name),
        kind: account.kind as "bank" | "cash",
        bank: account.bank ? String(account.bank) : undefined,
        numberLast4: account.number_last4
          ? String(account.number_last4)
          : undefined,
        openingBalance: Number(account.opening_balance ?? 0),
      }),
    ),
  };
  const movements: CashMovement[] = (movementRows ?? []).map((row) => ({
    id: row.id,
    companyId,
    accountId: row.account_id,
    period: row.period,
    operationType: row.operation_type,
    occurredOn: row.occurred_on,
    description: row.description,
    reference: row.reference ?? undefined,
    amount: Number(row.amount),
    taxableAmount: Number(row.taxable_amount),
    category: row.category ?? undefined,
    source: row.source,
    documentNumber: row.document_number ?? undefined,
    documentType: row.document_type ?? undefined,
    issuerRut: row.issuer_rut ?? undefined,
    reconciled: row.reconciled,
    excluded: row.excluded,
    counterpartMovementId: row.counterpart_movement_id ?? undefined,
    createdOrder: row.created_at,
  }));
  const documents: RcvDocument[] = (documentRows ?? []).map((row) => ({
    id: row.id,
    companyId,
    period: row.period,
    direction: row.direction,
    documentType: row.document_type,
    documentCode: row.document_code,
    folio: row.folio,
    counterpartyRut: row.counterparty_rut ?? "",
    counterpartyName: row.counterparty_name ?? "",
    issuedOn: row.issued_on,
    exemptAmount: Number(row.exempt_amount),
    netAmount: Number(row.net_amount),
    vatAmount: Number(row.vat_amount),
    totalAmount: Number(row.total_amount),
    allocatedAmount: 0,
    status: row.status,
    snapshotId: row.snapshot_id,
  }));
  const openingBalanceCarried = previousClosureRow != null;
  const openingBalance = openingBalanceCarried
    ? Number(previousClosureRow.closing_balance)
    : company.accounts.reduce((sum, account) => sum + account.openingBalance, 0);
  return {
    company,
    movements,
    documents,
    closure: {
      closed: closureRow?.status === "closed",
      version: Number(closureRow?.version ?? 0),
    },
    openingBalance,
    openingBalanceCarried,
  };
}
