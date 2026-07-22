import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const schema = z.object({
  name: z.string().trim().min(2).max(160),
  rut: z.string().trim().min(8).max(14),
  regime: z.enum(["transparent", "general_simplified"]),
});

export async function POST(request: Request) {
  try {
    const body = schema.parse(await request.json());
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL)
      return NextResponse.json(
        {
          company: {
            id: crypto.randomUUID(),
            ...body,
            status: "active",
            currentPeriod: new Date().toISOString().slice(0, 7),
            accounts: [],
          },
        },
        { status: 201 },
      );
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("companies")
      .insert({
        name: body.name,
        rut: body.rut,
        regime: body.regime,
        owner_id: "libro-caja-private",
      })
      .select()
      .single();
    if (error) throw error;
    return NextResponse.json(
      {
        company: {
          id: data.id,
          name: data.name,
          rut: data.rut,
          regime: data.regime,
          status: "active",
          currentPeriod: new Date().toISOString().slice(0, 7),
          accounts: [],
        },
      },
      { status: 201 },
    );
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof z.ZodError
            ? "Datos de empresa inválidos"
            : "No se pudo crear la empresa",
      },
      { status: 400 },
    );
  }
}
