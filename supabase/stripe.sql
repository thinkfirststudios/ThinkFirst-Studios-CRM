-- ═══════════════════════════════════════════════════════════════════
--  ThinkFirst Studios CRM — Stripe mirror
--
--  Run AFTER schema.sql, in the Supabase SQL Editor. Idempotent.
--
--  Stripe is the source of truth for money. These tables are a read-only
--  mirror maintained by the stripe-sync Edge Function. Nobody in the CRM
--  can write to them: there are SELECT policies for the team and no
--  INSERT/UPDATE/DELETE policies at all, so only the service role (which
--  bypasses RLS, and which only the Edge Function holds) can fill them.
--  That way a bug in the app can never make the CRM disagree with Stripe.
-- ═══════════════════════════════════════════════════════════════════

-- ── Link a CRM customer to its Stripe customer ─────────────────────
-- Empty means "not billed through Stripe" — those keep using the manual
-- billingDate / value fields and are shown as such.
alter table public.customers
  add column if not exists "stripeCustomerId" text not null default '';

create index if not exists customers_stripe_idx
  on public.customers ("stripeCustomerId") where "stripeCustomerId" <> '';


-- ── Invoices ───────────────────────────────────────────────────────
-- Amounts are stored in the smallest currency unit (cents), exactly as
-- Stripe reports them. Converting on the way in would invite rounding
-- drift between the CRM and Stripe.
create table if not exists public.stripe_invoices (
  id                 text primary key,          -- Stripe invoice id, in_...
  "stripeCustomerId" text not null default '',
  "customerId"       text not null default '',  -- CRM customer id, '' if unlinked
  number             text not null default '',
  status             text not null default '',  -- draft|open|paid|uncollectible|void
  "amountDueCents"   bigint not null default 0,
  "amountPaidCents"  bigint not null default 0,
  "amountRemainingCents" bigint not null default 0,
  currency           text not null default 'usd',
  description        text not null default '',
  "dueDate"          text not null default '',  -- 'YYYY-MM-DD'
  "periodStart"      text not null default '',
  "periodEnd"        text not null default '',
  "hostedInvoiceUrl" text not null default '',
  "invoicePdf"       text not null default '',
  "createdAt"        timestamptz,
  "paidAt"           timestamptz,
  "syncedAt"         timestamptz not null default now()
);

create index if not exists stripe_invoices_customer_idx on public.stripe_invoices ("customerId");
create index if not exists stripe_invoices_status_idx   on public.stripe_invoices (status);
create index if not exists stripe_invoices_due_idx      on public.stripe_invoices ("dueDate");


-- ── Subscriptions ──────────────────────────────────────────────────
create table if not exists public.stripe_subscriptions (
  id                    text primary key,       -- sub_...
  "stripeCustomerId"    text not null default '',
  "customerId"          text not null default '',
  status                text not null default '', -- active|past_due|canceled|trialing|unpaid
  "amountCents"         bigint not null default 0,
  currency              text not null default 'usd',
  interval              text not null default '',  -- month|year|week|day
  "intervalCount"       integer not null default 1,
  description           text not null default '',  -- the plan/product names
  "currentPeriodStart"  text not null default '',
  "currentPeriodEnd"    text not null default '',
  "cancelAtPeriodEnd"   boolean not null default false,
  "createdAt"           timestamptz,
  "syncedAt"            timestamptz not null default now()
);

create index if not exists stripe_subs_customer_idx on public.stripe_subscriptions ("customerId");
create index if not exists stripe_subs_status_idx   on public.stripe_subscriptions (status);


-- ── Sync bookkeeping ───────────────────────────────────────────────
-- So the CRM can say "synced 4 minutes ago" rather than leaving you to
-- guess whether the mirror is current.
create table if not exists public.stripe_sync_state (
  id            text primary key default 'stripe',
  "lastSyncAt"  timestamptz,
  "lastEventAt" timestamptz,
  "lastError"   text not null default '',
  "invoiceCount"      integer not null default 0,
  "subscriptionCount" integer not null default 0,
  "linkedCount"       integer not null default 0
);

insert into public.stripe_sync_state (id) values ('stripe') on conflict (id) do nothing;


-- ── RLS: the team reads, only the Edge Function writes ─────────────
do $$
declare t text;
begin
  foreach t in array array['stripe_invoices','stripe_subscriptions','stripe_sync_state'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "team_read" on public.%I', t);
    execute format(
      'create policy "team_read" on public.%I for select to authenticated using (true)', t);
    -- deliberately NO insert/update/delete policies: the mirror is
    -- writable only by the service role, which bypasses RLS entirely.
  end loop;
end $$;


-- ── Realtime ───────────────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['stripe_invoices','stripe_subscriptions','stripe_sync_state'] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;


-- ── Convenience view: what does each customer actually owe? ────────
-- Not used by the app (which reads the tables directly so realtime
-- works), but handy when poking around in the SQL editor.
create or replace view public.customer_billing_health as
select
  c.id,
  c.name,
  c."stripeCustomerId" <> '' as "onStripe",
  count(i.id) filter (where i.status = 'open')          as "openInvoices",
  coalesce(sum(i."amountRemainingCents")
           filter (where i.status = 'open'), 0)         as "outstandingCents",
  max(i."paidAt")                                       as "lastPaidAt",
  bool_or(i.status = 'open' and i."dueDate" <> ''
          and i."dueDate" < to_char(now(), 'YYYY-MM-DD')) as "hasOverdue"
from public.customers c
left join public.stripe_invoices i on i."customerId" = c.id
group by c.id, c.name, c."stripeCustomerId";
