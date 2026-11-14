// Öffentliche Projektwerte; niemals einen Service-Role- oder Secret-Key eintragen.
export const SUPABASE_URL = '';
export const SUPABASE_ANON_KEY = '';
export const configured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
