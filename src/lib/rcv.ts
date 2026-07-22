import type { RcvDocument } from "./types";

type RawRcvRow = Record<string, unknown> & { tipo_doc?: string; tipo_doc_nombre?: string };

export function normalizeRcvDocuments(
  rows: RawRcvRow[],
  options: { companyId: string; period: string; direction: "purchase" | "sale"; snapshotId: string },
): RcvDocument[] {
  return rows.map((row, index) => {
    const documentCode = number(row.tipo_doc ?? row.dcvCodigoDoc ?? row.detTipoDoc);
    const totalAmount = number(row.detMntTotal ?? row.rsmnMntTotal ?? row.montoTotal);
    const netAmount = number(row.detMntNeto ?? row.rsmnMntNeto ?? row.montoNeto);
    const vatAmount = number(row.detMntIVA ?? row.rsmnMntIVA ?? row.impuestoIva);
    const exemptAmount = number(row.detMntExe ?? row.detMntExento ?? row.rsmnMntExe ?? row.montoExento);
    const rutBody = String(row.detRutDoc ?? row.rutProveedor ?? row.rutCliente ?? "");
    const dv = String(row.detDvDoc ?? "");
    const counterpartyRut = dv && !rutBody.includes("-") ? `${rutBody}-${dv}` : rutBody;
    return {
      id: `${options.snapshotId}:${documentCode}:${String(row.detNroDoc ?? index)}`,
      companyId: options.companyId,
      period: options.period,
      direction: options.direction,
      documentType: String(row.tipo_doc_nombre ?? row.dcvNombreTipoDoc ?? row.dcvNombreDoc ?? `Documento ${documentCode}`),
      documentCode,
      folio: String(row.detNroDoc ?? row.numeroDocumento ?? ""),
      counterpartyRut,
      counterpartyName: String(row.detRznSoc ?? row.detRznSocEmisor ?? row.razonSocial ?? "Sin razón social"),
      issuedOn: normalizeSiiDate(String(row.detFchDoc ?? row.fechaDocumento ?? "")),
      exemptAmount,
      netAmount,
      vatAmount,
      totalAmount,
      allocatedAmount: 0,
      status: "pending",
      snapshotId: options.snapshotId,
    };
  });
}

function number(value: unknown) {
  const parsed = Number(String(value ?? 0).replace(/[^0-9-]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeSiiDate(value: string) {
  if (/^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  const match = value.match(/(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})/);
  return match ? `${match[3]}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}` : value;
}
