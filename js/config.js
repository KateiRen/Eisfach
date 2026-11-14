// Öffentliche Projektwerte; niemals einen Service-Role- oder Secret-Key eintragen.
export const SUPABASE_URL = 'https://kktdnddbqpdgfnyuslxb.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_bH86GwzU8tTWaFtkr5MVog_-CPMGquF';
export const configured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
