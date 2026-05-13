import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  // Keep this loud in development so deployment setup failures are obvious.
  // The user will paste the real values later.
  console.warn("Supabase env vars missing: VITE_SUPABASE_URL and/or VITE_SUPABASE_ANON_KEY");
}

export const supabase = createClient(supabaseUrl ?? "https://placeholder.supabase.co", supabaseAnonKey ?? "placeholder", {
  realtime: {
    params: {
      eventsPerSecond: 8
    }
  }
});
