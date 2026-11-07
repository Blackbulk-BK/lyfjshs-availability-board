// js/supabaseClient.js : one shared Supabase client for every page.
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

if (!SUPABASE_URL || !SUPABASE_ANON_KEY || SUPABASE_URL.includes("YOUR-")) {
  throw new Error("Missing Supabase settings. Fill in js/config.js (see js/config.example.js).");
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);