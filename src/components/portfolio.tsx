"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import {
  ArrowRight,
  ChevronDown,
  KeyRound,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import { periodLabel } from "@/lib/format";
import type { Company } from "@/lib/types";

export function Portfolio({
  initialCompanies,
}: {
  initialCompanies: Company[];
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");
  const [companies, setCompanies] = useState(initialCompanies);
  const [companyToDelete, setCompanyToDelete] = useState<Company | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const filtered = useMemo(
    () =>
      companies.filter((company) =>
        `${company.name} ${company.rut}`
          .toLowerCase()
          .includes(query.toLowerCase()),
      ),
    [companies, query],
  );

  async function addCompany(formData: FormData) {
    const name = String(formData.get("name") ?? "").trim();
    const rut = String(formData.get("rut") ?? "").trim();
    if (!name || !rut) return;
    const siiPassword = String(formData.get("siiPassword") ?? "").trim();
    const draft = {
      name,
      rut,
      regime: String(formData.get("regime")) as Company["regime"],
    };
    setCreateError("");
    setCreating(true);
    try {
      const response = await fetch("/api/companies", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(draft),
      });
      if (!response.ok) throw new Error("No se pudo crear la empresa.");
      const { company } = await response.json();
      if (siiPassword) {
        const credentialResponse = await fetch(
          `/api/companies/${company.id}/credentials`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ password: siiPassword }),
          },
        );
        // La empresa ya quedó creada aunque falle guardar la clave; se puede
        // configurar después desde "Configurar SII y cuentas".
        company.hasSiiCredential = credentialResponse.ok;
      }
      setCompanies((current) => [...current, company]);
      router.push(`/empresa/${company.id}/${company.currentPeriod}`);
    } catch (error) {
      setCreateError(
        error instanceof Error ? error.message : "No se pudo crear la empresa.",
      );
      return;
    } finally {
      setCreating(false);
    }
    setDialogOpen(false);
  }

  async function deleteCompany() {
    if (!companyToDelete) return;
    setDeleting(true);
    setDeleteError("");
    try {
      const response = await fetch(`/api/companies/${companyToDelete.id}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error ?? "delete failed");
      }
      setCompanies((current) =>
        current.filter((company) => company.id !== companyToDelete.id),
      );
      setCompanyToDelete(null);
    } catch (error) {
      setDeleteError(
        error instanceof Error
          ? error.message
          : "No se pudo eliminar. Intenta nuevamente.",
      );
    } finally {
      setDeleting(false);
    }
  }

  return (
    <main className="page page-portfolio">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Gestión mensual</p>
          <h1>Cartera de empresas</h1>
          <p>Continúa exactamente donde quedó cada libro.</p>
        </div>
        <button className="button primary" onClick={() => setDialogOpen(true)}>
          <Plus size={17} /> Nueva empresa
        </button>
      </div>

      <section className="portfolio-panel">
        <div className="table-toolbar">
          <label className="search-field">
            <Search size={17} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Buscar por empresa o RUT"
            />
          </label>
          <div className="toolbar-right">
            <span>{filtered.length} empresas</span>
          </div>
        </div>
        <div className="portfolio-table-wrap">
          <table className="portfolio-table">
            <thead>
              <tr>
                <th>Empresa</th>
                <th>Régimen</th>
                <th>Período de trabajo</th>
                <th>Estado</th>
                <th>Próxima acción</th>
                <th aria-label="Abrir" />
                <th aria-label="Eliminar" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((company, index) => {
                const needsSetup = company.accounts.length === 0;
                const isBehind =
                  company.lastClosedPeriod &&
                  company.lastClosedPeriod < "2026-05";
                return (
                  <tr key={company.id}>
                    <td>
                      <Link
                        href={`/empresa/${company.id}/${company.currentPeriod}`}
                        className="company-cell"
                      >
                        <span
                          className={`company-monogram tint-${(index % 3) + 1}`}
                        >
                          {company.name.slice(0, 2).toUpperCase()}
                        </span>
                        <span>
                          <b>{company.name}</b>
                          <small>{company.rut}</small>
                        </span>
                      </Link>
                    </td>
                    <td>
                      <button
                        className="row-delete"
                        aria-label={`Eliminar ${company.name}`}
                        title={`Eliminar ${company.name}`}
                        onClick={() => setCompanyToDelete(company)}
                      >
                        <Trash2 size={16} />
                      </button>
                    </td>
                    <td>
                      <span className="regime-label">
                        {company.regime === "transparent"
                          ? "Pro Pyme Transparente"
                          : "Pro Pyme General"}
                      </span>
                      <small className="cell-note">
                        Contabilidad simplificada
                      </small>
                    </td>
                    <td>
                      <b className="period-name">
                        {periodLabel(company.currentPeriod)}
                      </b>
                      <small className="cell-note">
                        Último cierre:{" "}
                        {company.lastClosedPeriod
                          ? periodLabel(company.lastClosedPeriod)
                          : "Sin cierres"}
                      </small>
                    </td>
                    <td>
                      {needsSetup ? (
                        <span className="status-pill setup">Configuración</span>
                      ) : isBehind ? (
                        <span className="status-pill warning">Con atraso</span>
                      ) : (
                        <span className="status-pill progress">
                          En preparación
                        </span>
                      )}
                    </td>
                    <td>
                      <span className="next-action">
                        {needsSetup ? (
                          <KeyRound size={15} />
                        ) : (
                          <span className="action-dot" />
                        )}
                        {needsSetup
                          ? "Conectar SII y cuentas"
                          : isBehind
                            ? "Revisar meses pendientes"
                            : "Conciliar movimientos"}
                      </span>
                    </td>
                    <td>
                      <Link
                        className="row-arrow"
                        aria-label={`Abrir ${company.name}`}
                        href={`/empresa/${company.id}/${company.currentPeriod}`}
                      >
                        <ArrowRight size={18} />
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!filtered.length && (
            <div className="empty-state">
              <Search size={22} />
              <b>No encontramos empresas</b>
              <span>Prueba otra búsqueda o agrega una nueva empresa.</span>
            </div>
          )}
        </div>
      </section>
      <aside className="portfolio-footnote">
        <span className="shield-dot" /> Acceso privado · La clave SII se cifra
        para esta aplicación y nunca vuelve a mostrarse.
      </aside>

      {dialogOpen && (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={() => setDialogOpen(false)}
        >
          <div
            className="modal-card compact"
            role="dialog"
            aria-modal="true"
            aria-labelledby="new-company"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="modal-header">
              <div>
                <p className="eyebrow">Nueva empresa</p>
                <h2 id="new-company">Agregar empresa</h2>
                <p>La clave SII se cifra antes de guardarse; puedes dejarla en blanco y configurarla después.</p>
              </div>
              <button
                className="modal-close"
                onClick={() => setDialogOpen(false)}
              >
                ×
              </button>
            </div>
            <form action={addCompany} className="form-stack">
              <label>
                Razón social
                <input name="name" required autoFocus placeholder="Ej. Comercial Lago Sur SpA" />
              </label>
              <label>
                RUT
                <input name="rut" required placeholder="12.345.678-9" />
              </label>
              <label>
                Régimen
                <select name="regime" defaultValue="transparent">
                  <option value="transparent">Pro Pyme Transparente</option>
                  <option value="general_simplified">
                    Pro Pyme General — contabilidad simplificada
                  </option>
                </select>
                <ChevronDown size={15} />
              </label>
              <label>
                Clave SII <small>(opcional, para extraer el RCV automático)</small>
                <input
                  name="siiPassword"
                  type="password"
                  autoComplete="new-password"
                  placeholder="Clave del portal SII"
                />
              </label>
              {createError && (
                <span className="login-error">{createError}</span>
              )}
              <div className="modal-actions">
                <button
                  type="button"
                  className="button secondary"
                  disabled={creating}
                  onClick={() => setDialogOpen(false)}
                >
                  Cancelar
                </button>
                <button className="button primary" disabled={creating}>
                  {creating ? "Creando…" : "Crear empresa"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {companyToDelete && (
        <div className="modal-backdrop" onMouseDown={() => !deleting && setCompanyToDelete(null)}>
          <div className="modal-card compact" role="dialog" aria-modal="true" aria-labelledby="delete-company" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <div>
                <p className="eyebrow">Acción irreversible</p>
                <h2 id="delete-company">Eliminar empresa</h2>
                <p>Se eliminará <b>{companyToDelete.name}</b> y todos sus datos de Caja Clara.</p>
              </div>
              <button className="modal-close" aria-label="Cancelar" disabled={deleting} onClick={() => setCompanyToDelete(null)}>×</button>
            </div>
            <div className="form-stack">
              <div className="delete-warning">
                Incluye credencial SII cifrada, cuentas, RCV, cartolas, movimientos, conciliaciones y cierres. No afecta PlusContable.
              </div>
              {deleteError && <span className="login-error">{deleteError}</span>}
              <div className="modal-actions">
                <button type="button" className="button secondary" disabled={deleting} onClick={() => setCompanyToDelete(null)}>Cancelar</button>
                <button type="button" className="button danger" disabled={deleting} onClick={deleteCompany}>
                  <Trash2 size={16} /> {deleting ? "Eliminando…" : "Eliminar definitivamente"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
