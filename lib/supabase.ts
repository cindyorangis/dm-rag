import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL!;
const supabasePublishableKey = process.env.SUPABASE_PUBLISHABLE_KEY!;

// Client for browser-side (RLS enabled)
export const supabase = createClient(supabaseUrl, supabasePublishableKey);

// Client for scripts/server-side (Admin/bypass RLS)
const supabaseServiceRole = process.env.SUPABASE_SERVICE_ROLE_KEY!;
export const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRole);