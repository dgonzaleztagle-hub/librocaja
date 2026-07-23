import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL)
      return NextResponse.json({ ok: true });

    const supabase = await createClient();
    const { error } = await supabase
      .from("companies")
      .delete()
      .eq("id", id);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (error) {
    // cash_movements.account_id y allocations.document_id son ON DELETE
    // RESTRICT (ver supabase/migrations/001_initial.sql): una empresa con
    // movimientos o conciliaciones reales nunca se puede borrar hasta que
    // el esquema permita cascada ahí. Se avisa en vez de un genérico mudo.
    const code = (error as { code?: string } | null)?.code;
    return NextResponse.json(
      {
        error:
          code === "23503"
            ? "No se puede eliminar: esta empresa ya tiene movimientos o conciliaciones registradas."
            : "No se pudo eliminar la empresa",
      },
      { status: 400 },
    );
  }
}
