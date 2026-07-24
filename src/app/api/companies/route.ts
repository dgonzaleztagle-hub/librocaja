import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const schema = z.object({
  name: z.string().trim().min(2).max(160),
  rut: z.string().trim().min(8).max(14),
  regime: z.enum(["transparent", "general_simplified"]),
  openingBalance: z.number().int().default(0),
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
    // La app es privada y usa una sola cuenta dueña. En instalaciones antiguas
    // no estaba definida la variable del dueño; tomamos la cuenta existente
    // para respetar la FK del esquema sin abrir registro público.
    let ownerId = process.env.LIBRO_CAJA_OWNER_ID;
    if (!ownerId) {
      const { data: users, error: usersError } = await supabase.auth.admin.listUsers({
        page: 1,
        perPage: 1,
      });
      if (usersError || !users.users[0]) throw usersError ?? new Error("No existe un usuario dueño");
      ownerId = users.users[0].id;
    }
    const { data, error } = await supabase
      .from("companies")
      .insert({
        name: body.name,
        rut: body.rut,
        regime: body.regime,
        owner_id: ownerId,
      })
      .select()
      .single();
    if (error) throw error;
    // Único momento en que se pide el saldo inicial: al crear la empresa.
    // Se guarda en la cuenta de caja implícita (misma que usan los
    // movimientos manuales) para no volver a pedirlo nunca más.
    const { error: accountError } = await supabase.from("cash_accounts").insert({
      company_id: data.id,
      name: "Caja",
      kind: "cash",
      opening_balance: body.openingBalance,
    });
    if (accountError) throw accountError;
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
