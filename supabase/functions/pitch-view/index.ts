/* ═══════════════════════════════════════════════════════════════════
   pitch-view — records an open of a private pitch page.

     POST {"industry":"Automotive","lead":"l_1","at":"2026-09-29T…"}

   Called by navigator.sendBeacon from the pages under
   thinkfirststudios.com/p/. The caller is a PROSPECT'S browser, not a
   signed-in teammate, so this endpoint is deliberately unauthenticated
   — deploy it with --no-verify-jwt.

   That means anyone can post to it. What that buys an attacker is a
   fake view count on a lead, which is why this function can do exactly
   one thing: insert a row into pitch_views. It cannot read a lead, it
   cannot read the pitch pages, and the trigger on pitch_views is the
   only thing that touches the leads table. The blast radius of abuse is
   a wrong number on a sales card.

   Run supabase/pitch-views.sql first — this writes to a table and two
   columns that it creates.

   Deploy:
     supabase functions deploy pitch-view --no-verify-jwt

   Then put the function URL in the website repo's
   tools/pitch-manifest.json as "viewEndpoint" and rebuild the pages.
   Supabase injects SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY itself.
   ═══════════════════════════════════════════════════════════════════ */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const env = (name: string) => (Deno.env.get(name) ?? '').trim();

const db = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), {
  auth: { persistSession: false }
});

/* The pages are served from the marketing domain, so the browser
   preflights anything that is not a simple request. sendBeacon with a
   Blob of type application/json is NOT simple, hence the OPTIONS arm. */
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

/* A view is worth almost nothing individually, so nothing here is worth
   an error on a prospect's screen. Every failure answers 204 and the
   page never knows. */
const ok = () => new Response(null, { status: 204, headers: CORS });

/* Bounds, because this endpoint is open to the internet and a text
   column with no ceiling is an invitation. */
const clip = (v: unknown, n: number) => String(v ?? '').slice(0, n);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return ok();

  try {
    const body = await req.json();

    /* An industry is the minimum useful fact — without it the row
       cannot be grouped and is just noise. */
    const industry = clip(body.industry, 80);
    if (!industry) return ok();

    await db.from('pitch_views').insert({
      industry,
      /* Not validated against the leads table on purpose: an unknown id
         costs one orphan row, while a lookup would double the work on
         every open and give this function read access it does not need.
         The trigger's UPDATE simply matches nothing. */
      leadId: clip(body.lead, 64),
      viewedAt: new Date().toISOString(),
      referrer: clip(req.headers.get('referer'), 300),
      userAgent: clip(req.headers.get('user-agent'), 300)
    });
  } catch (_e) {
    /* Malformed JSON, a database hiccup — all the same answer. */
  }

  return ok();
});
