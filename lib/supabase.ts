import dotenv from "dotenv";
dotenv.config({ path: "../.env.local" });

import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabasePublishableKey =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;

if (!supabaseUrl || !supabasePublishableKey) {
  // Throw a clear error if the required environment variables are missing
  throw new Error(
    "Supabase environment variables (SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY) must be set.",
  );
}

// Client for browser-side (RLS enabled)
export const supabase = createClient(supabaseUrl, supabasePublishableKey);

// Client for scripts/server-side (Admin/bypass RLS)
const supabaseServiceRole = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
export const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRole);
