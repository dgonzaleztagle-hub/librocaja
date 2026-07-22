import Link from "next/link";
import { BookOpenText, Building2, CircleHelp, LogOut, Settings } from "lucide-react";

export function AppShell({ children, active = "portfolio" }: { children: React.ReactNode; active?: "portfolio" | "workspace" }) {
  return (
    <div className="app-shell">
      <header className="topbar">
        <Link href="/cartera" className="brand" aria-label="Ir a cartera">
          <span className="brand-mark"><BookOpenText size={19} strokeWidth={2.1} /></span>
          <span><strong>Caja Clara</strong><small>Libros tributarios</small></span>
        </Link>
        <nav className="topnav" aria-label="Navegación principal">
          <Link href="/cartera" className={active === "portfolio" ? "active" : ""}><Building2 size={16} /> Cartera</Link>
        </nav>
        <div className="top-actions">
          <button className="icon-button" aria-label="Ayuda"><CircleHelp size={18} /></button>
          <button className="icon-button" aria-label="Configuración"><Settings size={18} /></button>
          <span className="user-chip"><span>DG</span><b>Contador</b></span>
          <a className="icon-button" href="/auth/signout" aria-label="Cerrar sesión"><LogOut size={17} /></a>
        </div>
      </header>
      {children}
    </div>
  );
}

