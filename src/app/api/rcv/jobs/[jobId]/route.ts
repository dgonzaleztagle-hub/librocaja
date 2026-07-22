import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { normalizeRcvDocuments } from "@/lib/rcv";

// El scraper puede generar IDs válidos para su propia cola; no imponer aquí
// el formato UUID de Supabase antes de consultar el trabajo remoto.
const paramsSchema = z.object({ jobId: z.string().trim().min(1).max(128) });

export async function GET(
  request: Request,
  { params }: { params: Promise<{ jobId: string }> },
) {
  try {
    const { jobId } = paramsSchema.parse(await params);
    const companyId = new URL(request.url).searchParams.get("companyId");
    if (!companyId)
      return NextResponse.json({ error: "Empresa requerida" }, { status: 400 });
    const supabase = await createClient();
    const { data: company } = await supabase
      .from("companies")
      .select("id")
      .eq("id", companyId)
      .single();
    if (!company)
      return NextResponse.json(
        { error: "Empresa no encontrada" },
        { status: 404 },
      );
    const baseUrl = (process.env.APISII_SCRAPER_URL || "https://apisii-production.up.railway.app").replace(/\/$/, "");
    const apiKey = process.env.RAILWAY_INTERNAL_API_KEY;
    if (!baseUrl || !apiKey) throw new Error("Integración Railway no configurada");
    const response = await fetch(`${baseUrl}/v2/rcv/extractions/${jobId}`, {
      headers: { authorization: `Bearer ${apiKey}` },
      cache: "no-store",
    });
    const job = (await response.json()) as Record<string, unknown>;
    if (!response.ok) return NextResponse.json({ error: String(job.error ?? "No se pudo consultar la extracción") }, { status: response.status });
    if (job.company_id !== companyId)
      return NextResponse.json(
        { error: "Trabajo no asociado a la empresa" },
        { status: 403 },
      );
    if (job.status === "succeeded" && job.result)
      await persistResult(
        supabase,
        companyId,
        job.result as Record<string, unknown>,
      );
    return NextResponse.json(job);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : safeErrorMessage(error),
      },
      { status: 400 },
    );
  }
}

async function persistResult(
  supabase: Awaited<ReturnType<typeof createClient>>,
  companyId: string,
  result: Record<string, unknown>,
) {
  const period = String(result.period);
  const payloadHash = String(result.payload_sha256);
  let snapshotPeriod = period;
  let existingResult = await findExistingSnapshot(supabase, companyId, snapshotPeriod, payloadHash);
  // La primera versión del esquema desplegado tenía un patrón PostgreSQL que
  // interpretaba `\\d` de forma literal. La migración 002 lo corrige; mientras
  // tanto conservamos el período real en los documentos y sólo usamos esta
  // clave interna compatible para no detener una extracción en producción.
  if (existingResult.constraintError)
    snapshotPeriod = legacySnapshotPeriod(period);
  else if (existingResult.id)
    return existingResult.id;

  if (snapshotPeriod !== period) {
    existingResult = await findExistingSnapshot(supabase, companyId, snapshotPeriod, payloadHash);
    if (existingResult.id) return existingResult.id;
  }
  const { count, error: countError } = await supabase
    .from("rcv_snapshots")
    .select("id", { count: "exact", head: true })
    .eq("company_id", companyId)
    .eq("period", snapshotPeriod);
  if (countError) throw new Error(safeErrorMessage(countError));
  let insertResult = await supabase
    .from("rcv_snapshots")
    .insert({
      company_id: companyId,
      period: snapshotPeriod,
      source: "railway",
      payload_sha256: payloadHash,
      version: (count ?? 0) + 1,
      raw_summary: result.summaries,
    })
    .select("id")
    .single();
  if (insertResult.error?.code === "23514" && snapshotPeriod === period) {
    snapshotPeriod = legacySnapshotPeriod(period);
    insertResult = await supabase
      .from("rcv_snapshots")
      .insert({
        company_id: companyId,
        period: snapshotPeriod,
        source: "railway",
        payload_sha256: payloadHash,
        version: 1,
        raw_summary: result.summaries,
      })
      .select("id")
      .single();
  }
  const { data: snapshot, error } = insertResult;
  if (error || !snapshot) throw error ?? new Error("No se pudo crear snapshot");
  const purchases = normalizeRcvDocuments(
    (result.purchases ?? []) as Record<string, unknown>[],
    { companyId, period, direction: "purchase", snapshotId: snapshot.id },
  );
  const sales = normalizeRcvDocuments(
    (result.sales ?? []) as Record<string, unknown>[],
    { companyId, period, direction: "sale", snapshotId: snapshot.id },
  );
  const rows = [...purchases, ...sales].map((document) => ({
    snapshot_id: snapshot.id,
    company_id: companyId,
    period: document.period,
    direction: document.direction,
    document_code: document.documentCode,
    document_type: document.documentType,
    folio: document.folio,
    counterparty_rut: document.counterpartyRut,
    counterparty_name: document.counterpartyName,
    issued_on: document.issuedOn,
    exempt_amount: document.exemptAmount,
    net_amount: document.netAmount,
    vat_amount: document.vatAmount,
    total_amount: document.totalAmount,
    status: document.status,
  }));
  if (rows.length) {
    const { error: insertError } = await supabase
      .from("rcv_documents")
      .insert(rows);
    if (insertError) throw insertError;
  }
  return snapshot.id;
}

async function findExistingSnapshot(
  supabase: Awaited<ReturnType<typeof createClient>>,
  companyId: string,
  period: string,
  payloadHash: string,
) {
  const { data: existing, error } = await supabase
    .from("rcv_snapshots")
    .select("id")
    .eq("company_id", companyId)
    .eq("period", period)
    .eq("payload_sha256", payloadHash)
    .maybeSingle();
  // PostgREST devuelve errores como objetos simples, no como Error. No los
  // silenciemos: de otro modo la extracción parece fallar sin explicación.
  if (error) {
    if (error.code === "23514") return { id: null, constraintError: true };
    throw new Error(safeErrorMessage(error));
  }
  return { id: existing?.id ?? null, constraintError: false };
}

function legacySnapshotPeriod(period: string) {
  return period
    .split("-")
    .map((part) => `\\${"d".repeat(part.length)}`)
    .join("-");
}

function safeErrorMessage(error: unknown) {
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return "No se pudo consultar la extracción";
  }
}
