import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser, createClient } from "@/lib/supabase/server";
import { assertPeriodOpen } from "@/lib/closure";

const schema = z.object({
  companyId: z.string().uuid(),
  movementId: z.string().uuid(),
  documentId: z.string().uuid(),
  amount: z.number().int().positive(),
  category: z.enum(["sale", "purchase"]),
  taxableAmount: z.number().int().min(0),
  documentNumber: z.string(),
  documentType: z.string(),
  issuerRut: z.string(),
});
export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const input = schema.parse(await request.json());
    const supabase = await createClient();
    const { data: movement } = await supabase
      .from("cash_movements")
      .select("period")
      .eq("id", input.movementId)
      .eq("company_id", input.companyId)
      .single();
    if (!movement) throw new Error("Movimiento no encontrado");
    await assertPeriodOpen(supabase, input.companyId, movement.period);
    const { data: existing } = await supabase
      .from("allocations")
      .select("amount")
      .eq("document_id", input.documentId);
    const allocated =
      (existing ?? []).reduce((sum, row) => sum + Number(row.amount), 0) +
      input.amount;
    const { data: document } = await supabase
      .from("rcv_documents")
      .select("total_amount")
      .eq("id", input.documentId)
      .eq("company_id", input.companyId)
      .single();
    if (!document) throw new Error("Documento no encontrado");
    const nextStatus =
      allocated >= Number(document.total_amount) ? "settled" : "partial";
    const { error: allocationError } = await supabase
      .from("allocations")
      .upsert(
        {
          movement_id: input.movementId,
          document_id: input.documentId,
          amount: input.amount,
        },
        { onConflict: "movement_id,document_id" },
      );
    if (allocationError) throw allocationError;
    await Promise.all([
      supabase
        .from("cash_movements")
        .update({
          reconciled: true,
          category: input.category,
          taxable_amount: input.taxableAmount,
          document_number: input.documentNumber,
          document_type: input.documentType,
          issuer_rut: input.issuerRut,
        })
        .eq("id", input.movementId)
        .eq("company_id", input.companyId),
      supabase
        .from("rcv_documents")
        .update({ status: nextStatus })
        .eq("id", input.documentId)
        .eq("company_id", input.companyId),
      supabase
        .from("audit_events")
        .insert({
          company_id: input.companyId,
          actor_id: user.id,
          entity_type: "allocation",
          entity_id: input.movementId,
          action: "reconcile",
          after_data: input,
        }),
    ]);
    return NextResponse.json({ success: true, documentStatus: nextStatus });
  } catch {
    return NextResponse.json(
      { error: "No se pudo guardar la conciliación" },
      { status: 400 },
    );
  }
}
