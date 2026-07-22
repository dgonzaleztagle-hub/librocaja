import Papa from "papaparse";
import ExcelJS from "exceljs";
import { normalizeRut } from "./format";

export interface ImportMapping {
  date: string;
  description: string;
  amount?: string;
  debit?: string;
  credit?: string;
  reference?: string;
  rut?: string;
  dateFormat?: "dmy" | "ymd" | "excel";
}

export interface ParsedBankRow {
  rowNumber: number;
  date: string;
  description: string;
  amount: number;
  reference: string;
  counterpartyRut: string;
  fingerprint: string;
}

export interface TabularFile {
  sheetNames: string[];
  selectedSheet: string;
  headers: string[];
  rows: Record<string, unknown>[];
}

export async function readTabularFile(file: File, sheet?: string): Promise<TabularFile> {
  const extension = file.name.split(".").pop()?.toLowerCase();
  if (extension === "csv" || extension === "txt") {
    const text = await file.text();
    const parsed = Papa.parse<Record<string, unknown>>(text, {
      header: true,
      skipEmptyLines: "greedy",
      dynamicTyping: false,
      transformHeader: (header) => header.trim(),
    });
    if (parsed.errors.length && !parsed.data.length) throw new Error(parsed.errors[0].message);
    const rows = parsed.data;
    return { sheetNames: ["CSV"], selectedSheet: "CSV", headers: Object.keys(rows[0] ?? {}), rows };
  }
  const buffer = await file.arrayBuffer();
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheetNames = workbook.worksheets.map((worksheet) => worksheet.name);
  const selectedSheet = sheet && sheetNames.includes(sheet) ? sheet : sheetNames[0];
  const worksheet = workbook.getWorksheet(selectedSheet);
  if (!worksheet) throw new Error("El archivo no contiene una hoja legible");
  const headers = worksheet.getRow(1).values instanceof Array
    ? (worksheet.getRow(1).values as unknown[]).slice(1).map((value) => String(value ?? "").trim())
    : [];
  const rows: Record<string, unknown>[] = [];
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const record: Record<string, unknown> = {};
    headers.forEach((header, index) => { record[header] = row.getCell(index + 1).text.trim(); });
    if (Object.values(record).some((value) => String(value).trim())) rows.push(record);
  });
  return { sheetNames, selectedSheet, headers, rows };
}

export function suggestMapping(headers: string[]): ImportMapping {
  const match = (...patterns: RegExp[]) =>
    headers.find((header) => patterns.some((pattern) => pattern.test(normalizeHeader(header)))) ?? "";
  return {
    date: match(/^fecha$/, /fecha.*mov/, /fecha.*cont/),
    description: match(/descripcion/, /detalle/, /glosa/, /concepto/),
    amount: match(/^monto$/, /^importe$/, /monto.*mov/),
    debit: match(/cargo/, /debito/, /egreso/),
    credit: match(/abono/, /credito/, /ingreso/),
    reference: match(/referencia/, /numero.*oper/, /^nro/, /^folio/),
    rut: match(/^rut/, /rut.*contraparte/),
    dateFormat: "dmy",
  };
}

function normalizeHeader(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

export async function mapBankRows(rows: Record<string, unknown>[], mapping: ImportMapping) {
  const output: ParsedBankRow[] = [];
  const errors: string[] = [];
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const date = parseDate(row[mapping.date], mapping.dateFormat);
    const description = String(row[mapping.description] ?? "").trim();
    const amount = mapping.amount
      ? parseMoney(row[mapping.amount])
      : parseMoney(row[mapping.credit ?? ""]) - parseMoney(row[mapping.debit ?? ""]);
    if (!date || !description || !Number.isFinite(amount) || amount === 0) {
      errors.push(`Fila ${index + 2}: falta fecha, descripción o monto válido.`);
      continue;
    }
    const reference = String(row[mapping.reference ?? ""] ?? "").trim();
    const counterpartyRut = normalizeRut(String(row[mapping.rut ?? ""] ?? ""));
    const rawFingerprint = [date, amount, description.toLowerCase(), reference].join("|");
    output.push({
      rowNumber: index + 2,
      date,
      description,
      amount,
      reference,
      counterpartyRut,
      fingerprint: await sha256(rawFingerprint),
    });
  }
  return { rows: output, errors };
}

export function parseMoney(value: unknown) {
  if (typeof value === "number") return Math.round(value);
  let raw = String(value ?? "").trim().replace(/\s/g, "").replace(/\$/g, "");
  if (!raw) return 0;
  const negative = /^\(.*\)$/.test(raw) || raw.startsWith("-");
  raw = raw.replace(/[()-]/g, "");
  if (raw.includes(",") && raw.includes(".")) {
    raw = raw.lastIndexOf(",") > raw.lastIndexOf(".") ? raw.replace(/\./g, "").replace(",", ".") : raw.replace(/,/g, "");
  } else if (/^\d{1,3}(\.\d{3})+$/.test(raw)) raw = raw.replace(/\./g, "");
  else if (/^\d{1,3}(,\d{3})+$/.test(raw)) raw = raw.replace(/,/g, "");
  else raw = raw.replace(",", ".");
  const number = Number(raw);
  return Math.round((negative ? -1 : 1) * number);
}

function parseDate(value: unknown, format: ImportMapping["dateFormat"] = "dmy") {
  if (value instanceof Date && !Number.isNaN(value.valueOf())) return value.toISOString().slice(0, 10);
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  const parts = raw.split(/[\/-]/).map((part) => Number(part));
  if (parts.length !== 3 || parts.some(Number.isNaN)) return "";
  const [a, b, c] = parts;
  const [year, month, day] = format === "ymd" ? [a, b, c] : [c, b, a];
  if (year < 2000 || month < 1 || month > 12 || day < 1 || day > 31) return "";
  return `${year.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}-${day.toString().padStart(2, "0")}`;
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
