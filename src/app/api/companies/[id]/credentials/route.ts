import { NextResponse } from "next/server";
import { z } from "zod";
import { encryptSecret } from "@/lib/encryption";
import { createClient } from "@/lib/supabase/server";

const schema = z.object({ password: z.string().min(4).max(200) });

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const { password } = schema.parse(await request.json());
    const supabase = await createClient();
    const { data: company } = await supabase
      .from("companies")
      .select("id")
      .eq("id", id)
      .maybeSingle();
    if (!company) return NextResponse.json({ error: "Empresa no encontrada" }, { status: 404 });
    const secret = encryptSecret(password);
    const { error } = await supabase.from("sii_credentials").upsert({
      company_id: id,
      ciphertext: secret.ciphertext,
      iv: secret.iv,
      auth_tag: secret.tag,
      key_version: secret.version,
      updated_at: new Date().toISOString(),
    });
    if (error) throw error;
    return NextResponse.json({ saved: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof z.ZodError ? "Clave SII inválida" : "No se pudo guardar la clave SII" }, { status: 400 });
  }
}
