-- ═══════════════════════════════════════════════════════════════════
--  ThinkFirst Studios CRM — Supabase schema
--
--  Run this once in the Supabase SQL Editor (Dashboard → SQL Editor →
--  New query → paste → Run). It is idempotent: safe to re-run.
--
--  Access model: every signed-in teammate SEES everything.
--  Writes are open to all teammates; deletes and setup tables are
--  restricted to the roles that the UI already gates on.
--
--  Note on column names: columns are quoted camelCase so they match the
--  JavaScript field names exactly. That removes any mapping layer
--  between the app and the database — at the cost of needing double
--  quotes when you hand-write SQL here ("billingDate", not billingdate).
-- ═══════════════════════════════════════════════════════════════════

-- ── 1. Tables ──────────────────────────────────────────────────────
-- Record ids stay TEXT (the app generates 'c_ln4k2p8'-style ids). That
-- means a JSON backup exported from the localStorage version imports
-- straight in with its ids intact.

create table if not exists public.profiles (
  id          text primary key,               -- auth.uid()::text
  name        text not null default '',
  email       text not null default '',
  title       text not null default '',
  role        text not null default 'rep',    -- admin | manager | rep
  active      boolean not null default true,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz
);

create table if not exists public.customers (
  id             text primary key,
  name           text not null default '',
  "contactName"  text not null default '',
  email          text not null default '',
  phone          text not null default '',
  status         text not null default 'new',
  "ownerId"      text not null default '',    -- soft ref to profiles.id
  services       jsonb not null default '[]'::jsonb,
  "billingDate"  text not null default '',    -- 'YYYY-MM-DD'
  "billingCycle" text not null default '',
  value          numeric not null default 0,
  industry       text not null default '',
  source         text not null default '',
  address        text not null default '',
  website        text not null default '',
  "createdAt"    timestamptz not null default now(),
  "updatedAt"    timestamptz
);

create table if not exists public.vendors (
  id             text primary key,
  name           text not null default '',
  "vendorType"   text not null default '',
  "contactName"  text not null default '',
  email          text not null default '',
  phone          text not null default '',
  status         text not null default 'new',
  "ownerId"      text not null default '',
  services       jsonb not null default '[]'::jsonb,
  "billingDate"  text not null default '',
  "billingCycle" text not null default '',
  value          numeric not null default 0,
  terms          text not null default '',
  rating         numeric not null default 0,
  address        text not null default '',
  website        text not null default '',
  "createdAt"    timestamptz not null default now(),
  "updatedAt"    timestamptz
);

create table if not exists public.work_orders (
  id              text primary key,
  title           text not null default '',
  "entityType"    text not null default 'customer',   -- customer | vendor
  "entityId"      text not null default '',
  "assigneeId"    text not null default '',
  "serviceId"     text not null default '',
  status          text not null default 'notstarted',
  priority        text not null default 'normal',
  "scheduledDate" text not null default '',
  "dueDate"       text not null default '',
  "estHours"      numeric not null default 0,
  description     text not null default '',
  "completedAt"   text not null default '',
  "createdAt"     timestamptz not null default now(),
  "updatedAt"     timestamptz
);

create table if not exists public.notes (
  id           text primary key,
  "entityType" text not null default 'customer',      -- customer | vendor | workorder
  "entityId"   text not null default '',
  "authorId"   text not null default '',
  body         text not null default '',
  pinned       boolean not null default false,
  "createdAt"  timestamptz not null default now(),
  "updatedAt"  timestamptz
);

create table if not exists public.services (
  id          text primary key,
  name        text not null default '',
  category    text not null default '',
  rate        numeric not null default 0,
  cycle       text not null default '',
  active      boolean not null default true,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz
);

create table if not exists public.time_entries (
  id            text primary key,
  "workOrderId" text not null default '',
  "userId"      text not null default '',
  date          text not null default '',
  hours         numeric not null default 0,
  note          text not null default '',
  "createdAt"   timestamptz not null default now()
);

create table if not exists public.daily_logs (
  id          text primary key,
  date        text not null default '',
  "userId"    text not null default '',
  summary     text not null default '',
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz
);

