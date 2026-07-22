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
  } catch {
    return NextResponse.json(
      { error: "No se pudo eliminar la empresa" },
      { status: 400 },
    );
  }
}
