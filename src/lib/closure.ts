import "server-only";
import type { createClient } from "@/lib/supabase/server";

type LibroCajaClient = Awaited<ReturnType<typeof createClient>>;

export async function assertPeriodOpen(
  supabase: LibroCajaClient,
  companyId: string,
  period: string,
) {
  const { data } = await supabase
    .from("period_closures")
    .select("status")
    .eq("company_id", companyId)
    .eq("period", period)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (data?.status === "closed") throw new Error("PERIOD_CLOSED");
}
