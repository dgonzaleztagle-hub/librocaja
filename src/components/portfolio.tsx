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
  SlidersHorizontal,
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
  const [companies, setCompanies] = useState(initialCompanies);
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
    const draft = {
      name,
      rut,
      regime: String(formData.get("regime")) as Company["regime"],
    };
    try {
      const response = await fetch("/api/companies", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(draft),
      });
      if (!response.ok) throw new Error("create failed");
      const { company } = await response.json();
      setCompanies((current) => [...current, company]);
      router.push(`/empresa/${company.id}/${company.currentPeriod}`);
    } catch {
      return;
    }
    setDialogOpen(false);
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
            <button className="button ghost">
              <SlidersHorizontal size={16} /> Filtrar
            </button>
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
                <p>Al crearla irás directo a guardar la clave SII y extraer el RCV.</p>
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
              <div className="modal-actions">
                <button
                  type="button"
                  className="button secondary"
                  onClick={() => setDialogOpen(false)}
                >
                  Cancelar
                </button>
                <button className="button primary">Crear empresa</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </main>
  );
}
