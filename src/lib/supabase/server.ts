import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function createClient() {
  const cookieStore = await cookies();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Supabase no está configurado");
  return createServerClient(url, key, {
    db: { schema: "libro_caja" },
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          );
        } catch {
          // Server Components cannot write cookies. The proxy refreshes them.
        }
      },
    },
  });
}

export async function requireUser() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return { id: "demo-user", email: "contador@demo.local" };
  }
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) throw new Error("UNAUTHORIZED");
  const allowedEmail = process.env.ALLOWED_USER_EMAIL?.toLowerCase();
  if (!allowedEmail) throw new Error("ALLOWED_USER_EMAIL_NOT_CONFIGURED");
  if (data.user.email?.toLowerCase() !== allowedEmail)
    throw new Error("FORBIDDEN");
  return data.user;
}