create table if not exists public.activity (
  id           text primary key,
  ts           timestamptz not null default now(),
  "userId"     text not null default '',
  action       text not null default '',
  "entityType" text not null default '',
  "entityId"   text not null default '',
  detail       text not null default ''
);

create table if not exists public.statuses (
  id      text primary key,
  label   text not null default '',
  tone    text not null default 'b-grey',
  "order" integer not null default 99,
  open    boolean not null default true,
  won     boolean not null default false
);

create table if not exists public.vendor_types (
  id    text primary key,
  label text not null default ''
);

create table if not exists public.settings (
  id        text primary key default 'org',
  "orgName" text not null default 'ThinkFirst Studios',
  currency  text not null default 'USD'
);

-- Monthly recurring revenue target, in cents to match how Stripe reports
-- money. 0 means no goal set and the dashboard hides the tracker.
alter table public.settings
  add column if not exists "mrrGoalCents" bigint not null default 0;

-- ── Billing type and tags ──────────────────────────────────────────
-- billingType is structured rather than a tag because the app has to do
-- arithmetic with it: pro bono and internal accounts are excluded from
-- revenue, pipeline value and the MRR goal, and are never shown as
-- unpaid. A free-text tag could be misspelled or renamed and would
-- silently stop being honoured.
alter table public.customers
  add column if not exists "billingType" text not null default 'paid';

-- Tags are the opposite case: open-ended labels the app never reasons
-- about, so free text is right.
alter table public.customers
  add column if not exists tags jsonb not null default '[]'::jsonb;
alter table public.vendors
  add column if not exists tags jsonb not null default '[]'::jsonb;

create index if not exists customers_billing_type_idx
  on public.customers ("billingType");

-- helpful indexes for the list views
create index if not exists notes_entity_idx       on public.notes ("entityType", "entityId");
create index if not exists work_orders_sched_idx  on public.work_orders ("scheduledDate");
create index if not exists work_orders_due_idx    on public.work_orders ("dueDate");
create index if not exists work_orders_entity_idx on public.work_orders ("entityType", "entityId");
create index if not exists time_entries_date_idx  on public.time_entries (date);
create index if not exists activity_ts_idx        on public.activity (ts desc);


-- ── 2. Role helper ─────────────────────────────────────────────────
-- SECURITY DEFINER so that reading the caller's role inside a policy on
-- `profiles` does not re-enter that same policy and recurse.

create or replace function public.crm_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select role from public.profiles where id = auth.uid()::text), 'rep');
$$;

revoke all on function public.crm_role() from public;
grant execute on function public.crm_role() to authenticated;


