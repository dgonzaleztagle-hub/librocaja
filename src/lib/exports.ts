import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import ExcelJS from "exceljs";
import { formatDate, safeFilenamePart } from "./format";
import { buildDailySummary, calculateTotals } from "./ledger";
import type { Company, LedgerRow, RcvDocument } from "./types";

function filename(
  company: Company,
  period: string,
  format: string,
  version: number,
) {
  return `libro-caja_${safeFilenamePart(company.rut)}_${period}_${format}_v${version}`;
}

export async function exportExcel(
  company: Company,
  period: string,
  rows: LedgerRow[],
  documents: RcvDocument[],
  version = 1,
  status = "BORRADOR",
) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Caja Clara";
  workbook.created = new Date();
  const totals = calculateTotals(rows);
  const openingBalance = company.accounts.reduce(
    (sum, account) => sum + account.openingBalance,
    0,
  );
  const closingBalance = openingBalance + totals.cashBalance;
  const cover = [
    ["LIBRO DE CAJA"],
    ["Contribuyente", company.name],
    ["RUT", company.rut],
    ["Período", period],
    [
      "Régimen",
      company.regime === "transparent"
        ? "Pro Pyme Transparente"
        : "Pro Pyme General — contabilidad simplificada",
    ],
    ["Estado", status],
    ["Versión", version],
    ["Generado", new Date().toLocaleString("es-CL")],
    ["Saldo inicial", openingBalance],
    ["Saldo final", closingBalance],
  ];
  const detailed = rows.map((row) => ({
    "N° Correlativo (C1)": row.correlation,
    "Tipo de Operación (C2)": row.operationType,
    "N° Documento (C3)": row.documentNumber,
    "Tipo Documento (C4)": row.documentType,
    "RUT Emisor (C5)": row.issuerRut,
    "Fecha de la Operación (C6)": formatDate(row.occurredOn),
    "Glosa de operación (C7)": row.description,
    "Monto total flujo (C8)": row.flowAmount,
    "Monto afecta base imponible (C9)": row.taxableAmount,
  }));
  const daily = buildDailySummary(rows).map((row) => ({
    "Fecha (C1)": formatDate(row.date),
    "Tipo de Operación (C2)": row.operationType,
    "Resumen monto total diario (C3)": row.totalFlow,
    "Resumen diario base imponible (C4)": row.taxableAmount,
  }));
  const pending = documents
    .filter((doc) => doc.status !== "settled" && doc.status !== "excluded")
    .map((doc) => ({
      Dirección: doc.direction === "sale" ? "Venta" : "Compra",
      Documento: `${doc.documentType} ${doc.folio}`,
      RUT: doc.counterpartyRut,
      Contraparte: doc.counterpartyName,
      Emisión: formatDate(doc.issuedOn),
      Total: doc.totalAmount,
      Asignado: doc.allocatedAmount,
      Pendiente: doc.totalAmount - doc.allocatedAmount,
    }));
  const reconciliation = rows.map((row) => ({
    Correlativo: row.correlation,
    Fecha: formatDate(row.occurredOn),
    Movimiento: row.description,
    Documento: row.documentNumber || "Sin documento RCV",
    "Tipo documental": row.documentType,
    "RUT emisor": row.issuerRut,
    "Monto flujo": row.flowAmount,
    "Monto base": row.taxableAmount,
  }));
  const coverSheet = workbook.addWorksheet("Portada");
  coverSheet.addRows(cover);
  coverSheet.getColumn(1).width = 22;
  coverSheet.getColumn(2).width = 48;
  coverSheet.getCell("A1").font = {
    bold: true,
    size: 18,
    color: { argb: "FF173931" },
  };
  coverSheet.mergeCells("A1:B1");

  const detailSheet = workbook.addWorksheet("Libro detallado", {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  detailSheet.columns = Object.keys(
    detailed[0] ?? { "N° Correlativo (C1)": "" },
  ).map((key) => ({
    header: key,
    key,
    width: key.includes("Glosa")
      ? 38
      : key.includes("Tipo Documento")
        ? 24
        : 18,
  }));
  detailSheet.addRows(detailed);
  styleHeader(detailSheet);
  detailSheet.autoFilter = { from: "A1", to: "I1" };
  ["H", "I"].forEach((column) => {
    detailSheet.getColumn(column).numFmt = "$#,##0;[Red]-$#,##0";
  });
  detailSheet.addRows([
    {},
    { "N° Correlativo (C1)": "TOTALES" },
    {
      "N° Correlativo (C1)": "Ingresos flujo",
      "Tipo de Operación (C2)": totals.incomeFlow,
    },
    {
      "N° Correlativo (C1)": "Egresos flujo",
      "Tipo de Operación (C2)": totals.expenseFlow,
    },
    {
      "N° Correlativo (C1)": "Saldo de caja",
      "Tipo de Operación (C2)": totals.cashBalance,
    },
    {
      "N° Correlativo (C1)": "Ingresos base",
      "Tipo de Operación (C2)": totals.taxableIncome,
    },
    {
      "N° Correlativo (C1)": "Egresos base",
      "Tipo de Operación (C2)": totals.taxableExpense,
    },
    {
      "N° Correlativo (C1)": "Resultado neto",
      "Tipo de Operación (C2)": totals.netResult,
    },
  ]);

  addObjectSheet(workbook, "Resumen diario", daily);
  addObjectSheet(workbook, "Conciliación", reconciliation);
  addObjectSheet(workbook, "Pendientes", pending);
  addObjectSheet(workbook, "Consolidado anual", [
    {
      Período: period,
      "Saldo inicial": openingBalance,
      Ingresos: totals.incomeFlow,
      Egresos: totals.expenseFlow,
      "Saldo final": closingBalance,
      "Ingresos base": totals.taxableIncome,
      "Egresos base": totals.taxableExpense,
      "Resultado neto": totals.netResult,
    },
  ]);
  const officialTotals = workbook.addWorksheet("Totales C10-C15");
  officialTotals.columns = [
    { header: "Código", key: "code", width: 14 },
    { header: "Concepto", key: "label", width: 38 },
    { header: "Monto", key: "amount", width: 22 },
  ];
  officialTotals.addRows([
    { code: "C10", label: "Total ingresos flujo", amount: totals.incomeFlow },
    { code: "C11", label: "Total egresos flujo", amount: totals.expenseFlow },
    { code: "C12", label: "Saldo de caja", amount: closingBalance },
    {
      code: "C13",
      label: "Total ingresos base imponible",
      amount: totals.taxableIncome,
    },
    {
      code: "C14",
      label: "Total egresos base imponible",
      amount: totals.taxableExpense,
    },
    { code: "C15", label: "Resultado neto", amount: totals.netResult },
  ]);
  const lastDetailRow = Math.max(2, rows.length + 1);
  officialTotals.getCell("C2").value = {
    formula: `SUMIF('Libro detallado'!B2:B${lastDetailRow},"<>2",'Libro detallado'!H2:H${lastDetailRow})`,
    result: totals.incomeFlow,
  };
  officialTotals.getCell("C3").value = {
    formula: `SUMIF('Libro detallado'!B2:B${lastDetailRow},2,'Libro detallado'!H2:H${lastDetailRow})`,
    result: totals.expenseFlow,
  };
  officialTotals.getCell("C4").value = {
    formula: `${openingBalance}+C2-C3`,
    result: closingBalance,
  };
  officialTotals.getCell("C5").value = {
    formula: `SUMIF('Libro detallado'!B2:B${lastDetailRow},1,'Libro detallado'!I2:I${lastDetailRow})`,
    result: totals.taxableIncome,
  };
  officialTotals.getCell("C6").value = {
    formula: `SUMIF('Libro detallado'!B2:B${lastDetailRow},2,'Libro detallado'!I2:I${lastDetailRow})`,
    result: totals.taxableExpense,
  };
  officialTotals.getCell("C7").value = {
    formula: "C5-C6",
    result: totals.netResult,
  };
  styleHeader(officialTotals);
  officialTotals.getColumn("amount").numFmt = "$#,##0;[Red]-$#,##0";
  const buffer = await workbook.xlsx.writeBuffer();
  download(
    new Blob([buffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
    `${filename(company, period, "completo", version)}.xlsx`,
  );
}

function addObjectSheet(
  workbook: ExcelJS.Workbook,
  name: string,
  rows: Record<string, unknown>[],
) {
  const sheet = workbook.addWorksheet(name, {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  const keys = Object.keys(rows[0] ?? { Estado: "Sin registros" });
  sheet.columns = keys.map((key) => ({
    header: key,
    key,
    width: key.length > 24 ? 30 : 18,
  }));
  if (rows.length) sheet.addRows(rows);
  styleHeader(sheet);
  return sheet;
}

function styleHeader(sheet: ExcelJS.Worksheet) {
  const row = sheet.getRow(1);
  row.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 10 };
  row.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF173931" },
  };
  row.alignment = { vertical: "middle", wrapText: true };
  row.height = 30;
}

export function exportCsv(
  company: Company,
  period: string,
  rows: LedgerRow[],
  version = 1,
  mode: "detail" | "daily" = "detail",
) {
  const data =
    mode === "detail"
      ? rows.map((row) => [
          row.correlation,
          row.operationType,
          row.documentNumber,
          row.documentType,
          row.issuerRut,
          formatDate(row.occurredOn),
          row.description,
          row.flowAmount,
          row.taxableAmount,
        ])
      : buildDailySummary(rows).map((row) => [
          formatDate(row.date),
          row.operationType,
          row.totalFlow,
          row.taxableAmount,
        ]);
  const headers =
    mode === "detail"
      ? [
          "N° Correlativo",
          "Tipo de Operación",
          "N° Documento",
          "Tipo Documento",
          "RUT Emisor",
          "Fecha de la Operación",
          "Glosa de operación",
          "Monto total flujo",
          "Monto afecta base imponible",
        ]
      : [
          "Fecha",
          "Tipo de Operación",
          "Resumen monto total diario",
          "Resumen diario base imponible",
        ];
  const escape = (value: unknown) =>
    `"${String(value ?? "").replace(/"/g, '""')}"`;
  const content =
    "\uFEFF" +
    [headers, ...data].map((row) => row.map(escape).join(";")).join("\r\n");
  download(
    new Blob([content], { type: "text/csv;charset=utf-8" }),
    `${filename(company, period, mode === "detail" ? "detalle" : "resumen-diario", version)}.csv`,
  );
}

export function exportPdf(
  company: Company,
  period: string,
  rows: LedgerRow[],
  version = 1,
  status = "BORRADOR",
) {
  const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(15);
  pdf.text("LIBRO DE CAJA", 14, 15);
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(8);
  pdf.text(
    `${company.name} · ${company.rut} · Período ${period} · ${status} · Versión ${version} · Generado ${new Date().toLocaleString("es-CL")}`,
    14,
    21,
  );
  const openingBalance = company.accounts.reduce(
    (sum, account) => sum + account.openingBalance,
    0,
  );
  autoTable(pdf, {
    startY: 27,
    head: [
      [
        "N°",
        "Op.",
        "Documento",
        "Tipo",
        "RUT emisor",
        "Fecha",
        "Glosa",
        "Flujo",
        "Base imponible",
      ],
    ],
    body: rows.map((row) => [
      row.correlation,
      row.operationType,
      row.documentNumber,
      row.documentType,
      row.issuerRut,
      formatDate(row.occurredOn),
      row.description,
      row.flowAmount.toLocaleString("es-CL"),
      row.taxableAmount.toLocaleString("es-CL"),
    ]),
    styles: { fontSize: 7, cellPadding: 1.8, overflow: "linebreak" },
    headStyles: { fillColor: [23, 57, 49], textColor: 255 },
    columnStyles: {
      6: { cellWidth: 58 },
      7: { halign: "right" },
      8: { halign: "right" },
    },
    didDrawPage: (data) => {
      pdf.setFontSize(7);
      pdf.text(`${company.rut} · ${period} · v${version}`, 14, 202);
      pdf.text(`Página ${data.pageNumber}`, 277, 202, { align: "right" });
    },
  });
  const totals = calculateTotals(rows);
  autoTable(pdf, {
    startY:
      (pdf as jsPDF & { lastAutoTable?: { finalY: number } }).lastAutoTable
        ?.finalY ?? 30,
    body: [
      [
        "Total ingresos",
        totals.incomeFlow.toLocaleString("es-CL"),
        "Total egresos",
        totals.expenseFlow.toLocaleString("es-CL"),
        "Saldo",
        (openingBalance + totals.cashBalance).toLocaleString("es-CL"),
        "Resultado neto",
        totals.netResult.toLocaleString("es-CL"),
      ],
    ],
    theme: "plain",
    styles: { fontSize: 8, fontStyle: "bold" },
  });
  pdf.save(`${filename(company, period, "detalle", version)}.pdf`);
}

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}
