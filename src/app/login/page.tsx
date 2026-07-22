"use client";
import { useState } from "react";
import { BookOpenText, KeyRound, LoaderCircle, ShieldCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const [email, setEmail] = useState(""); const [sent, setSent] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  async function submit(event: React.FormEvent) { event.preventDefault(); setBusy(true); setError(""); try { const supabase = createClient(); const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: `${location.origin}/auth/callback` } }); if (error) throw error; setSent(true); } catch { setError("No se pudo enviar el acceso. Verifica la configuración."); } finally { setBusy(false); } }
  return <main className="login-page"><section className="login-card"><span className="login-brand"><BookOpenText size={22} /></span><p className="eyebrow">Acceso privado</p><h1>Caja Clara</h1><p>Libros de Caja preparados con evidencia, conciliación y trazabilidad.</p>{sent ? <div className="login-sent"><ShieldCheck size={25} /><b>Revisa tu correo</b><span>Enviamos un enlace de acceso que vence en pocos minutos.</span></div> : <form onSubmit={submit}><label>Correo autorizado<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus placeholder="contador@estudio.cl" /></label>{error && <span className="login-error">{error}</span>}<button className="button primary wide" disabled={busy}>{busy ? <LoaderCircle className="spin" size={16} /> : <KeyRound size={16} />} Enviar enlace de acceso</button></form>}<small><ShieldCheck size={13} /> Solo la cuenta autorizada puede ingresar.</small></section></main>;
}

