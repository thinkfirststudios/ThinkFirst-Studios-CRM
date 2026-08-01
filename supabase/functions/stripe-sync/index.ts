/* ═══════════════════════════════════════════════════════════════════
   stripe-sync — mirrors Stripe billing into the CRM.

   Two entry points, one function:

     POST with a `stripe-signature` header  → webhook event
     POST {"action":"backfill"} + admin JWT → pull everything that
                                              already exists in Stripe

   Nothing here ever writes TO Stripe. The API key it uses is restricted
   to read scopes, so the worst a bug can do is show wrong numbers.

   Secrets (Edge Functions → Secrets):
     STRIPE_SECRET_KEY       rk_live_... (read-only restricted key)
     STRIPE_WEBHOOK_SECRET   whsec_...   (added after the endpoint exists)
   Supabase injects SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY itself.
   ═══════════════════════════════════════════════════════════════════ */

import Stripe from 'https://esm.sh/stripe@17.7.0?target=deno';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

/* Trim every secret. Pasting into a multi-line secrets box very easily
   leaves a trailing newline, and a webhook secret with whitespace fails
   signature verification on EVERY event — with an error that reads like
   the payload was tampered with rather than like a config typo. No valid
   Stripe credential has surrounding whitespace, so trimming is safe. */
const env = (name: string) => (Deno.env.get(name) ?? '').trim();

const STRIPE_KEY = env('STRIPE_SECRET_KEY');
const WEBHOOK_SECRET = env('STRIPE_WEBHOOK_SECRET');
const SUPABASE_URL = env('SUPABASE_URL');
const SERVICE_KEY = env('SUPABASE_SERVICE_ROLE_KEY');

const stripe = new Stripe(STRIPE_KEY, { apiVersion: '2025-01-27.acacia' });
const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, stripe-signature',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status, headers: { ...CORS, 'Content-Type': 'application/json' }
  });

/* ── conversions ─────────────────────────────────────────────────── */
const isoOf = (unix?: number | null) =>
  unix ? new Date(unix * 1000).toISOString() : null;
const dayOf = (unix?: number | null) =>
  unix ? new Date(unix * 1000).toISOString().slice(0, 10) : '';
const idOf = (v: unknown): string =>
  typeof v === 'string' ? v : (v && typeof v === 'object' && 'id' in (v as any))
    ? String((v as any).id) : '';

/* ── linking Stripe customers to CRM customers ───────────────────── */
/* Prefer the stored stripeCustomerId. Fall back to an email match once,
   and persist the link so the guess never has to happen again. */
async function resolveCustomerId(stripeCustomerId: string): Promise<string> {
  if (!stripeCustomerId) return '';

  const { data: linked } = await db
    .from('customers').select('id').eq('stripeCustomerId', stripeCustomerId).limit(1);
  if (linked && linked.length) return linked[0].id;

  let email = '';
  try {
    const sc = await stripe.customers.retrieve(stripeCustomerId);
    if (!('deleted' in sc && sc.deleted)) email = (sc.email ?? '').toLowerCase();
  } catch { /* customer may be deleted in Stripe — leave unlinked */ }
  if (!email) return '';

  const { data: byEmail } = await db
    .from('customers').select('id,email,stripeCustomerId').eq('stripeCustomerId', '').limit(200);
  const hit = (byEmail ?? []).find(c => (c.email ?? '').toLowerCase() === email);
  if (!hit) return '';

  await db.from('customers').update({ stripeCustomerId }).eq('id', hit.id);
  return hit.id;
}

