import { createClient, SupabaseClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || "";
const secretKey = process.env.SUPABASE_SECRET_KEY || "";

// Standard client for the browser/frontend
export const supabase = (
  supabaseUrl && publishableKey
    ? createClient(supabaseUrl, publishableKey)
    : null
) as SupabaseClient; // Cast to the specific interface instead of any

// Admin client for the server (bypasses RLS)
export const supabaseAdmin = (
  supabaseUrl && secretKey
    ? createClient(supabaseUrl, secretKey, {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
      })
    : null
) as SupabaseClient;
