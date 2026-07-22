import Papa from "papaparse";
import type { RcvDocument } from "./types";

const documentTypes: Record<number, string> = {
  33: "Factura electrónica",
  34: "Factura exenta electrónica",
  39: "Boleta electrónica",
  41: "Boleta exenta electrónica",
  46: "Factura de compra",
  48: "Comprobantes de pago electrónico",
  52: "Guía de despacho",
  56: "Nota de débito",
  61: "Nota de crédito",
};

type SiiRow = Record<string, string>;

export type SiiRcvFile = {
  direction: "purchase" | "sale";
  documents: Omit<RcvDocument, "id" | "companyId" | "snapshotId" | "allocatedAmount" | "status">[];
  filename: string;
  skipped: number;
};

export async function parseSiiRcvFile(file: File, period: string): Promise<SiiRcvFile> {
  const text = await file.text();
  const parsed = Papa.parse<SiiRow>(text, {
    header: true,
    skipEmptyLines: true,
    delimiter: ";",
    transformHeader: (header) => header.trim(),
  });
  if (parsed.errors.length)
    throw new Error(`El CSV ${file.name} no se pudo leer como archivo SII.`);
  const rows = parsed.data.filter((row) => Object.values(row).some(Boolean));
  if (!rows.length) throw new Error(`${file.name} no contiene documentos.`);
  const headers = Object.keys(rows[0]);
  const direction = headers.includes("RUT Proveedor")
    ? "purchase"
    : headers.includes("Rut cliente")
      ? "sale"
      : null;
  if (!direction)
    throw new Error(`${file.name} no corresponde al CSV detallado de Compras o Ventas del SII.`);
  const required = ["Tipo Doc", "Folio", "Fecha Docto", "Monto Neto"];
  const missing = required.filter((header) => !headers.includes(header));
  if (missing.length)
    throw new Error(`${file.name} no trae las columnas SII requeridas: ${missing.join(", ")}.`);
  const documents = rows
    .map((row, index) => normalizeRow(row, direction, period, index))
    .filter((document): document is SiiRcvFile["documents"][number] => document !== null);
  if (!documents.length) throw new Error(`${file.name} no contiene documentos con monto total válido.`);
  return { direction, documents, filename: file.name, skipped: rows.length - documents.length };
}

function normalizeRow(
  row: SiiRow,
  direction: "purchase" | "sale",
  selectedPeriod: string,
  index: number,
): SiiRcvFile["documents"][number] | null {
  const documentCode = amount(row["Tipo Doc"]);
  const issuedOn = siiDate(row["Fecha Docto"]);
  const totalAmount = amount(row[direction === "purchase" ? "Monto Total" : "Monto total"]);
  if (!documentCode || !row.Folio || !issuedOn)
    throw new Error(`Fila ${index + 2}: falta tipo, folio o fecha válida.`);
  // SII puede incluir registros informativos sin monto. No son una operación
  // de caja y se omiten para cumplir la validación C8 > 0.
  if (totalAmount <= 0) return null;
  return {
    // El CSV mensual puede contener documentos emitidos el mes anterior que
    // fueron recibidos o contabilizados en este RCV. El período es el del
    // registro importado; C6 conserva siempre la fecha real del documento.
    period: selectedPeriod,
    direction,
    documentCode,
    documentType: documentTypes[documentCode] ?? `Documento ${documentCode}`,
    folio: row.Folio.trim(),
    counterpartyRut: (row[direction === "purchase" ? "RUT Proveedor" : "Rut cliente"] ?? "").trim(),
    counterpartyName: (row["Razon Social"] ?? "Sin razón social").trim(),
    issuedOn,
    exemptAmount: amount(row["Monto Exento"]),
    netAmount: amount(row["Monto Neto"]),
    vatAmount: amount(row[direction === "purchase" ? "Monto IVA Recuperable" : "Monto IVA"]),
    totalAmount,
  };
}

function amount(value: string | undefined) {
  const parsed = Number(String(value ?? "0").replace(/[^0-9-]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function siiDate(value: string | undefined) {
  const match = String(value ?? "").match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  return match ? `${match[3]}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}` : "";
}
