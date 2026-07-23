import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { assertPeriodOpen } from "@/lib/closure";

const schema = z.object({
  companyId: z.string().uuid(),
  operationType: z.union([z.literal(0), z.literal(1), z.literal(2)]),
  occurredOn: z.string().min(8).max(20),
  description: z.string().min(1).max(500),
  amount: z.number(),
  taxableAmount: z.number().default(0),
  category: z.string().max(80).optional().nullable(),
  documentType: z.string().max(120).optional().nullable(),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const input = schema.parse(await request.json());
    const supabase = await createClient();
    const { data: existing } = await supabase
      .from("cash_movements")
      .select("id,period,source")
      .eq("id", id)
      .eq("company_id", input.companyId)
      .maybeSingle();
    if (!existing)
      return NextResponse.json(
        { error: "Movimiento no encontrado" },
        { status: 404 },
      );
    // Solo movimientos manuales son editables aquí: los de banco o RCV
    // vienen de una fuente externa y no deben corregirse a mano.
    if (existing.source !== "manual")
      return NextResponse.json(
        { error: "Solo se pueden editar movimientos manuales" },
        { status: 400 },
      );
    await assertPeriodOpen(supabase, input.companyId, existing.period);
    const { error } = await supabase
      .from("cash_movements")
      .update({
        operation_type: input.operationType,
        occurred_on: input.occurredOn,
        description: input.description,
        amount: Math.round(input.amount),
        taxable_amount: Math.round(input.taxableAmount || 0),
        category: input.category || null,
        document_type: input.documentType || null,
      })
      .eq("id", id);
    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof z.ZodError
            ? "Datos inválidos: " + error.issues.map((e) => e.message).join(", ")
            : "No se pudo actualizar el movimiento",
      },
      { status: 400 },
    );
  }
}
