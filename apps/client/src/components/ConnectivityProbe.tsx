import { useEffect, useState } from "react";
import { supabase } from "../network/supabase";

/** Row shape for `public.connectivity_display` (Dashboard table). */
type ConnectivityDisplayRow = {
  id: number;
  n: number;
};

export function ConnectivityProbe(): JSX.Element {
  const [n, setN] = useState<number | null>(null);
  const [status, setStatus] = useState<"loading" | "ok" | "error">("loading");
  const [diagnostic, setDiagnostic] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const url = import.meta.env.VITE_SUPABASE_URL;
    const anon = import.meta.env.VITE_SUPABASE_ANON_KEY;
    if (!url?.trim() || !anon?.trim()) {
      setDiagnostic(
        "VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY was not set when this bundle was built. In Vercel: Project → Settings → Environment Variables → add both for Production (and Preview if needed) → Redeploy. Names must start with VITE_."
      );
      setStatus("error");
      setN(null);
      return () => {
        cancelled = true;
      };
    }
    if (url.includes("placeholder.supabase.co")) {
      setDiagnostic("Supabase URL is still the placeholder. Set the real project URL in VITE_SUPABASE_URL and redeploy.");
      setStatus("error");
      setN(null);
      return () => {
        cancelled = true;
      };
    }

    // Supabase filter builders are PromiseLike<T>, not Promise<T> — chaining `.catch()` fails tsc (TS2339) on Vercel.
    void (async () => {
      try {
        const { data, error } = await supabase
          .schema("public")
          .from("connectivity_display")
          .select("id,n")
          .eq("id", 1)
          .maybeSingle()
          .returns<ConnectivityDisplayRow>();
        if (cancelled) return;
        if (error) {
          setStatus("error");
          setN(null);
          setDiagnostic(
            [error.message, error.code ? `(${error.code})` : null].filter(Boolean).join(" ")
          );
          return;
        }
        if (data?.n == null) {
          setStatus("error");
          setN(null);
          setDiagnostic(
            "Query succeeded but no row was returned (often RLS: anon cannot SELECT, or no row with id = 1). Run supabase/fix_connectivity_display_anon.sql in the SQL Editor for this project."
          );
          return;
        }
        setDiagnostic(null);
        setN(data.n);
        setStatus("ok");
      } catch (err: unknown) {
        if (cancelled) return;
        setStatus("error");
        setN(null);
        setDiagnostic(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="connectivity-probe" title="Reads public.connectivity_display via PostgREST (anon key)">
      <table className="connectivity-probe__table">
        <caption className="connectivity-probe__caption">Vercel ↔ Supabase (read test)</caption>
        <thead>
          <tr>
            <th scope="col">Value from DB</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              {status === "loading" ? "…" : null}
              {status === "ok" && n != null ? String(n) : null}
              {status === "error" ? "—" : null}
            </td>
          </tr>
        </tbody>
      </table>
      {status === "error" && diagnostic ? <p className="connectivity-probe__diagnostic">{diagnostic}</p> : null}
    </div>
  );
}
