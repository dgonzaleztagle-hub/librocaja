"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, type RefObject } from "react";
import {
  AlertCircle,
  ArrowDownLeft,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleDot,
  Download,
  FileCheck2,
  FileSpreadsheet,
  KeyRound,
  Landmark,
  Link2,
  LoaderCircle,
  LockKeyhole,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Upload,
  WalletCards,
  X,
} from "lucide-react";
import {
  mapBankRows,
  readTabularFile,
  suggestMapping,
  type ImportMapping,
  type TabularFile,
} from "@/lib/bank-import";
import { exportCsv, exportExcel, exportPdf } from "@/lib/exports";
import { clp, formatDate, periodLabel } from "@/lib/format";
import { parseSiiRcvFile, type SiiRcvFile } from "@/lib/sii-rcv-import";
import {
  buildLedger,
  buildCompleteLedger,
  calculateTotals,
  manualDocumentKindLabels,
  manualTaxableAmount,
  suggestedTaxableAmount,
  validateClose,
  type ManualDocumentKind,
} from "@/lib/ledger";
import type {
  CashMovement,
  Company,
  MovementCategory,
  RcvDocument,
} from "@/lib/types";

const stages = [
  { id: "sources", label: "RCV detallado", caption: "Extraer desde SII", icon: Landmark },
  { id: "review", label: "Libro Anexo 3", caption: "Detalle y totales", icon: FileCheck2 },
  { id: "close", label: "Exportar", caption: "Formato oficial", icon: LockKeyhole },
] as const;
type Stage = (typeof stages)[number]["id"] | "reconcile";

// Fila sintética de saldo inicial: no existe en la base, solo se arma en
// memoria para que aparezca como primera línea del libro.
const OPENING_BALANCE_MOVEMENT_ID = "opening-balance";

