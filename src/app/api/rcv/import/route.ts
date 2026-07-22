import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { assertPeriodOpen } from "@/lib/closure";
import { createClient } from "@/lib/supabase/server";

const documentSchema = z.object({
  period: z.string().regex(/^\d{4}-\d{2}$/),
  direction: z.enum(["purchase", "sale"]),
  documentCode: z.number().int().positive(),
  documentType: z.string().min(1),
  folio: z.string().min(1),
  counterpartyRut: z.string(),
  counterpartyName: z.string(),
  issuedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  exemptAmount: z.number().int().min(0),
  netAmount: z.number().int().min(0),
  vatAmount: z.number().int().min(0),
  totalAmount: z.number().int().positive(),
});

const bodySchema = z.object({
  companyId: z.string().uuid(),
  period: z.string().regex(/^\d{4}-\d{2}$/),
  files: z.array(z.object({ filename: z.string().min(1), direction: z.enum(["purchase", "sale"]) })).min(1),
  documents: z.array(documentSchema).min(1).max(2000),
});

export async function POST(request: Request) {
  try {
    const body = bodySchema.parse(await request.json());
    if (body.documents.some((document) => document.period !== body.period))
      return NextResponse.json({ error: "Los documentos no corresponden al período seleccionado." }, { status: 400 });
    const supabase = await createClient();
    await assertPeriodOpen(supabase, body.companyId, body.period);
    const { data: company, error: companyError } = await supabase
      .from("companies").select("id").eq("id", body.companyId).maybeSingle();
    if (companyError) throw companyError;
    if (!company) return NextResponse.json({ error: "Empresa no encontrada." }, { status: 404 });

    const payloadHash = createHash("sha256")
      .update(JSON.stringify({ period: body.period, files: body.files, documents: body.documents }))
      .digest("hex");
    const snapshotPeriod = legacySnapshotPeriod(body.period);
    const { data: existing, error: existingError } = await supabase
      .from("rcv_snapshots")
      .select("id")
      .eq("company_id", body.companyId)
      .eq("period", snapshotPeriod)
      .eq("payload_sha256", payloadHash)
      .maybeSingle();
    if (existingError) throw existingError;
    if (existing)
      return NextResponse.json({ imported: 0, duplicates: body.documents.length, snapshotId: existing.id });

    const { count, error: countError } = await supabase
      .from("rcv_snapshots").select("id", { count: "exact", head: true })
      .eq("company_id", body.companyId).eq("period", snapshotPeriod);
    if (countError) throw countError;
    const { data: snapshot, error: snapshotError } = await supabase
      .from("rcv_snapshots")
      .insert({
        company_id: body.companyId,
        period: snapshotPeriod,
        source: "sii_csv",
        payload_sha256: payloadHash,
        version: (count ?? 0) + 1,
        raw_summary: { period: body.period, files: body.files, imported_from: "sii_csv" },
      })
      .select("id").single();
    if (snapshotError || !snapshot) throw snapshotError ?? new Error("No se pudo crear la importación.");

    const { data: currentRows, error: currentError } = await supabase
      .from("rcv_documents")
      .select("direction,document_code,folio,counterparty_rut")
      .eq("company_id", body.companyId)
      .eq("period", body.period);
    if (currentError) throw currentError;
    const seen = new Set((currentRows ?? []).map((row) => fingerprint(row)));
    const rows = body.documents
      .filter((document) => !seen.has(fingerprint(document)))
      .map((document) => ({
        snapshot_id: snapshot.id,
        company_id: body.companyId,
        period: document.period,
        direction: document.direction,
        document_code: document.documentCode,
        document_type: document.documentType,
        folio: document.folio,
        counterparty_rut: document.counterpartyRut || null,
        counterparty_name: document.counterpartyName || null,
        issued_on: document.issuedOn,
        exempt_amount: document.exemptAmount,
        net_amount: document.netAmount,
        vat_amount: document.vatAmount,
        total_amount: document.totalAmount,
        status: "pending",
      }));
    if (rows.length) {
      const { error: insertError } = await supabase.from("rcv_documents").insert(rows);
      if (insertError) throw insertError;
    }
    return NextResponse.json({ imported: rows.length, duplicates: body.documents.length - rows.length, snapshotId: snapshot.id }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo importar el RCV." }, { status: 400 });
  }
}

function fingerprint(row: { direction: string; documentCode?: number; document_code?: number; folio: string; counterpartyRut?: string; counterparty_rut?: string | null }) {
  return [row.direction, row.documentCode ?? row.document_code, row.folio.trim(), row.counterpartyRut ?? row.counterparty_rut ?? ""].join("|");
}

function legacySnapshotPeriod(period: string) {
  return period.split("-").map((part) => `\\${"d".repeat(part.length)}`).join("-");
}
