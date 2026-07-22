import type { CashMovement, Company, RcvDocument } from "./types";

export const demoCompanies: Company[] = [
  {
    id: "empresa-1",
    rut: "77.956.294-8",
    name: "Comercial Lago Sur SpA",
    regime: "transparent",
    status: "active",
    lastClosedPeriod: "2026-05",
    currentPeriod: "2026-06",
    accounts: [
      { id: "banco-1", companyId: "empresa-1", name: "Cuenta corriente principal", kind: "bank", bank: "Banco de Chile", numberLast4: "4831", openingBalance: 4382500 },
      { id: "banco-2", companyId: "empresa-1", name: "Cuenta pagos", kind: "bank", bank: "Santander", numberLast4: "0914", openingBalance: 820000 },
      { id: "caja-1", companyId: "empresa-1", name: "Caja oficina", kind: "cash", openingBalance: 185000 },
    ],
  },
  {
    id: "empresa-2",
    rut: "76.443.210-K",
    name: "Servicios Cordillera Ltda.",
    regime: "general_simplified",
    status: "active",
    lastClosedPeriod: "2026-04",
    currentPeriod: "2026-05",
    accounts: [{ id: "banco-3", companyId: "empresa-2", name: "Cuenta empresa", kind: "bank", bank: "BancoEstado", numberLast4: "2270", openingBalance: 1968000 }],
  },
  {
    id: "empresa-3",
    rut: "78.120.554-2",
    name: "Arquitectura Norte SpA",
    regime: "transparent",
    status: "active",
    currentPeriod: "2026-06",
    accounts: [{ id: "banco-4", companyId: "empresa-3", name: "Cuenta corriente", kind: "bank", bank: "BCI", numberLast4: "6628", openingBalance: 0 }],
  },
];

export const demoDocuments: RcvDocument[] = [
  { id: "doc-v-1", companyId: "empresa-1", period: "2026-06", direction: "sale", documentType: "Factura electrónica", documentCode: 33, folio: "1842", counterpartyRut: "76.112.880-7", counterpartyName: "Distribuidora Austral Ltda.", issuedOn: "2026-06-03", exemptAmount: 0, netAmount: 840000, vatAmount: 159600, totalAmount: 999600, allocatedAmount: 999600, status: "settled", snapshotId: "snap-1" },
  { id: "doc-v-2", companyId: "empresa-1", period: "2026-06", direction: "sale", documentType: "Factura electrónica", documentCode: 33, folio: "1843", counterpartyRut: "77.098.121-5", counterpartyName: "Constructora El Arrayán SpA", issuedOn: "2026-06-07", exemptAmount: 0, netAmount: 1250000, vatAmount: 237500, totalAmount: 1487500, allocatedAmount: 0, status: "pending", snapshotId: "snap-1" },
  { id: "doc-v-3", companyId: "empresa-1", period: "2026-06", direction: "sale", documentType: "Factura exenta electrónica", documentCode: 34, folio: "311", counterpartyRut: "65.031.441-9", counterpartyName: "Fundación Bosque Vivo", issuedOn: "2026-06-10", exemptAmount: 480000, netAmount: 0, vatAmount: 0, totalAmount: 480000, allocatedAmount: 240000, status: "partial", snapshotId: "snap-1" },
  { id: "doc-c-1", companyId: "empresa-1", period: "2026-06", direction: "purchase", documentType: "Factura electrónica", documentCode: 33, folio: "89201", counterpartyRut: "96.556.940-5", counterpartyName: "Equipamiento Oficina S.A.", issuedOn: "2026-06-04", exemptAmount: 0, netAmount: 310000, vatAmount: 58900, totalAmount: 368900, allocatedAmount: 368900, status: "settled", snapshotId: "snap-1" },
  { id: "doc-c-2", companyId: "empresa-1", period: "2026-06", direction: "purchase", documentType: "Factura electrónica", documentCode: 33, folio: "5508", counterpartyRut: "77.400.221-3", counterpartyName: "Transportes San Pedro Ltda.", issuedOn: "2026-06-09", exemptAmount: 0, netAmount: 220000, vatAmount: 41800, totalAmount: 261800, allocatedAmount: 0, status: "pending", snapshotId: "snap-1" },
  { id: "doc-c-3", companyId: "empresa-1", period: "2026-05", direction: "purchase", documentType: "Factura electrónica", documentCode: 33, folio: "9033", counterpartyRut: "76.919.880-K", counterpartyName: "Publicidad Central SpA", issuedOn: "2026-05-27", exemptAmount: 0, netAmount: 175000, vatAmount: 33250, totalAmount: 208250, allocatedAmount: 0, status: "pending", snapshotId: "snap-0" },
];

export const demoMovements: CashMovement[] = [
  { id: "mov-0", companyId: "empresa-1", accountId: "banco-1", period: "2026-06", operationType: 0, occurredOn: "2026-06-01", description: "Saldo inicial del período", amount: 4382500, taxableAmount: 0, category: "other", source: "manual", reconciled: true, createdOrder: "00" },
  { id: "mov-1", companyId: "empresa-1", accountId: "banco-1", period: "2026-06", operationType: 1, occurredOn: "2026-06-06", description: "Transferencia Distribuidora Austral", reference: "TRX-927144", amount: 999600, taxableAmount: 840000, category: "sale", source: "bank", documentNumber: "1842", documentType: "Factura electrónica", issuerRut: "77.956.294-8", reconciled: true, createdOrder: "01" },
  { id: "mov-2", companyId: "empresa-1", accountId: "banco-1", period: "2026-06", operationType: 2, occurredOn: "2026-06-08", description: "Pago Equipamiento Oficina", reference: "TEF-004182", amount: -368900, taxableAmount: 310000, category: "purchase", source: "bank", documentNumber: "89201", documentType: "Factura electrónica", issuerRut: "96.556.940-5", reconciled: true, createdOrder: "02" },
  { id: "mov-3", companyId: "empresa-1", accountId: "banco-1", period: "2026-06", operationType: 1, occurredOn: "2026-06-12", description: "Abono Fundación Bosque Vivo", reference: "TRX-114201", amount: 240000, taxableAmount: 240000, category: "sale", source: "bank", documentNumber: "311", documentType: "Factura exenta electrónica", issuerRut: "77.956.294-8", reconciled: true, createdOrder: "03" },
  { id: "mov-4", companyId: "empresa-1", accountId: "banco-1", period: "2026-06", operationType: 2, occurredOn: "2026-06-13", description: "Transferencia Transportes San Pedro", reference: "TEF-005991", amount: -261800, taxableAmount: 0, source: "bank", reconciled: false, createdOrder: "04" },
  { id: "mov-5", companyId: "empresa-1", accountId: "banco-2", period: "2026-06", operationType: 2, occurredOn: "2026-06-15", description: "Pago PPM mayo", reference: "SII-455120", amount: -118000, taxableAmount: 0, category: "tax", source: "bank", reconciled: true, createdOrder: "05" },
  { id: "mov-6", companyId: "empresa-1", accountId: "banco-1", period: "2026-06", operationType: 1, occurredOn: "2026-06-18", description: "Préstamo banco", reference: "CRED-8841", amount: 2500000, taxableAmount: 0, category: "loan", source: "bank", reconciled: true, createdOrder: "06" },
];

