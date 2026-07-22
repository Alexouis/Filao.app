import { createClient } from '@supabase/supabase-js';

// These environment variables should be defined in your deployment environment
// For local development, they can be set in a .env file prefixed with VITE_
const supabaseUrl = (import.meta as any).env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = (import.meta as any).env.VITE_SUPABASE_ANON_KEY || '';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);