/* ── row mapping ─────────────────────────────────────────────────── */
function invoiceRow(inv: Stripe.Invoice, customerId: string) {
  return {
    id: inv.id,
    stripeCustomerId: idOf(inv.customer),
    customerId,
    number: inv.number ?? '',
    status: inv.status ?? '',
    amountDueCents: inv.amount_due ?? 0,
    amountPaidCents: inv.amount_paid ?? 0,
    amountRemainingCents: inv.amount_remaining ?? 0,
    currency: inv.currency ?? 'usd',
    description: inv.description ?? (inv.lines?.data?.[0]?.description ?? ''),
    dueDate: dayOf(inv.due_date) || dayOf(inv.next_payment_attempt),
    periodStart: dayOf(inv.period_start),
    periodEnd: dayOf(inv.period_end),
    hostedInvoiceUrl: inv.hosted_invoice_url ?? '',
    invoicePdf: inv.invoice_pdf ?? '',
    createdAt: isoOf(inv.created),
    paidAt: inv.status === 'paid' ? isoOf(inv.status_transitions?.paid_at ?? inv.created) : null,
    syncedAt: new Date().toISOString()
  };
}

function subscriptionRow(sub: Stripe.Subscription, customerId: string) {
  const item = sub.items?.data?.[0];
  const price = item?.price;
  const names = (sub.items?.data ?? [])
    .map(i => (typeof i.price?.product === 'object' && i.price?.product && 'name' in i.price.product)
      ? String((i.price.product as any).name) : (i.price?.nickname ?? ''))
    .filter(Boolean);

  const perItem = (sub.items?.data ?? []).reduce(
    (sum, i) => sum + ((i.price?.unit_amount ?? 0) * (i.quantity ?? 1)), 0);

  return {
    id: sub.id,
    stripeCustomerId: idOf(sub.customer),
    customerId,
    status: sub.status ?? '',
    amountCents: perItem,
    currency: price?.currency ?? 'usd',
    interval: price?.recurring?.interval ?? '',
    intervalCount: price?.recurring?.interval_count ?? 1,
    description: names.join(', '),
    /* Stripe moved the billing period off the subscription and onto its
       items in the 2026-03-25 API versions. Backfill calls come back in
       the version pinned above (period on the subscription) while webhooks
       arrive in the account's own version (period on the item), so read
       whichever is present rather than assuming one shape. */
    currentPeriodStart: dayOf(
      (sub as any).current_period_start ?? (item as any)?.current_period_start),
    currentPeriodEnd: dayOf(
      (sub as any).current_period_end ?? (item as any)?.current_period_end),
    cancelAtPeriodEnd: !!sub.cancel_at_period_end,
    createdAt: isoOf(sub.created),
    syncedAt: new Date().toISOString()
  };
}

/* ── upserts ─────────────────────────────────────────────────────── */
async function saveInvoice(inv: Stripe.Invoice) {
  const customerId = await resolveCustomerId(idOf(inv.customer));
  const { error } = await db.from('stripe_invoices').upsert(invoiceRow(inv, customerId));
  if (error) throw new Error('invoice ' + inv.id + ': ' + error.message);
}

async function saveSubscription(sub: Stripe.Subscription) {
  const customerId = await resolveCustomerId(idOf(sub.customer));
  const { error } = await db.from('stripe_subscriptions').upsert(subscriptionRow(sub, customerId));
  if (error) throw new Error('subscription ' + sub.id + ': ' + error.message);
}

async function noteSync(patch: Record<string, unknown>) {
  await db.from('stripe_sync_state').upsert({ id: 'stripe', ...patch });
}

async function refreshCounts() {
  const [inv, sub, linked] = await Promise.all([
    db.from('stripe_invoices').select('id', { count: 'exact', head: true }),
    db.from('stripe_subscriptions').select('id', { count: 'exact', head: true }),
    db.from('customers').select('id', { count: 'exact', head: true }).neq('stripeCustomerId', '')
  ]);
  await noteSync({
    invoiceCount: inv.count ?? 0,
    subscriptionCount: sub.count ?? 0,
    linkedCount: linked.count ?? 0
  });
}