-- ── 3. New sign-ups become CRM profiles automatically ──────────────
-- The very first person to sign up becomes the admin; everyone after
-- that starts as a rep and can be promoted from the Admin panel.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, name, email, role)
  values (
    new.id::text,
    coalesce(new.raw_user_meta_data ->> 'name', split_part(new.email, '@', 1)),
    new.email,
    case when (select count(*) from public.profiles) = 0 then 'admin' else 'rep' end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Backfill: anyone who signed up BEFORE this file was run has a login but
-- no CRM profile. Give them one, and make the earliest account the admin.
insert into public.profiles (id, name, email, role, "createdAt")
select
  u.id::text,
  coalesce(u.raw_user_meta_data ->> 'name', split_part(u.email, '@', 1)),
  u.email,
  case when u.id = (select id from auth.users order by created_at asc limit 1)
       then 'admin' else 'rep' end,
  u.created_at
from auth.users u
on conflict (id) do nothing;


-- ── 4. Row level security ──────────────────────────────────────────
-- Everything below assumes: the team sees everything.

do $$
declare t text;
begin
  foreach t in array array[
    'profiles','customers','vendors','work_orders','notes','services',
    'time_entries','daily_logs','activity','statuses','vendor_types','settings'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    -- drop first so this file stays re-runnable
    execute format('drop policy if exists "team_read" on public.%I', t);
    execute format(
      'create policy "team_read" on public.%I for select to authenticated using (true)', t);
  end loop;
end $$;

-- Operational tables: any teammate may create and edit.
do $$
declare t text;
begin
  foreach t in array array[
    'customers','vendors','work_orders','notes','time_entries','daily_logs','activity'
  ] loop
    execute format('drop policy if exists "team_insert" on public.%I', t);
    execute format('drop policy if exists "team_update" on public.%I', t);
    execute format('drop policy if exists "manager_delete" on public.%I', t);
    execute format(
      'create policy "team_insert" on public.%I for insert to authenticated with check (true)', t);
    execute format(
      'create policy "team_update" on public.%I for update to authenticated using (true) with check (true)', t);
    -- deletes mirror the UI: admin and manager only
    execute format(
      'create policy "manager_delete" on public.%I for delete to authenticated using (public.crm_role() in (''admin'',''manager''))', t);
  end loop;
end $$;

-- Setup tables: admin only for writes (matches the Admin panel gate).
do $$
declare t text;
begin
  foreach t in array array['services','statuses','vendor_types','settings'] loop
    execute format('drop policy if exists "admin_write" on public.%I', t);
    execute format(
      'create policy "admin_write" on public.%I for all to authenticated
         using (public.crm_role() = ''admin'') with check (public.crm_role() = ''admin'')', t);
  end loop;
end $$;

-- Profiles: you may edit yourself; admins may edit and remove anyone.
drop policy if exists "self_or_admin_update" on public.profiles;
create policy "self_or_admin_update" on public.profiles
  for update to authenticated
  using (id = auth.uid()::text or public.crm_role() = 'admin')
  with check (id = auth.uid()::text or public.crm_role() = 'admin');

drop policy if exists "admin_insert" on public.profiles;
create policy "admin_insert" on public.profiles
  for insert to authenticated with check (public.crm_role() = 'admin');

drop policy if exists "admin_delete" on public.profiles;
create policy "admin_delete" on public.profiles
  for delete to authenticated using (public.crm_role() = 'admin');


-- ── 5. Realtime ────────────────────────────────────────────────────
-- So a teammate's note or status change lands on everyone's screen.

do $$
declare t text;
begin
  foreach t in array array[
    'profiles','customers','vendors','work_orders','notes','services',
    'time_entries','daily_logs','activity','statuses','vendor_types','settings'
  ] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception
      when duplicate_object then null;   -- already published
    end;
  end loop;
end $$;


-- ── 6. Reference data ──────────────────────────────────────────────
-- The pipeline statuses and vendor types the app expects on day one.
-- Edit them later from Admin; these are only inserted if missing.

insert into public.statuses (id, label, tone, "order", open, won) values
  ('new',      'New',       'b-blue',   1, true,  false),
  ('followup', 'Follow Up', 'b-orange', 2, true,  false),
  ('pending',  'Pending',   'b-yellow', 3, true,  false),
  ('active',   'Active',    'b-green',  4, false, true),
  ('lost',     'Sale Lost', 'b-red',    5, false, false)
on conflict (id) do nothing;

insert into public.vendor_types (id, label) values
  ('subcontractor', 'Subcontractor'),
  ('supplier',      'Supplier'),
  ('freelancer',    'Freelancer'),
  ('software',      'Software / SaaS'),
  ('agency',        'Agency Partner'),
  ('print',         'Print / Fabrication'),
  ('media',         'Media Buyer')
on conflict (id) do nothing;

insert into public.services (id, name, category, rate, cycle, active) values
  ('s_brand',  'Brand Identity',      'Creative',  4500, 'One-Time', true),
  ('s_web',    'Website Build',       'Web',       6500, 'One-Time', true),
  ('s_care',   'Website Care Plan',   'Web',        250, 'Monthly',  true),
  ('s_seo',    'SEO Retainer',        'Marketing', 1200, 'Monthly',  true),
  ('s_ads',    'Paid Ads Management', 'Marketing', 1500, 'Monthly',  true),
  ('s_social', 'Social Content',      'Marketing',  900, 'Monthly',  true),
  ('s_video',  'Video Production',    'Creative',  3200, 'One-Time', true),
  ('s_photo',  'Photography',         'Creative',  1100, 'One-Time', true),
  ('s_auto',   'CRM / Automation',    'Systems',   2400, 'One-Time', true)
on conflict (id) do nothing;

insert into public.settings (id, "orgName", currency)
values ('org', 'ThinkFirst Studios', 'USD')
on conflict (id) do nothing;
