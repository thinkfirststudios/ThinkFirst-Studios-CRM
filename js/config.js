/* ═══════════════════════════════════════════════════════════════════
   config.js — backend selection.

   Leave `url` blank to run entirely offline against localStorage
   (the demo mode: no account, no network, data stays in this browser).

   Fill it in to run the shared, multi-user version on Supabase.

   The key below is the PUBLISHABLE / ANON key. It is designed to ship
   in client code and is safe to commit — every row it can reach is
   governed by the row-level security policies in supabase/schema.sql.
   A `service_role` key is a different thing entirely and must never be
   placed in this file.
   ═══════════════════════════════════════════════════════════════════ */
window.CRM_CONFIG = {
  supabase: {
    url: 'https://xfczbofrfsgumeicjuoy.supabase.co',

    /* Legacy anon JWT — accepted by every version of supabase-js v2. */
    anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhmY3pib2ZyZnNndW1laWNqdW95Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU1MTM1NjcsImV4cCI6MjEwMTA4OTU2N30.Ts17QekB6lj5WFap0KwJjNExGZDJekOH8q6E6rsAyvc'

    /* The newer publishable key for the same project, if you prefer it:
       sb_publishable_osEepmuF2C1SsI9dUeS-iA_3fLqcB74
       Current supabase-js accepts either. */
  }
};
