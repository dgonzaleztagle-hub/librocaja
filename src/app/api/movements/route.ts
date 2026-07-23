import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { assertPeriodOpen } from "@/lib/closure";

const rowSchema = z.object({
  accountId: z.string().min(1),
  period: z.string().regex(/^\d{4}-\d{2}$/),
  operationType: z.union([z.literal(0), z.literal(1), z.literal(2)]),
  occurredOn: z.string().min(8).max(20),
  description: z.string().min(1).max(500),
  reference: z.string().max(200).optional().nullable(),
  amount: z.number(),
  taxableAmount: z.number().default(0),
  category: z.string().max(80).optional().nullable(),
  source: z.enum(["bank", "cash", "manual", "rcv"]),
  reconciled: z.boolean(),
  issuerRut: z.string().max(20).optional().nullable(),
  fingerprint: z.string().max(128).optional().nullable(),
});
const schema = z.object({
  companyId: z.string().uuid(),
  rows: z.array(rowSchema).min(1).max(5000),
});

export async function POST(request: Request) {
  try {
    const input = schema.parse(await request.json());
    const supabase = await createClient();
    for (const period of new Set(input.rows.map((row) => row.period)))
      await assertPeriodOpen(supabase, input.companyId, period);
    const rows = input.rows.map((row) => ({
      company_id: input.companyId,
      account_id: row.accountId,
      period: row.period,
      operation_type: row.operationType,
      occurred_on: row.occurredOn,
      description: row.description,
      reference: row.reference || null,
      amount: Math.round(row.amount),
      taxable_amount: Math.round(row.taxableAmount || 0),
      category: row.category || null,
      source: row.source,
      reconciled: row.reconciled,
      issuer_rut: row.issuerRut || null,
      fingerprint: row.fingerprint || null,
    }));
    const { data, error } = await supabase
      .from("cash_movements")
      .upsert(rows, {
        onConflict: "company_id,account_id,fingerprint",
        ignoreDuplicates: true,
      })
      .select();
    if (error) throw error;
    return NextResponse.json({ success: true, inserted: data?.length ?? 0 });
  } catch (error) {
    console.error("Error guardando movimientos:", error);
    return NextResponse.json(
      {
        error:
          error instanceof z.ZodError
            ? "Solicitud inválida: " + error.errors.map((e) => e.message).join(", ")
            : "No se pudieron guardar los movimientos",
      },
      { status: 400 },
    );
  }
}