export function Workspace({
  company,
  period,
  initialMovements,
  initialDocuments,
  initialClosure,
  openingBalance,
  openingBalanceCarried,
}: {
  company: Company;
  period: string;
  initialMovements: CashMovement[];
  initialDocuments: RcvDocument[];
  initialClosure: { closed: boolean; version: number };
  openingBalance: number;
  openingBalanceCarried: boolean;
}) {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>("sources");
  const [movements, setMovements] = useState<CashMovement[]>(initialMovements);
  const [documents, setDocuments] = useState<RcvDocument[]>(initialDocuments);
  const [selectedMovement, setSelectedMovement] = useState<string | null>(
    movements.find((m) => !m.reconciled)?.id ?? null,
  );
  const [selectedDocument, setSelectedDocument] = useState<string | null>(null);
  const [accountFilter, setAccountFilter] = useState("all");
  const [movementFilter, setMovementFilter] = useState<
    "all" | "pending" | "done"
  >("pending");
  const [documentQuery, setDocumentQuery] = useState("");
  const [importOpen, setImportOpen] = useState(false);
  const [rcvImportOpen, setRcvImportOpen] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [editingMovement, setEditingMovement] = useState<CashMovement | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState(100);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [periodClosed, setPeriodClosed] = useState(initialClosure.closed);
  const [closureVersion, setClosureVersion] = useState(initialClosure.version);
  const [openingConfirmed, setOpeningConfirmed] = useState(openingBalanceCarried);
  // useState(initialX) solo toma el valor inicial en el primer render: un
  // router.refresh() sin cambiar de ruta (misma empresa/período) no lo vuelve
  // a aplicar por sí solo, así que la sincronización RCV y la importación de
  // CSV podían "terminar bien" sin que la tabla se actualizara en pantalla.
  // Se ajusta durante el render (no en un efecto) siguiendo el patrón de
  // React para derivar estado desde props que cambian.
  const [prevInitialMovements, setPrevInitialMovements] = useState(initialMovements);
  if (initialMovements !== prevInitialMovements) {
    setPrevInitialMovements(initialMovements);
    setMovements(initialMovements);
  }
  const [prevInitialDocuments, setPrevInitialDocuments] = useState(initialDocuments);
  if (initialDocuments !== prevInitialDocuments) {
    setPrevInitialDocuments(initialDocuments);
    setDocuments(initialDocuments);
  }
  const [prevInitialClosure, setPrevInitialClosure] = useState(initialClosure);
  if (initialClosure !== prevInitialClosure) {
    setPrevInitialClosure(initialClosure);
    setPeriodClosed(initialClosure.closed);
    setClosureVersion(initialClosure.version);
  }
  // El saldo traspasado del mes anterior (o el configurado en la cuenta, en
  // el primer período) debe ser la primera línea del libro, no solo un dato
  // aparte en el cierre.
  const openingMovement = useMemo<CashMovement>(
    () => ({
      id: OPENING_BALANCE_MOVEMENT_ID,
      companyId: company.id,
      accountId: "",
      period,
      operationType: 0,
      occurredOn: `${period}-01`,
      description: "Saldo inicial",
      documentType: "Saldo inicial",
      amount: openingBalance,
      taxableAmount: 0,
      category: "other",
      source: "manual",
      reconciled: true,
      createdOrder: "",
    }),
    [company.id, period, openingBalance],
  );
  const ledger = useMemo(
    () => buildCompleteLedger(company, documents, [openingMovement, ...movements]),
    [company, documents, movements, openingMovement],
  );
  const totals = useMemo(() => calculateTotals(ledger), [ledger]);
  const closeValidation = useMemo(
    () =>
      validateClose(
        movements,
        documents.filter((d) => d.period <= period),
        openingConfirmed,
      ),
    [movements, documents, openingConfirmed, period],
  );
  const pendingCount = movements.filter(
    (movement) => !movement.reconciled && !movement.excluded,
  ).length;

  function changePeriod(offset: number) {
    const [year, month] = period.split("-").map(Number);
    const next = new Date(year, month - 1 + offset, 1);
    router.push(`/empresa/${company.id}/${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}`);
  }

  async function syncRcv() {
    setSyncing(true);
    setSyncProgress(12);
    setSyncError(null);
    if (process.env.NEXT_PUBLIC_SUPABASE_URL) {
      try {
        const response = await fetch("/api/rcv/sync", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ companyId: company.id, period }),
        });
        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          throw new Error(body.error ?? "No se pudo iniciar la extracción");
        }
        const { job_id: jobId } = await response.json();
        for (let attempt = 0; attempt < 180; attempt += 1) {
          await new Promise((resolve) => window.setTimeout(resolve, 1000));
          // Railway usa un único worker de Playwright. Durante la navegación
          // por el SII puede demorar en entregar una consulta de estado; eso
          // no invalida la extracción. Reintentamos y sólo mostramos error
          // cuando se agota el plazo completo de la operación.
          let statusResponse: Response;
          let job: {
            status?: string;
            progress?: number;
            error?: { message?: string } | string;
          };
          try {
            statusResponse = await fetch(
              `/api/rcv/jobs/${jobId}?companyId=${company.id}`,
              { cache: "no-store" },
            );
            job = await statusResponse.json();
          } catch (pollError) {
            if (attempt < 179) continue;
            throw pollError;
          }
          if (!statusResponse.ok)
            throw new Error(
              typeof job.error === "object"
                ? job.error?.message ?? "No se pudo consultar la extracción"
                : job.error ?? "No se pudo consultar la extracción",
            );
          setSyncProgress(Number(job.progress ?? 0));
          if (job.status === "succeeded") {
            setSyncing(false);
            router.refresh();
            return;
          }
          if (job.status === "failed")
            throw new Error(
              typeof job.error === "object"
                ? job.error?.message ?? "sync failed"
                : job.error ?? "sync failed",
            );
        }
        throw new Error("sync timeout");
      } catch (error) {
        setSyncing(false);
        setSyncProgress(0);
        setSyncError(
          error instanceof Error
            ? error.message
            : "No se pudo completar la extracción",
        );
        return;
      }
    }
    const timer = window.setInterval(
      () => setSyncProgress((value) => Math.min(92, value + 16)),
      300,
    );
    window.setTimeout(() => {
      window.clearInterval(timer);
      setSyncProgress(100);
      setSyncing(false);
    }, 1900);
  }

  async function reconcileSelected() {
    const movement = movements.find((item) => item.id === selectedMovement);
    const document = documents.find((item) => item.id === selectedDocument);
    if (!movement || !document) return;
    const allocated = Math.min(
      Math.abs(movement.amount),
      document.totalAmount - document.allocatedAmount,
    );
    const category: MovementCategory =
      document.direction === "sale" ? "sale" : "purchase";
    const taxableAmount = suggestedTaxableAmount(
      { ...movement, category },
      document,
    );
    if (process.env.NEXT_PUBLIC_SUPABASE_URL) {
      const response = await fetch("/api/reconcile", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          companyId: company.id,
          movementId: movement.id,
          documentId: document.id,
          amount: allocated,
          category,
          taxableAmount,
          documentNumber: document.folio,
          documentType: document.documentType,
          issuerRut:
            document.direction === "sale"
              ? company.rut
              : document.counterpartyRut,
        }),
      });
      if (!response.ok) return;
    }
    setMovements((items) =>
      items.map((item) =>
        item.id === movement.id
          ? {
              ...item,
              reconciled: true,
              category,
              taxableAmount,
              documentNumber: document.folio,
              documentType: document.documentType,
              issuerRut:
                document.direction === "sale"
                  ? company.rut
                  : document.counterpartyRut,
            }
          : item,
      ),
    );
    setDocuments((items) =>
      items.map((item) =>
        item.id === document.id
          ? {
              ...item,
              allocatedAmount: item.allocatedAmount + allocated,
              status:
                item.allocatedAmount + allocated >= item.totalAmount
                  ? "settled"
                  : "partial",
            }
          : item,
      ),
    );
    setSelectedDocument(null);
  }

  async function closePeriod(forced: boolean, forceReason?: string) {
    if (process.env.NEXT_PUBLIC_SUPABASE_URL) {
      const response = await fetch("/api/close", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          companyId: company.id,
          period,
          openingBalance,
          closingBalance: openingBalance + totals.cashBalance,
          totals,
          forced,
          forceReason,
        }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error ?? "No se pudo cerrar el período");
      }
      const result = await response.json();
      setClosureVersion(Number(result.version));
    } else {
      setClosureVersion(Math.max(1, closureVersion + 1));
    }
    setPeriodClosed(true);
  }

  async function reopenPeriod(reason: string) {
    if (process.env.NEXT_PUBLIC_SUPABASE_URL) {
      const response = await fetch("/api/reopen", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ companyId: company.id, period, reason }),
      });
      if (!response.ok) throw new Error("No se pudo reabrir el período");
    }
    setPeriodClosed(false);
  }

  async function addManual(form: FormData) {
    const parsed = parseManualForm(form);
    const movement: CashMovement = {
      id: crypto.randomUUID(),
      companyId: company.id,
      // Un movimiento manual es solo flujo del libro, no una conciliación
      // bancaria: no se pide ni depende de ninguna cuenta. El servidor
      // resuelve una cuenta de caja implícita al guardar.
      accountId: "",
      period,
      source: "manual",
      reconciled: true,
      createdOrder: `z-${Date.now()}`,
      ...parsed,
    };
    if (process.env.NEXT_PUBLIC_SUPABASE_URL)
      await persistMovements(company.id, [movement]);
    setMovements((items) => [...items, movement]);
    setManualOpen(false);
    router.refresh();
  }

  async function updateManual(id: string, form: FormData) {
    const parsed = parseManualForm(form);
    if (process.env.NEXT_PUBLIC_SUPABASE_URL) {
      const response = await fetch(`/api/movements/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ companyId: company.id, ...parsed }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error ?? "No se pudo actualizar el movimiento");
      }
    }
    setMovements((items) =>
      items.map((item) => (item.id === id ? { ...item, ...parsed } : item)),
    );
    setEditingMovement(null);
    router.refresh();
  }

  const filteredMovements = movements.filter(
    (movement) =>
      (accountFilter === "all" || movement.accountId === accountFilter) &&
      (movementFilter === "all" ||
        (movementFilter === "pending"
          ? !movement.reconciled
          : movement.reconciled)),
  );
  const filteredDocuments = documents.filter(
    (document) =>
      document.status !== "settled" &&
      `${document.counterpartyName} ${document.counterpartyRut} ${document.folio}`
        .toLowerCase()
        .includes(documentQuery.toLowerCase()),
  );
  const activeMovement = movements.find(
    (movement) => movement.id === selectedMovement,
  );
  const selectedDoc = documents.find(
    (document) => document.id === selectedDocument,
  );

  return (
    <main className="workspace">
      <section className="workspace-head">
        <div className="workspace-company">
          <Link
            href="/cartera"
            className="back-link"
            aria-label="Volver a cartera"
          >
            <ArrowLeft size={17} />
          </Link>
          <span className="company-monogram tint-1">CL</span>
          <div>
            <p className="eyebrow">Empresa seleccionada</p>
            <h1>{company.name}</h1>
            <span>
              {company.rut} ·{" "}
              {company.regime === "transparent"
                ? "Pro Pyme Transparente"
                : "Pro Pyme General simplificado"}
            </span>
          </div>
        </div>
        <div className="period-picker">
          <button aria-label="Período anterior" onClick={() => changePeriod(-1)}>
            <ArrowLeft size={15} />
          </button>
          <span>
            <CalendarDays size={16} />
            <b>{periodLabel(period)}</b>
            <small>Período de trabajo</small>
          </span>
          <button aria-label="Período siguiente" onClick={() => changePeriod(1)}>
            <ArrowRight size={15} />
          </button>
        </div>
        <div className={`period-state ${periodClosed ? "closed" : ""}`}>
          {periodClosed ? <LockKeyhole size={16} /> : <CircleDot size={16} />}
          <span>
            <small>Estado del período</small>
            <b>{periodClosed ? "Cerrado" : "En preparación"}</b>
          </span>
        </div>
      </section>

      <div className="workspace-body">
      <aside className="workspace-sidebar">
        <p className="sidebar-label">Mesa mensual</p>
        <nav className="workspace-nav" aria-label="Secciones del libro">
        {stages.map((item) => {
          const Icon = item.icon;
          return (
          <button
            key={item.id}
            className={stage === item.id ? "active" : ""}
            onClick={() => setStage(item.id)}
          >
            <Icon size={17} />
            <span>
              <b>{item.label}</b>
              <small>{item.caption}</small>
            </span>
          </button>
          );
        })}
        </nav>
        <div className="sidebar-status">
          <small>Libro actual</small>
          <b>{periodClosed ? "Versión cerrada" : "Borrador de trabajo"}</b>
          {!periodClosed && <span>{pendingCount} pendiente{pendingCount === 1 ? "" : "s"} por resolver</span>}
        </div>
      </aside>
      <div className="workspace-content">
      {stage === "sources" && (
        <button
          className="button secondary settings-fab"
          onClick={() => setSettingsOpen(true)}
        >
          <KeyRound size={16} /> Cambiar clave SII
        </button>
      )}

      {stage === "sources" && (
        <Sources
          company={company}
          syncing={syncing}
          syncProgress={syncProgress}
          syncError={syncError}
          syncRcv={syncRcv}
          openSettings={() => setSettingsOpen(true)}
          openRcvImport={() => setRcvImportOpen(true)}
          documents={documents}
        />
      )}
      {stage === "reconcile" && (
        <section className="reconcile-stage">
          <div className="stage-title-row">
            <div>
              <p className="eyebrow">Mesa de trabajo</p>
              <h2>Conciliar movimientos</h2>
              <p>
                Confirma qué documento explica cada cobro o pago. Nada se asume
                automáticamente.
              </p>
            </div>
            <div className="stage-actions">
              <button
                className="button secondary"
                onClick={() => setManualOpen(true)}
              >
                <Plus size={16} /> Movimiento manual
              </button>
              <button
                className="button primary"
                onClick={() => setStage("review")}
              >
                Abrir libro <ArrowRight size={16} />
              </button>
            </div>
          </div>
          <div className="reconcile-summary">
            <span>
              <b>{movements.length}</b> movimientos del período
            </span>
            <span className="pending">
              <b>{pendingCount}</b> requieren atención
            </span>
            <span>
              <b>{documents.filter((d) => d.status === "pending").length}</b>{" "}
              documentos RCV pendientes
            </span>
            <span className="balance">
              <small>Saldo proyectado</small>
              <b>{clp.format(totals.cashBalance)}</b>
            </span>
          </div>
          <div className="reconcile-grid">
            <section className="work-panel movements-panel">
              <div className="panel-heading">
                <div>
                  <Landmark size={17} />
                  <b>Movimientos de caja</b>
                </div>
                <select
                  value={accountFilter}
                  onChange={(e) => setAccountFilter(e.target.value)}
                >
                  <option value="all">Todas las cuentas</option>
                  {company.accounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="segmented">
                {(["pending", "all", "done"] as const).map((value) => (
                  <button
                    key={value}
                    className={movementFilter === value ? "active" : ""}
                    onClick={() => setMovementFilter(value)}
                  >
                    {value === "pending"
                      ? "Pendientes"
                      : value === "done"
                        ? "Conciliados"
                        : "Todos"}
                  </button>
                ))}
              </div>
              <div className="movement-list">
                {filteredMovements.map((movement) => (
                  <button
                    key={movement.id}
                    className={`movement-row ${selectedMovement === movement.id ? "selected" : ""}`}
                    onClick={() => setSelectedMovement(movement.id)}
                  >
                    <span
                      className={`movement-icon ${movement.operationType === 1 ? "income" : movement.operationType === 2 ? "expense" : "opening"}`}
                    >
                      {movement.operationType === 1 ? (
                        <ArrowDownLeft size={16} />
                      ) : movement.operationType === 2 ? (
                        <ArrowUpRight size={16} />
                      ) : (
                        <WalletCards size={16} />
                      )}
                    </span>
                    <span className="movement-copy">
                      <b>{movement.description}</b>
                      <small>
                        {formatDate(movement.occurredOn)} ·{" "}
                        {movement.reference || "Sin referencia"}
                      </small>
                    </span>
                    <span
                      className={`movement-amount ${movement.operationType === 1 ? "income" : ""}`}
                    >
                      <b>
                        {movement.operationType === 2 ? "−" : "+"}
                        {clp.format(Math.abs(movement.amount))}
                      </b>
                      <small>
                        {movement.reconciled ? (
                          <>
                            <CheckCircle2 size={12} /> Conciliado
                          </>
                        ) : (
                          <>
                            <AlertCircle size={12} /> Pendiente
                          </>
                        )}
                      </small>
                    </span>
                  </button>
                ))}
              </div>
            </section>
            <section className="work-panel document-panel">
              <div className="panel-heading">
                <div>
                  <FileCheck2 size={17} />
                  <b>Documentos por cobrar o pagar</b>
                </div>
                <span>{filteredDocuments.length} abiertos</span>
              </div>
              <label className="mini-search">
                <Search size={15} />
                <input
                  value={documentQuery}
                  onChange={(e) => setDocumentQuery(e.target.value)}
                  placeholder="Buscar RUT, folio o contraparte"
                />
              </label>
              {activeMovement && (
                <div className="match-hint">
                  <Sparkles size={15} />
                  <span>
                    Ordenados por coincidencia con{" "}
                    <b>{activeMovement.description}</b>
                  </span>
                </div>
              )}
              <div className="document-list">
                {filteredDocuments.map((document) => {
                  const difference = activeMovement
                    ? Math.abs(
                        Math.abs(activeMovement.amount) -
                          (document.totalAmount - document.allocatedAmount),
                      )
                    : Infinity;
                  const score =
                    difference === 0
                      ? "Coincidencia exacta"
                      : difference < 10000
                        ? "Monto cercano"
                        : null;
                  return (
                    <button
                      key={document.id}
                      className={`document-row ${selectedDocument === document.id ? "selected" : ""}`}
                      onClick={() => setSelectedDocument(document.id)}
                    >
                      <span className={`doc-direction ${document.direction}`}>
                        {document.direction === "sale" ? "C" : "P"}
                      </span>
                      <span className="doc-main">
                        <span>
                          <b>{document.counterpartyName}</b>
                          {score && <em>{score}</em>}
                        </span>
                        <small>
                          {document.documentType} · Folio {document.folio} ·{" "}
                          {formatDate(document.issuedOn)}
                        </small>
                        <small>{document.counterpartyRut}</small>
                      </span>
                      <span className="doc-amount">
                        <b>
                          {clp.format(
                            document.totalAmount - document.allocatedAmount,
                          )}
                        </b>
                        {document.status === "partial" && (
                          <small>
                            Abono {clp.format(document.allocatedAmount)}
                          </small>
                        )}
                      </span>
                    </button>
                  );
                })}
              </div>
              {!filteredDocuments.length && (
                <div className="panel-empty">
                  <FileCheck2 size={22} />
                  <b>Sin documentos pendientes</b>
                  <span>Todos los documentos visibles están conciliados.</span>
                </div>
              )}
            </section>
          </div>
          <div
            className={`reconcile-dock ${activeMovement && selectedDoc ? "ready" : ""}`}
          >
            <div>
              {activeMovement ? (
                <>
                  <span
                    className={`movement-icon ${activeMovement.operationType === 1 ? "income" : "expense"}`}
                  >
                    {activeMovement.operationType === 1 ? (
                      <ArrowDownLeft size={15} />
                    ) : (
                      <ArrowUpRight size={15} />
                    )}
                  </span>
                  <span>
                    <small>Movimiento seleccionado</small>
                    <b>
                      {activeMovement.description} ·{" "}
                      {clp.format(Math.abs(activeMovement.amount))}
                    </b>
                  </span>
                </>
              ) : (
                <span>Selecciona un movimiento</span>
              )}
            </div>
            <span className="dock-link">
              <Link2 size={17} />
            </span>
            <div>
              {selectedDoc ? (
                <>
                  <span className={`doc-direction ${selectedDoc.direction}`}>
                    {selectedDoc.direction === "sale" ? "C" : "P"}
                  </span>
                  <span>
                    <small>Documento seleccionado</small>
                    <b>
                      Folio {selectedDoc.folio} ·{" "}
                      {clp.format(
                        selectedDoc.totalAmount - selectedDoc.allocatedAmount,
                      )}
                    </b>
                  </span>
                </>
              ) : (
                <span>Selecciona un documento</span>
              )}
            </div>
            <button
              className="button primary"
              disabled={!activeMovement || !selectedDoc}
              onClick={reconcileSelected}
            >
              <Link2 size={16} /> Conciliar
            </button>
          </div>
        </section>
      )}
      {stage === "review" && (
        <Review
          company={company}
          period={period}
          ledger={ledger}
          totals={totals}
          documents={documents}
          movements={movements}
          excludedPendingCount={pendingCount}
          openManual={() => setManualOpen(true)}
          onEditManual={(movement) => setEditingMovement(movement)}
          goClose={() => setStage("close")}
        />
      )}
      {stage === "close" && (
        <CloseStage
          company={company}
          period={period}
          movements={movements}
          documents={documents}
          ledger={ledger}
          totals={totals}
          validation={closeValidation}
          openingBalance={openingBalance}
          openingBalanceCarried={openingBalanceCarried}
          openingConfirmed={openingConfirmed}
          setOpeningConfirmed={setOpeningConfirmed}
          closed={periodClosed}
          version={closureVersion}
          onClose={closePeriod}
          onReopen={reopenPeriod}
        />
      )}

      {importOpen && (
        <ImportModal
          company={company}
          period={period}
          onClose={() => setImportOpen(false)}
          onImport={async (newMovements) => {
            if (process.env.NEXT_PUBLIC_SUPABASE_URL)
              await persistMovements(company.id, newMovements);
            setMovements((current) => [...current, ...newMovements]);
            setImportOpen(false);
            setStage("reconcile");
          }}
        />
      )}
      {rcvImportOpen && (
        <SiiRcvImportModal
          company={company}
          period={period}
          onClose={() => setRcvImportOpen(false)}
          onImported={() => {
            setRcvImportOpen(false);
            setStage("review");
            router.refresh();
          }}
        />
      )}
      {(manualOpen || editingMovement) && (
        <ManualModal
          period={period}
          movement={editingMovement}
          onClose={() => {
            setManualOpen(false);
            setEditingMovement(null);
          }}
          onSubmit={
            editingMovement
              ? (form) => updateManual(editingMovement.id, form)
              : addManual
          }
        />
      )}
      {settingsOpen && (
        <CompanySetupModal
          company={company}
          hasSiiCredential={company.hasSiiCredential ?? false}
          onClose={() => setSettingsOpen(false)}
          onSaved={() => {
            setSettingsOpen(false);
            router.refresh();
          }}
        />
      )}
      </div>
      </div>
    </main>
  );
}

function Sources({
  company,
  syncing,
  syncProgress,
  syncError,
  syncRcv,
  openSettings,
  openRcvImport,
  documents,
}: {
  company: Company;
  syncing: boolean;
  syncProgress: number;
  syncError: string | null;
  syncRcv: () => void;
  openSettings: () => void;
  openRcvImport: () => void;
  documents: RcvDocument[];
}) {
  const [showDocuments, setShowDocuments] = useState(false);
  const purchaseDocuments = documents.filter((document) => document.direction === "purchase");
  const saleDocuments = documents.filter((document) => document.direction === "sale");
  const electronicPayments = saleDocuments.filter((document) => document.documentCode === 48);
  const electronicPaymentTotal = electronicPayments.reduce((sum, document) => sum + document.totalAmount, 0);
  return (
    <section className="content-stage">
      <div className="stage-title-row">
        <div>
          <p className="eyebrow">Origen de información</p>
          <h2>Fuentes del período</h2>
          <p>
            El libro se arma con documentos tributarios y evidencia real de
            cobros y pagos.
          </p>
        </div>
      </div>
      <div className="source-grid">
        <article className="source-card">
          <div className="source-card-head">
            <span className="source-icon sii">SII</span>
            <span className={`status-pill ${company.hasSiiCredential ? "ok" : "progress"}`}>
              {company.hasSiiCredential ? "Lista" : "Pendiente"}
            </span>
          </div>
          <h3>Registro de Compras y Ventas</h3>
          <p>Importa los CSV detallados descargados desde el SII. También puedes extraerlos si la credencial SII está configurada.</p>
          <div className="source-stats">
            <span>
              <b>{saleDocuments.length - electronicPayments.length}</b>
              <small>Ventas DTE</small>
            </span>
            <span>
              <b>{documents.filter((document) => document.direction === "purchase").length}</b>
              <small>Compras</small>
            </span>
            <span>
              <b>{documents.length}</b>
              <small>Documentos</small>
            </span>
          </div>
          {electronicPayments.length > 0 && (
            <div className="electronic-payment-callout">
              <span>Código 48 · pagos electrónicos SII</span>
              <b>{clp.format(electronicPaymentTotal)}</b>
              <small>Una venta centralizada mensual. No es factura, boleta ni movimiento bancario individual.</small>
            </div>
          )}
          <button className="button primary wide" onClick={openRcvImport}>
            <Upload size={16} /> Importar CSV del SII
          </button>
          {documents.length > 0 && (
            <button className="button secondary wide" onClick={() => setShowDocuments((visible) => !visible)} aria-expanded={showDocuments}>
              <FileCheck2 size={16} /> {showDocuments ? "Ocultar" : "Ver"} detalle extraído ({documents.length})
            </button>
          )}
          {company.hasSiiCredential && (syncing ? (
            <div className="sync-progress">
              <span>
                <LoaderCircle className="spin" size={16} /> Consultando SII…{" "}
                <b>{syncProgress}%</b>
              </span>
              <i style={{ width: `${syncProgress}%` }} />
            </div>
          ) : (
            <button className="button secondary wide" onClick={syncRcv}>
              <RefreshCw size={16} /> Extraer RCV ahora
            </button>
          ))}
          {!company.hasSiiCredential && <button className="text-button" onClick={openSettings}><KeyRound size={14} /> Configurar extracción automática SII</button>}
          {syncError && <p className="form-error" role="alert">{syncError}</p>}
          <small className="source-note">La carga CSV es la fuente principal y evita depender de la sesión SII.</small>
        </article>
      </div>
      <div className="source-principle">
        <ShieldCheck size={19} />
        <span>
          <b>Origen del libro</b>
          <small>
            Ventas DTE son facturas, boletas y notas del RCV. El código 48 es un único resumen mensual de pagos electrónicos del SII; ambos generan flujo 1. Las compras generan flujo 2.
          </small>
        </span>
      </div>
      {showDocuments && (
        <section className="rcv-audit" aria-label="Detalle RCV extraído desde SII">
          <div className="rcv-audit-head">
            <div>
              <p className="eyebrow">Auditoría de origen</p>
              <h3>Detalle RCV extraído desde SII</h3>
              <p>Estas son las líneas originales que alimentan el Libro Anexo 3. No son movimientos bancarios ni una conciliación.</p>
            </div>
            <div className="rcv-audit-counts">
              <span><b>{saleDocuments.length}</b> ventas</span>
              <span><b>{purchaseDocuments.length}</b> compras</span>
            </div>
          </div>
          <div className="rcv-audit-table-wrap">
            <table className="rcv-audit-table">
              <thead>
                <tr>
                  <th>Origen</th><th>Tipo DTE</th><th>Folio</th><th>Contraparte</th><th>RUT</th><th>Fecha</th><th>Neto</th><th>IVA</th><th>Total</th>
                </tr>
              </thead>
              <tbody>
                {documents
                  .slice()
                  .sort((a, b) => b.issuedOn.localeCompare(a.issuedOn) || a.folio.localeCompare(b.folio))
                  .map((document) => (
                    <tr key={document.id}>
                      <td><span className={`rcv-direction ${document.direction}`}>{document.direction === "sale" ? "Venta" : "Compra"}</span></td>
                      <td>{document.documentCode} · {document.documentType}</td>
                      <td>{document.folio}</td>
                      <td>{document.counterpartyName}</td>
                      <td>{document.counterpartyRut || "—"}</td>
                      <td>{formatDate(document.issuedOn)}</td>
                      <td className="numeric">{clp.format(document.netAmount)}</td>
                      <td className="numeric">{clp.format(document.vatAmount)}</td>
                      <td className="numeric strong">{clp.format(document.totalAmount)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </section>
  );
}

function Review({
  company,
  period,
  ledger,
  totals,
  documents,
  movements,
  excludedPendingCount,
  openManual,
  onEditManual,
  goClose,
}: {
  company: Company;
  period: string;
  ledger: ReturnType<typeof buildLedger>;
  totals: ReturnType<typeof calculateTotals>;
  documents: RcvDocument[];
  movements: CashMovement[];
  excludedPendingCount: number;
  openManual: () => void;
  onEditManual: (movement: CashMovement) => void;
  goClose: () => void;
}) {
  const [exportOpen, setExportOpen] = useState(false);
  return (
    <section className="content-stage review-stage">
      <div className="stage-title-row">
        <div>
          <p className="eyebrow">Vista legal</p>
          <h2>Revisión del libro detallado</h2>
          <p>Columnas C1–C9 y totales exigidos por el formato SII.</p>
        </div>
        <div className="stage-actions">
          <button className="button secondary" onClick={openManual}>
            <Plus size={16} /> Agregar movimiento
          </button>
          <div className={`export-menu ${exportOpen ? "open" : ""}`}>
            <button className="button secondary" onClick={() => setExportOpen((open) => !open)} aria-expanded={exportOpen}>
              <Download size={16} /> Exportar borrador <ChevronDown size={14} />
            </button>
            <div className="export-popover">
              <button
                onClick={() => { exportExcel(company, period, ledger, documents); setExportOpen(false); }}
              >
                Excel completo
              </button>
              <button onClick={() => { exportPdf(company, period, ledger); setExportOpen(false); }}>
                PDF detallado
              </button>
              <button onClick={() => { exportCsv(company, period, ledger); setExportOpen(false); }}>
                CSV detallado
              </button>
              <button
                onClick={() => { exportCsv(company, period, ledger, 1, "daily"); setExportOpen(false); }}
              >
                CSV resumen diario
              </button>
            </div>
          </div>
          <button className="button primary" onClick={goClose}>
            Ir al cierre <ArrowRight size={16} />
          </button>
        </div>
      </div>
      <div className="legal-banner">
        <span>BORRADOR</span>
        <div>
          <b>{company.name}</b>
          <small>
            {company.rut} · {periodLabel(period)} · Versión 1
          </small>
        </div>
        <div>
          <small>Formato</small>
          <b>Libro de Caja detallado</b>
        </div>
      </div>
      {excludedPendingCount > 0 && (
        <div className="draft-notice">
          <AlertCircle size={16} />
          <span><b>{excludedPendingCount} movimiento{excludedPendingCount === 1 ? "" : "s"} pendiente{excludedPendingCount === 1 ? "" : "s"}</b> no figura{excludedPendingCount === 1 ? "" : "n"} en este borrador hasta que se clasifique{excludedPendingCount === 1 ? "" : "n"}.</span>
        </div>
      )}
      <div className="ledger-wrap">
        <table className="ledger-table">
          <thead>
            <tr>
              <th>
                C1
                <br />
                <span>N°</span>
              </th>
              <th>
                C2
                <br />
                <span>Operación</span>
              </th>
              <th>
                C3
                <br />
                <span>Documento</span>
              </th>
              <th>
                C4
                <br />
                <span>Tipo</span>
              </th>
              <th>
                C5
                <br />
                <span>RUT emisor</span>
              </th>
              <th>
                C6
                <br />
                <span>Fecha</span>
              </th>
              <th>
                C7
                <br />
                <span>Glosa</span>
              </th>
              <th>
                C8
                <br />
                <span>Monto flujo</span>
              </th>
              <th>
                C9
                <br />
                <span>Base imponible</span>
              </th>
              <th aria-label="Acciones" />
            </tr>
          </thead>
          <tbody>
            {ledger.map((row) => {
              const movement = movements.find((m) => m.id === row.movementId);
              const editable =
                movement?.source === "manual" &&
                movement.id !== OPENING_BALANCE_MOVEMENT_ID;
              return (
                <tr key={row.movementId}>
                  <td>{row.correlation}</td>
                  <td>
                    <span className={`op-code op-${row.operationType}`}>
                      {row.operationType}
                    </span>
                  </td>
                  <td>{row.documentNumber || "—"}</td>
                  <td>{row.documentType}</td>
                  <td>{row.issuerRut || "—"}</td>
                  <td>{formatDate(row.occurredOn)}</td>
                  <td>{row.description}</td>
                  <td className="numeric">{clp.format(row.flowAmount)}</td>
                  <td className="numeric">{clp.format(row.taxableAmount)}</td>
                  <td>
                    {editable && (
                      <button
                        type="button"
                        className="row-edit"
                        aria-label={`Editar ${row.description}`}
                        title="Editar movimiento manual"
                        onClick={() => onEditManual(movement)}
                      >
                        <Pencil size={14} />
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="totals-grid">
        <article>
          <small>C10 · Total ingresos</small>
          <b>{clp.format(totals.incomeFlow)}</b>
        </article>
        <article>
          <small>C11 · Total egresos</small>
          <b>{clp.format(totals.expenseFlow)}</b>
        </article>
        <article className="strong">
          <small>C12 · Saldo flujo de caja</small>
          <b>{clp.format(totals.cashBalance)}</b>
        </article>
        <article>
          <small>C13 · Ingresos base</small>
          <b>{clp.format(totals.taxableIncome)}</b>
        </article>
        <article>
          <small>C14 · Egresos base</small>
          <b>{clp.format(totals.taxableExpense)}</b>
        </article>
        <article className="strong">
          <small>C15 · Resultado neto</small>
          <b>{clp.format(totals.netResult)}</b>
        </article>
      </div>
    </section>
  );
}

function CloseStage({
  company,
  period,
  movements,
  documents,
  ledger,
  totals,
  validation,
  openingBalance,
  openingBalanceCarried,
  openingConfirmed,
  setOpeningConfirmed,
  closed,
  version,
  onClose,
  onReopen,
}: {
  company: Company;
  period: string;
  movements: CashMovement[];
  documents: RcvDocument[];
  ledger: ReturnType<typeof buildLedger>;
  totals: ReturnType<typeof calculateTotals>;
  validation: ReturnType<typeof validateClose>;
  openingBalance: number;
  openingBalanceCarried: boolean;
  openingConfirmed: boolean;
  setOpeningConfirmed: (value: boolean) => void;
  closed: boolean;
  version: number;
  onClose: (forced: boolean, forceReason?: string) => Promise<void>;
  onReopen: (reason: string) => Promise<void>;
}) {
  const [forceReason, setForceReason] = useState("");
  const [closing, setClosing] = useState(false);
  const [closeError, setCloseError] = useState("");
  const [reopenReason, setReopenReason] = useState("");

  async function submitClose() {
    setClosing(true);
    setCloseError("");
    try {
      await onClose(
        !validation.canClose,
        validation.canClose ? undefined : forceReason.trim(),
      );
    } catch (err) {
      setCloseError(
        err instanceof Error
          ? err.message
          : "No se pudo cerrar el período. Revisa la conexión e inténtalo nuevamente.",
      );
    } finally {
      setClosing(false);
    }
  }
  if (closed)
    return (
      <section className="content-stage close-success">
        <span className="success-seal">
          <LockKeyhole size={30} />
        </span>
        <p className="eyebrow">Período protegido</p>
        <h2>{periodLabel(period)} quedó cerrado</h2>
        <p>
          Se creó la versión {version} del libro. Los datos quedan inmutables y
          cualquier reapertura generará una nueva versión auditada.
        </p>
        <div className="closed-summary">
          <span>
            <small>Saldo final</small>
            <b>{clp.format(totals.cashBalance)}</b>
          </span>
          <span>
            <small>Movimientos</small>
            <b>{movements.length}</b>
          </span>
          <span>
            <small>Huella</small>
            <b>v{version}</b>
          </span>
        </div>
        <div className="stage-actions">
          <button
            className="button secondary"
            onClick={() =>
              exportExcel(
                company,
                period,
                ledger,
                documents,
                version,
                "CERRADO",
              )
            }
          >
            Descargar Excel
          </button>
          <button
            className="button primary"
            onClick={() =>
              exportPdf(company, period, ledger, version, "CERRADO")
            }
          >
            Descargar PDF firmado
          </button>
        </div>
        <label className="force-field">
          Motivo para reabrir
          <textarea
            value={reopenReason}
            onChange={(event) => setReopenReason(event.target.value)}
            placeholder="Describe la corrección que se realizará…"
          />
        </label>
        <button
          className="button secondary"
          disabled={closing || reopenReason.trim().length < 12}
          onClick={async () => {
            setClosing(true);
            setCloseError("");
            try {
              await onReopen(reopenReason.trim());
            } catch {
              setCloseError("No se pudo reabrir el período.");
            } finally {
              setClosing(false);
            }
          }}
        >
          Reabrir y crear nueva versión
        </button>
        {closeError && <span className="login-error">{closeError}</span>}
      </section>
    );
  return (
    <section className="content-stage close-stage">
      <div className="stage-title-row">
        <div>
          <p className="eyebrow">Control de integridad</p>
          <h2>Cerrar {periodLabel(period)}</h2>
          <p>
            El cierre congela esta versión y traspasa el saldo final al mes
            siguiente.
          </p>
        </div>
      </div>
      <div className="close-layout">
        <section className="validation-card">
          <h3>Validaciones del período</h3>
          {openingBalanceCarried ? (
            <div className="validation-row">
              <span className="check-ok">
                <Check size={15} />
              </span>
              <span>
                <b>Continuidad del saldo inicial</b>
                <small>
                  Se traspasó automáticamente desde el cierre del período
                  anterior.
                </small>
              </span>
              <b>{clp.format(openingBalance)}</b>
            </div>
          ) : (
            <button
              className="validation-row"
              onClick={() => setOpeningConfirmed(!openingConfirmed)}
            >
              <span className={openingConfirmed ? "check-ok" : "check-bad"}>
                {openingConfirmed ? <Check size={15} /> : <X size={15} />}
              </span>
              <span>
                <b>Continuidad del saldo inicial</b>
                <small>
                  {openingConfirmed
                    ? "Saldo inicial configurado en las cuentas de la empresa."
                    : "Confirma el saldo inicial configurado antes de cerrar."}
                </small>
              </span>
              <b>{clp.format(openingBalance)}</b>
            </button>
          )}
          {validation.blockers
            .filter((b) => b.code !== "opening")
            .map((blocker) => (
              <div className="validation-row" key={blocker.code}>
                <span className="check-bad">
                  <AlertCircle size={15} />
                </span>
                <span>
                  <b>{blocker.label}</b>
                  <small>
                    Requiere revisión o una justificación de cierre forzado.
                  </small>
                </span>
                <b>{blocker.count}</b>
              </div>
            ))}
          {validation.blockers.length === 0 && (
            <div className="validation-row">
              <span className="check-ok">
                <Check size={15} />
              </span>
              <span>
                <b>Movimientos y documentos conciliados</b>
                <small>No quedan excepciones que impidan el cierre.</small>
              </span>
              <b>OK</b>
            </div>
          )}
        </section>
        <aside className="close-card">
          <p className="eyebrow">Resumen final</p>
          <h3>Versión {Math.max(1, version + 1)}</h3>
          <dl>
            <div>
              <dt>Saldo inicial</dt>
              <dd>{clp.format(openingBalance)}</dd>
            </div>
            <div>
              <dt>Flujo de ingresos</dt>
              <dd>{clp.format(totals.incomeFlow)}</dd>
            </div>
            <div>
              <dt>Flujo de egresos</dt>
              <dd>−{clp.format(totals.expenseFlow)}</dd>
            </div>
            <div className="total">
              <dt>Saldo de caja</dt>
              <dd>{clp.format(totals.cashBalance)}</dd>
            </div>
          </dl>
          {!validation.canClose && (
            <label className="force-field">
              Justificación para cierre forzado
              <textarea
                value={forceReason}
                onChange={(e) => setForceReason(e.target.value)}
                placeholder="Explica por qué se cierra con excepciones…"
              />
            </label>
          )}
          <button
            className="button primary wide"
            disabled={
              closing ||
              (!validation.canClose && forceReason.trim().length < 12)
            }
            onClick={submitClose}
          >
            {closing ? (
              <LoaderCircle className="spin" size={16} />
            ) : (
              <LockKeyhole size={16} />
            )}{" "}
            {closing
              ? "Cerrando…"
              : validation.canClose
                ? "Cerrar período"
                : "Cerrar con excepción"}
          </button>
          {closeError && <span className="login-error">{closeError}</span>}
          <small className="immutable-note">
            <ShieldCheck size={14} /> El cierre queda registrado en la
            auditoría.
          </small>
        </aside>
      </div>
    </section>
  );
}

function SiiRcvImportModal({
  company,
  period,
  onClose,
  onImported,
}: {
  company: Company;
  period: string;
  onClose: () => void;
  onImported: () => void;
}) {
  const purchaseRef = useRef<HTMLInputElement>(null);
  const saleRef = useRef<HTMLInputElement>(null);
  const [purchase, setPurchase] = useState<SiiRcvFile | null>(null);
  const [sale, setSale] = useState<SiiRcvFile | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function select(file: File | undefined, expected: "purchase" | "sale") {
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      const parsed = await parseSiiRcvFile(file, period);
      if (parsed.direction !== expected)
        throw new Error(expected === "purchase" ? "Selecciona el CSV de Compras del SII." : "Selecciona el CSV de Ventas del SII.");
      if (expected === "purchase") setPurchase(parsed);
      else setSale(parsed);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo leer el archivo.");
    } finally {
      setBusy(false);
    }
  }

  async function submit() {
    if (!purchase || !sale) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/rcv/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          companyId: company.id,
          period,
          files: [
            { filename: purchase.filename, direction: purchase.direction },
            { filename: sale.filename, direction: sale.direction },
          ],
          documents: [...purchase.documents, ...sale.documents],
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "No se pudo importar el RCV.");
      onImported();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo importar el RCV.");
    } finally {
      setBusy(false);
    }
  }

  const total = (purchase?.documents.length ?? 0) + (sale?.documents.length ?? 0);
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal-card compact" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <div>
            <p className="eyebrow">Fuente principal</p>
            <h2>Importar RCV detallado</h2>
            <p>Sube los dos CSV descargados desde el SII para {periodLabel(period)}.</p>
          </div>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <div className="form-stack sii-import-stack">
          <SiiFileSlot
            label="Libro de Compras"
            hint="Archivo RCV_COMPRA_REGISTRO"
            file={purchase}
            inputRef={purchaseRef}
            busy={busy}
            onSelect={(file) => select(file, "purchase")}
          />
          <SiiFileSlot
            label="Libro de Ventas"
            hint="Archivo RCV_VENTA"
            file={sale}
            inputRef={saleRef}
            busy={busy}
            onSelect={(file) => select(file, "sale")}
          />
          {total > 0 && <div className="sii-import-summary"><b>{total} documentos detectados</b><span>{purchase?.documents.length ?? 0} compras · {sale?.documents.length ?? 0} ventas</span></div>}
          {error && <p className="form-error" role="alert">{error}</p>}
        </div>
        <div className="modal-actions">
          <button className="button secondary" onClick={onClose}>Cancelar</button>
          <button className="button primary" disabled={!purchase || !sale || busy} onClick={submit}>
            {busy ? <LoaderCircle className="spin" size={16} /> : <FileCheck2 size={16} />} Importar y generar libro
          </button>
        </div>
      </div>
    </div>
  );
}

function SiiFileSlot({ label, hint, file, inputRef, busy, onSelect }: {
  label: string;
  hint: string;
  file: SiiRcvFile | null;
  inputRef: RefObject<HTMLInputElement | null>;
  busy: boolean;
  onSelect: (file?: File) => void;
}) {
  return <div className={`sii-file-slot ${file ? "loaded" : ""}`} onClick={() => inputRef.current?.click()}>
    <input ref={inputRef} type="file" accept=".csv,text/csv" hidden onChange={(event) => onSelect(event.target.files?.[0])} />
    <FileSpreadsheet size={20} />
    <span><b>{file ? file.filename : label}</b><small>{file ? `${file.documents.length} documentos reconocidos${file.skipped ? ` · ${file.skipped} sin monto omitidos` : ""}` : hint}</small></span>
    <button type="button" className="button secondary" disabled={busy}>{file ? "Cambiar" : "Seleccionar"}</button>
  </div>;
}

function ImportModal({
  company,
  period,
  onClose,
  onImport,
}: {
  company: Company;
  period: string;
  onClose: () => void;
  onImport: (movements: CashMovement[]) => Promise<void> | void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [tabular, setTabular] = useState<TabularFile | null>(null);
  const [mapping, setMapping] = useState<ImportMapping | null>(null);
  const [filename, setFilename] = useState("");
  const [accountId, setAccountId] = useState(
    company.accounts.find((a) => a.kind === "bank")?.id ?? "",
  );
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  async function chooseFile(file?: File) {
    if (!file) return;
    setFilename(file.name);
    setBusy(true);
    try {
      const data = await readTabularFile(file);
      setTabular(data);
      setMapping(suggestMapping(data.headers));
    } catch (error) {
      setErrors([
        error instanceof Error ? error.message : "No se pudo leer el archivo",
      ]);
    } finally {
      setBusy(false);
    }
  }
  async function importRows() {
    if (!tabular || !mapping) return;
    setBusy(true);
    const result = await mapBankRows(tabular.rows, mapping);
    setErrors(result.errors);
    if (!result.rows.length) {
      setBusy(false);
      return;
    }
    await onImport(
      result.rows.map((row) => ({
        id: crypto.randomUUID(),
        companyId: company.id,
        accountId,
        period,
        operationType: row.amount > 0 ? 1 : 2,
        occurredOn: row.date,
        description: row.description,
        reference: row.reference,
        amount: row.amount,
        taxableAmount: 0,
        source: "bank",
        reconciled: false,
        createdOrder: `import-${row.rowNumber}`,
        issuerRut: row.counterpartyRut,
      })),
    );
    setBusy(false);
  }
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        className="modal-card import-modal"
        role="dialog"
        aria-modal="true"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <div>
            <p className="eyebrow">Importación segura</p>
            <h2>Importar cartola bancaria</h2>
            <p>Revisa la estructura antes de crear movimientos.</p>
          </div>
          <button className="modal-close" onClick={onClose}>
            ×
          </button>
        </div>
        {!tabular ? (
          <div
            className="upload-zone"
            onClick={() => fileRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              chooseFile(e.dataTransfer.files[0]);
            }}
          >
            <input
              ref={fileRef}
              type="file"
              accept=".csv,.xlsx,.xls"
              hidden
              onChange={(e) => chooseFile(e.target.files?.[0])}
            />
            {busy ? (
              <LoaderCircle className="spin" size={26} />
            ) : (
              <Upload size={26} />
            )}
            <b>Arrastra una cartola o selecciónala</b>
            <span>CSV, XLSX o XLS · máximo 10 MB</span>
            <button type="button" className="button secondary" onClick={() => fileRef.current?.click()}>
              Seleccionar archivo
            </button>
          </div>
        ) : (
          <>
            <div className="import-filebar">
              <FileSpreadsheet size={19} />
              <span>
                <b>{filename}</b>
                <small>
                  {tabular.rows.length} filas detectadas · Hoja{" "}
                  {tabular.selectedSheet}
                </small>
              </span>
              <button
                onClick={() => {
                  setTabular(null);
                  setMapping(null);
                }}
              >
                Cambiar
              </button>
            </div>
            <div className="mapping-grid">
              <label>
                Cuenta de destino
                <select
                  value={accountId}
                  onChange={(e) => setAccountId(e.target.value)}
                >
                  {company.accounts
                    .filter((a) => a.kind === "bank")
                    .map((a) => (
                      <option value={a.id} key={a.id}>
                        {a.name} · {a.bank}
                      </option>
                    ))}
                </select>
              </label>
              <MapSelect
                label="Fecha"
                value={mapping?.date ?? ""}
                headers={tabular.headers}
                onChange={(value) => setMapping({ ...mapping!, date: value })}
              />
              <MapSelect
                label="Descripción / glosa"
                value={mapping?.description ?? ""}
                headers={tabular.headers}
                onChange={(value) =>
                  setMapping({ ...mapping!, description: value })
                }
              />
              <MapSelect
                label="Monto con signo"
                value={mapping?.amount ?? ""}
                headers={tabular.headers}
                optional
                onChange={(value) => setMapping({ ...mapping!, amount: value })}
              />
              <MapSelect
                label="Cargos"
                value={mapping?.debit ?? ""}
                headers={tabular.headers}
                optional
                onChange={(value) => setMapping({ ...mapping!, debit: value })}
              />
              <MapSelect
                label="Abonos"
                value={mapping?.credit ?? ""}
                headers={tabular.headers}
                optional
                onChange={(value) => setMapping({ ...mapping!, credit: value })}
              />
            </div>
            <div className="preview-table">
              <table>
                <thead>
                  <tr>
                    {tabular.headers.slice(0, 5).map((h) => (
                      <th key={h}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {tabular.rows.slice(0, 4).map((row, i) => (
                    <tr key={i}>
                      {tabular.headers.slice(0, 5).map((h) => (
                        <td key={h}>{String(row[h] ?? "")}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {errors.length > 0 && (
              <div className="import-errors">
                <AlertCircle size={16} />
                <span>
                  {errors.slice(0, 2).join(" ")}
                  {errors.length > 2 ? ` y ${errors.length - 2} más.` : ""}
                </span>
              </div>
            )}
          </>
        )}
        <div className="modal-actions">
          <button className="button secondary" onClick={onClose}>
            Cancelar
          </button>
          <button
            className="button primary"
            disabled={
              !tabular ||
              busy ||
              !mapping?.date ||
              !mapping?.description ||
              (!mapping?.amount && !mapping?.debit && !mapping?.credit)
            }
            onClick={importRows}
          >
            {busy ? (
              <LoaderCircle className="spin" size={16} />
            ) : (
              <Upload size={16} />
            )}{" "}
            Importar movimientos
          </button>
        </div>
      </div>
    </div>
  );
}

function MapSelect({
  label,
  value,
  headers,
  onChange,
  optional,
}: {
  label: string;
  value: string;
  headers: string[];
  onChange: (value: string) => void;
  optional?: boolean;
}) {
  return (
    <label>
      {label}
      {optional && <small>Opcional</small>}
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">No asignar</option>
        {headers.map((header) => (
          <option key={header}>{header}</option>
        ))}
      </select>
    </label>
  );
}

function ManualModal({
  period,
  movement,
  onClose,
  onSubmit,
}: {
  period: string;
  movement?: CashMovement | null;
  onClose: () => void;
  onSubmit: (form: FormData) => void | Promise<void>;
}) {
  const editing = Boolean(movement);
  const [amount, setAmount] = useState(
    movement ? String(Math.abs(movement.amount)) : "",
  );
  const [category, setCategory] = useState<MovementCategory>(
    movement?.category ?? "tax",
  );
  const [documentKind, setDocumentKind] = useState<ManualDocumentKind | "">(
    (Object.entries(manualDocumentKindLabels).find(
      ([, label]) => label === movement?.documentType,
    )?.[0] as ManualDocumentKind | undefined) ?? "",
  );
  const [affectsIva, setAffectsIva] = useState(
    !movement || movement.taxableAmount !== Math.abs(movement.amount),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const needsDocumentKind = category === "purchase" || category === "sale";
  const needsIvaToggle =
    needsDocumentKind && category === "sale" && documentKind === "sin_documento";
  const previewTaxable = manualTaxableAmount(
    category,
    documentKind,
    Number(amount) || 0,
    affectsIva,
  );
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        className="modal-card"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <div>
            <p className="eyebrow">Flujo sin cartola</p>
            <h2>{editing ? "Editar movimiento" : "Movimiento manual"}</h2>
            <p>
              {editing
                ? "Corrige el flujo, la cifra o cualquier otro dato del movimiento."
                : "Agrega al libro pagos de IVA, PPM, saldos o cualquier flujo sin RCV."}
            </p>
          </div>
          <button className="modal-close" onClick={onClose}>
            ×
          </button>
        </div>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            try {
              const formData = new FormData(e.currentTarget);
              await onSubmit(formData);
            } catch (err) {
              setError(
                err instanceof Error
                  ? err.message
                  : "No se pudo guardar el movimiento.",
              );
            } finally {
              setBusy(false);
            }
          }}
          className="form-grid cols-3"
        >
          <label>
            Fecha
            <input
              type="date"
              name="date"
              defaultValue={movement?.occurredOn ?? `${period}-20`}
              required
            />
          </label>
          <label>
            Flujo
            <select
              name="operationType"
              defaultValue={movement ? (movement.amount < 0 ? "2" : "1") : "1"}
            >
              <option value="1">Ingreso</option>
              <option value="2">Egreso</option>
            </select>
          </label>
          <label>
            Categoría
            <select
              name="category"
              value={category}
              onChange={(e) => {
                setCategory(e.target.value as MovementCategory);
                setDocumentKind("");
              }}
            >
              <option value="purchase">Compra</option>
              <option value="sale">Venta manual (excepcional, no SII)</option>
              <option value="tax">Pago de impuestos (IVA / PPM)</option>
              <option value="payroll">Remuneraciones o cotizaciones</option>
              <option value="loan">Préstamo</option>
              <option value="capital_contribution">Aporte de capital</option>
              <option value="owner_withdrawal">Retiro del propietario</option>
              <option value="internal_transfer">
                Depósito o giro entre cuentas propias
              </option>
              <option value="refund">Devolución</option>
              <option value="other">Ajuste de caja u otro</option>
            </select>
          </label>
          {needsDocumentKind && (
            <label className="span-2">
              ¿Corresponde a un documento tributario?
              <select
                name="documentKind"
                value={documentKind}
                onChange={(e) =>
                  setDocumentKind(e.target.value as ManualDocumentKind)
                }
                required
              >
                <option value="" disabled>
                  Selecciona una opción
                </option>
                {Object.entries(manualDocumentKindLabels).map(([value, label]) => (
                  <option value={value} key={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          )}
          {needsIvaToggle && (
            <label className="span-2">
              ¿Afecta IVA?
              <select
                name="affectsIva"
                value={affectsIva ? "yes" : "no"}
                onChange={(e) => setAffectsIva(e.target.value === "yes")}
              >
                <option value="yes">Sí</option>
                <option value="no">No</option>
              </select>
            </label>
          )}
          <label className="span-2">
            Glosa
            <input
              name="description"
              required
              defaultValue={movement?.description ?? ""}
              placeholder="Descripción clara del movimiento"
            />
          </label>
          <label>
            Monto total
            <input
              type="number"
              min="1"
              name="amount"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              required
            />
          </label>
          <label>
            Monto base imponible
            <input
              type="text"
              readOnly
              disabled
              value={clp.format(previewTaxable)}
            />
            <small>
              {needsDocumentKind
                ? "Se calcula sola según el tipo de documento."
                : "Este flujo no genera base imponible."}
            </small>
          </label>
          {error && <span className="login-error span-2">{error}</span>}
          <div className="modal-actions span-2">
            <button
              type="button"
              className="button secondary"
              disabled={busy}
              onClick={onClose}
            >
              Cancelar
            </button>
            <button
              className="button primary"
              disabled={busy || (needsDocumentKind && !documentKind)}
            >
              {busy ? <LoaderCircle className="spin" size={16} /> : null}{" "}
              {busy
                ? "Guardando…"
                : editing
                  ? "Guardar cambios"
                  : "Guardar movimiento"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function CompanySetupModal({
  company,
  hasSiiCredential,
  onClose,
  onSaved,
}: {
  company: Company;
  hasSiiCredential: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function save(form: FormData) {
    setBusy(true);
    setError("");
    try {
      if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
        onSaved();
        return;
      }
      const password = String(form.get("siiPassword") ?? "");
      if (password) {
        const credentialResponse = await fetch(
          `/api/companies/${company.id}/credentials`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ password }),
          },
        );
        if (!credentialResponse.ok) throw new Error("credential failed");
      }
      onSaved();
    } catch {
      setError("No se pudo guardar la clave SII.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        className="modal-card compact"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <div>
            <p className="eyebrow">Configuración privada</p>
            <h2>Cambiar clave SII</h2>
            <p>La clave se cifra antes de guardarse y solo se usa para extraer el RCV.</p>
          </div>
          <button className="modal-close" onClick={onClose}>
            ×
          </button>
        </div>
        <form action={save} className="form-grid">
          <label className="span-2">
            Clave SII
            <input name="siiPassword" type="password" autoComplete="new-password" required={!hasSiiCredential} placeholder="Ingresa o reemplaza la clave SII" />
            <small>Déjala vacía para conservar la clave ya guardada.</small>
          </label>
          {error && <span className="login-error span-2">{error}</span>}
          <div className="modal-actions span-2">
            <button
              type="button"
              className="button secondary"
              onClick={onClose}
            >
              Cancelar
            </button>
            <button className="button primary" disabled={busy}>
              {busy ? (
                <LoaderCircle className="spin" size={16} />
              ) : (
                <ShieldCheck size={16} />
              )}{" "}
              Guardar y volver a Fuentes
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function parseManualForm(form: FormData) {
  const amount = Math.abs(Number(form.get("amount") ?? 0));
  const operationType = Number(form.get("operationType")) as 1 | 2;
  const category = String(form.get("category")) as MovementCategory;
  const documentKind = String(form.get("documentKind") ?? "") as
    | ManualDocumentKind
    | "";
  const affectsIva = form.get("affectsIva") !== "no";
  // Base imponible según reglas del contador (INGRESO_MANUAL.pdf): solo
  // compras/ventas con documento tributario generan base; el resto es $0.
  const taxableAmount = manualTaxableAmount(
    category,
    documentKind,
    amount,
    affectsIva,
  );
  return {
    operationType,
    category,
    occurredOn: String(form.get("date")),
    description: String(form.get("description")),
    amount: operationType === 2 ? -amount : amount,
    taxableAmount,
    documentType: documentKind
      ? manualDocumentKindLabels[documentKind]
      : undefined,
  };
}

async function persistMovements(companyId: string, movements: CashMovement[]) {
  const rows = movements.map((movement) => ({
    accountId: movement.accountId || undefined,
    period: movement.period,
    operationType: movement.operationType,
    occurredOn: movement.occurredOn,
    description: movement.description,
    reference: movement.reference,
    amount: movement.amount,
    taxableAmount: movement.taxableAmount,
    category: movement.category,
    documentType: movement.documentType,
    source: movement.source,
    reconciled: movement.reconciled,
    issuerRut: movement.issuerRut,
    fingerprint:
      movement.source === "bank"
        ? `${movement.occurredOn}|${movement.amount}|${movement.description}|${movement.reference ?? ""}`
        : undefined,
  }));
  const response = await fetch("/api/movements", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ companyId, rows }),
  });
  if (!response.ok) throw new Error("No se pudieron guardar los movimientos");
}
