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

  useEffect(() => {
    let cancelled = false;
    void supabase
      .schema("public")
      .from("connectivity_display")
      .select("id,n")
      .eq("id", 1)
      .maybeSingle()
      .returns<ConnectivityDisplayRow>()
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          setStatus("error");
          setN(null);
          return;
        }
        if (data?.n == null) {
          setStatus("error");
          setN(null);
          return;
        }
        setN(data.n);
        setStatus("ok");
      });
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
      {status === "error" ? <p className="connectivity-probe__hint">Run migration and db push; check RLS / anon key.</p> : null}
    </div>
  );
}
