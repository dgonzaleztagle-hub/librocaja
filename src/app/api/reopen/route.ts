import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient, requireUser } from "@/lib/supabase/server";

const schema = z.object({
  companyId: z.string().uuid(),
  period: z.string().regex(/^\d{4}-\d{2}$/),
  reason: z.string().trim().min(12).max(1000),
});

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const input = schema.parse(await request.json());
    const supabase = await createClient();
    const { data: closure } = await supabase
      .from("period_closures")
      .select("id,version,status")
      .eq("company_id", input.companyId)
      .eq("period", input.period)
      .order("version", { ascending: false })
      .limit(1)
      .single();
    if (!closure || closure.status !== "closed")
      return NextResponse.json(
        { error: "El período no está cerrado" },
        { status: 409 },
      );
    const { error } = await supabase
      .from("period_closures")
      .update({ status: "in_review" })
      .eq("id", closure.id)
      .eq("status", "closed");
    if (error) throw error;
    await supabase.from("audit_events").insert({
      company_id: input.companyId,
      actor_id: user.id,
      entity_type: "period_closure",
      entity_id: closure.id,
      action: "reopen",
      reason: input.reason,
      before_data: { status: "closed", version: closure.version },
      after_data: { status: "in_review", version: closure.version },
    });
    return NextResponse.json({ success: true, version: closure.version });
  } catch (error) {
    console.error("Error reabriendo período:", error);
    return NextResponse.json(
      { error: "No se pudo reabrir el período" },
      { status: 400 },
    );
  }
}
