import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser, createClient } from "@/lib/supabase/server";
import { assertPeriodOpen } from "@/lib/closure";
import { decryptSecret } from "@/lib/encryption";

const schema = z.object({
  companyId: z.string().uuid(),
  period: z.string().regex(/^\d{4}-\d{2}$/),
});

export async function POST(request: Request) {
  try {
    await requireUser();
    const input = schema.parse(await request.json());
    const supabase = await createClient();
    await assertPeriodOpen(supabase, input.companyId, input.period);
    const [{ data: company }, { data: credential }] = await Promise.all([
      supabase
      .from("companies")
      .select("id,rut")
      .eq("id", input.companyId)
      .single(),
      supabase.from("sii_credentials").select("ciphertext,iv,auth_tag,key_version").eq("company_id", input.companyId).maybeSingle(),
    ]);
    if (!company || !credential)
      return NextResponse.json(
        { error: "Configura la clave SII de esta empresa antes de sincronizar" },
        { status: 409 },
      );
    const baseUrl = process.env.RAILWAY_SCRAPER_URL?.replace(/\/$/, "");
    const apiKey = process.env.RAILWAY_INTERNAL_API_KEY;
    if (!baseUrl || !apiKey) throw new Error("Integración Railway no configurada");
    const response = await fetch(`${baseUrl}/v2/rcv/extractions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ company_id: company.id, rut: company.rut, password: decryptSecret({ version: credential.key_version, ciphertext: credential.ciphertext, iv: credential.iv, tag: credential.auth_tag }), period: input.period }),
      cache: "no-store",
    });
    const result = await response.json();
    if (!response.ok) return NextResponse.json({ error: String(result.error ?? "No se pudo iniciar la extracción") }, { status: response.status });
    return NextResponse.json(result, { status: 202 });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof z.ZodError
            ? "Solicitud inválida"
            : "No se pudo iniciar la sincronización",
      },
      { status: 400 },
    );
  }
}
