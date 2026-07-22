import { describe, expect, it } from "vitest";
import { mapBankRows, parseMoney, suggestMapping } from "./bank-import";

describe("importador bancario", () => {
  it("interpreta formatos monetarios chilenos", () => {
    expect(parseMoney("$ 1.234.567")).toBe(1234567);
    expect(parseMoney("(45.000)")).toBe(-45000);
    expect(parseMoney("12.345,50")).toBe(12346);
  });

  it("sugiere columnas habituales sin depender de un banco", () => {
    const mapping = suggestMapping(["Fecha movimiento", "Glosa", "Cargo", "Abono", "N° operación"]);
    expect(mapping.date).toBe("Fecha movimiento");
    expect(mapping.description).toBe("Glosa");
    expect(mapping.debit).toBe("Cargo");
    expect(mapping.credit).toBe("Abono");
  });

  it("normaliza cargos y abonos y genera huellas idempotentes", async () => {
    const source = [{ Fecha: "03/06/2026", Glosa: "Pago proveedor", Cargo: "120.000", Abono: "", Referencia: "881" }];
    const result = await mapBankRows(source, { date: "Fecha", description: "Glosa", debit: "Cargo", credit: "Abono", reference: "Referencia", dateFormat: "dmy" });
    expect(result.errors).toEqual([]);
    expect(result.rows[0]).toMatchObject({ date: "2026-06-03", amount: -120000, description: "Pago proveedor" });
    expect(result.rows[0].fingerprint).toHaveLength(64);
  });
});

