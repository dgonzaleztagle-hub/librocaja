import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const schema = z.object({ name: z.string().trim().min(2).max(100), kind: z.enum(["bank", "cash"]), bank: z.string().trim().max(100).optional(), numberLast4: z.string().regex(/^\d{0,4}$/).optional(), openingBalance: z.number().int() });
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const input = schema.parse(await request.json());
    const supabase = await createClient();
    const { data, error } = await supabase.from("cash_accounts").insert({ company_id: id, name: input.name, kind: input.kind, bank: input.bank || null, number_last4: input.numberLast4 || null, opening_balance: input.openingBalance }).select().single();
    if (error) throw error;
    return NextResponse.json({ success: true, account: data }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "No se pudo crear la cuenta" }, { status: 400 });
  }
}
