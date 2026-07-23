import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser, createClient } from "@/lib/supabase/server";
import { periodLabel } from "@/lib/format";

const schema = z
  .object({
    companyId: z.string().uuid(),
    period: z.string().regex(/^\d{4}-\d{2}$/),
    openingBalance: z.number().int(),
    closingBalance: z.number().int(),
    totals: z.record(z.string(), z.number()),
    forced: z.boolean(),
    forceReason: z.string().max(1000).optional(),
  })
  .refine(
    (input) => !input.forced || (input.forceReason?.trim().length ?? 0) >= 12,
  );
export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const input = schema.parse(await request.json());
    const supabase = await createClient();
    const { data: previous } = await supabase
      .from("period_closures")
      .select("id,version,status")
      .eq("company_id", input.companyId)
      .eq("period", input.period)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (previous?.status === "closed")
      return NextResponse.json(
        { error: "El período ya está cerrado" },
        { status: 409 },
      );
    // El saldo inicial de cada período se traspasa del cierre del anterior.
    // Cerrar este período mientras uno posterior ya está cerrado dejaría el
    // saldo inicial de ese posterior congelado y desactualizado para
    // siempre, así que se exige cerrar en orden cronológico.
    const { data: laterRows } = await supabase
      .from("period_closures")
      .select("period,status")
      .eq("company_id", input.companyId)
      .gt("period", input.period)
      .order("period", { ascending: true })
      .order("version", { ascending: false });
    const latestStatusByPeriod = new Map<string, string>();
    for (const row of laterRows ?? [])
      if (!latestStatusByPeriod.has(row.period))
        latestStatusByPeriod.set(row.period, row.status);
    const closedLaterPeriod = [...latestStatusByPeriod.entries()].find(
      ([, status]) => status === "closed",
    )?.[0];
    if (closedLaterPeriod)
      return NextResponse.json(
        {
          error: `No puedes cerrar este período porque ${periodLabel(closedLaterPeriod)} ya está cerrado. Reábrelo primero, luego cierra en orden.`,
        },
        { status: 409 },
      );
    const version = Number(previous?.version ?? 0) + 1;
    const { data, error } = await supabase
      .from("period_closures")
      .insert({
        company_id: input.companyId,
        period: input.period,
        version,
        status: "closed",
        opening_balance: input.openingBalance,
        closing_balance: input.closingBalance,
        totals: input.totals,
        forced: input.forced,
        force_reason: input.forceReason || null,
        closed_by: user.id,
        closed_at: new Date().toISOString(),
        supersedes_id: previous?.id ?? null,
      })
      .select("id,version")
      .single();
    if (error) throw error;
    await supabase
      .from("audit_events")
      .insert({
        company_id: input.companyId,
        actor_id: user.id,
        entity_type: "period_closure",
        entity_id: data.id,
        action: input.forced ? "force_close" : "close",
        reason: input.forceReason || null,
        after_data: { period: input.period, version },
      });
    return NextResponse.json({ success: true, version });
  } catch {
    return NextResponse.json(
      { error: "No se pudo cerrar el período" },
      { status: 400 },
    );
  }
}