/* ── backfill ────────────────────────────────────────────────────── */
/* Walks every invoice and subscription that already exists in Stripe.
   Safe to run repeatedly — everything is an upsert keyed on Stripe ids. */
async function backfill() {
  let invoices = 0, subs = 0;

  /* The list methods are async iterables — `for await` pages automatically. */
  for await (const inv of stripe.invoices.list({ limit: 100 })) {
    await saveInvoice(inv as Stripe.Invoice);
    invoices++;
    if (invoices >= 1000) break;              // sanity stop
  }

  for await (const sub of stripe.subscriptions.list({ limit: 100, status: 'all' })) {
    await saveSubscription(sub as Stripe.Subscription);
    subs++;
    if (subs >= 1000) break;
  }

  await noteSync({ lastSyncAt: new Date().toISOString(), lastError: '' });
  await refreshCounts();
  return { invoices, subscriptions: subs };
}

/* ── the caller must be a CRM admin to trigger a backfill ─────────── */
async function requireAdmin(req: Request): Promise<string | null> {
  const auth = req.headers.get('Authorization') ?? '';
  const token = auth.replace(/^Bearer\s+/i, '');
  if (!token) return 'Missing Authorization header.';

  const { data, error } = await db.auth.getUser(token);
  if (error || !data?.user) return 'Not signed in.';

  const { data: profile } = await db
    .from('profiles').select('role').eq('id', data.user.id).limit(1);
  if (!profile?.length || profile[0].role !== 'admin') return 'Admin role required.';
  return null;
}

/* ── entry point ─────────────────────────────────────────────────── */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  if (!STRIPE_KEY) return json({ error: 'STRIPE_SECRET_KEY is not set.' }, 500);

  const signature = req.headers.get('stripe-signature');

  /* ── webhook ── */
  if (signature) {
    if (!WEBHOOK_SECRET) return json({ error: 'STRIPE_WEBHOOK_SECRET is not set.' }, 500);

    const raw = await req.text();
    let event: Stripe.Event;
    try {
      /* Async variant: Deno has no synchronous crypto for this.
         Without this check anyone could POST a fake "paid" event. */
      event = await stripe.webhooks.constructEventAsync(raw, signature, WEBHOOK_SECRET);
    } catch (err) {
      return json({ error: 'Signature verification failed: ' + (err as Error).message }, 400);
    }

    try {
      switch (event.type) {
        case 'invoice.paid':
        case 'invoice.payment_failed':
        case 'invoice.payment_succeeded':
        case 'invoice.finalized':
        case 'invoice.updated':
        case 'invoice.voided':
        case 'invoice.marked_uncollectible':
          await saveInvoice(event.data.object as Stripe.Invoice);
          break;

        case 'customer.subscription.created':
        case 'customer.subscription.updated':
        case 'customer.subscription.deleted':
        case 'customer.subscription.paused':
        case 'customer.subscription.resumed':
          await saveSubscription(event.data.object as Stripe.Subscription);
          break;

        default:
          return json({ received: true, ignored: event.type });
      }

      await noteSync({ lastEventAt: new Date().toISOString(), lastError: '' });
      await refreshCounts();
      return json({ received: true, type: event.type });
    } catch (err) {
      const message = (err as Error).message;
      await noteSync({ lastError: message });
      /* 500 makes Stripe retry with backoff rather than dropping it. */
      return json({ error: message }, 500);
    }
  }

  /* ── backfill ── */
  let body: any = {};
  try { body = await req.json(); } catch { /* empty body is fine */ }

  if (body.action === 'backfill') {
    const denied = await requireAdmin(req);
    if (denied) return json({ error: denied }, 403);
    try {
      const result = await backfill();
      return json({ ok: true, ...result });
    } catch (err) {
      const message = (err as Error).message;
      await noteSync({ lastError: message });
      return json({ error: message }, 500);
    }
  }

  return json({ error: 'Send {"action":"backfill"} or a signed Stripe webhook.' }, 400);
});
