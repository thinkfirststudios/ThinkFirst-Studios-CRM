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

-- ── Accounts, Contacts, Opportunities ─────────────────────────────
-- The `customers` table above IS the Account object. It kept its
-- original name deliberately: renaming it would have meant rewriting
-- "entityType" on every existing note and work order and re-pointing
-- the Stripe mirror plus its Edge Function — a cascade of edits to live
-- data to buy a cosmetic change. The application says "Account"
-- everywhere; only storage keeps the older word.

-- How the account is classified. Derived from won opportunities in the
-- app, but stored so Partner and Former survive — those are judgements,
-- not facts a deal can overturn.
alter table public.customers
  add column if not exists "accountType" text not null default 'prospect';

-- The people at an account. Splitting them out is the point: one
-- company routinely has a decision maker, a billing contact and a
-- day-to-day contact, and the single "contactName" field could only
-- ever hold one of them.
create table if not exists public.contacts (
  id                    text primary key,
  "accountId"           text not null default '',
  "firstName"           text not null default '',
  "lastName"            text not null default '',
  title                 text not null default '',
  email                 text not null default '',
  phone                 text not null default '',
  mobile                text not null default '',
  department            text not null default '',
  role                  text not null default '',
  "isPrimary"           boolean not null default false,
  "reportsTo"           text not null default '',
  description           text not null default '',
  "ownerId"             text not null default '',
  tags                  jsonb not null default '[]'::jsonb,
  "convertedFromLeadId" text not null default '',
  "createdAt"           timestamptz not null default now(),
  "updatedAt"           timestamptz
);

-- A deal. Many per account, each with its own stage, amount and close
-- date — which is what the old model could not express, since the
-- account's own status had to double as the stage of its only deal.
create table if not exists public.opportunities (
  id            text primary key,
  name          text not null default '',
  "accountId"   text not null default '',
  "contactId"   text not null default '',
  stage         text not null default 'prospecting',
  amount        numeric not null default 0,
  "closeDate"   text not null default '',        -- 'YYYY-MM-DD'
  "ownerId"     text not null default '',
  type          text not null default '',
  "leadSource"  text not null default '',
  "nextStep"    text not null default '',
  description   text not null default '',
  "lostReason"  text not null default '',
  services      jsonb not null default '[]'::jsonb,
  "closedAt"    text not null default '',
  "createdAt"   timestamptz not null default now(),
  "updatedAt"   timestamptz
);

-- Activities: Task, Event and logged Call in one table. They share every
-- field that matters and differ only in whether they carry a time and
-- whether they begin life already done.
create table if not exists public.tasks (
  id            text primary key,
  kind          text not null default 'task',    -- task | call | event
  subject       text not null default '',
  description   text not null default '',
  status        text not null default 'open',    -- open | completed
  priority      text not null default 'normal',
  "dueDate"     text not null default '',
  "startTime"   text not null default '',
  "endTime"     text not null default '',
  "entityType"  text not null default '',        -- customer | contact | lead | opportunity | vendor | workorder
  "entityId"    text not null default '',
  "assigneeId"  text not null default '',
  "createdById" text not null default '',
  "completedAt" text not null default '',
  "createdAt"   timestamptz not null default now(),
  "updatedAt"   timestamptz
);

create index if not exists contacts_account_idx    on public.contacts ("accountId");
create index if not exists contacts_primary_idx    on public.contacts ("accountId", "isPrimary");
create index if not exists opportunities_acct_idx  on public.opportunities ("accountId");
create index if not exists opportunities_stage_idx on public.opportunities (stage);
create index if not exists opportunities_close_idx on public.opportunities ("closeDate");
create index if not exists tasks_entity_idx        on public.tasks ("entityType", "entityId");
create index if not exists tasks_open_idx          on public.tasks (status, "dueDate");
create index if not exists tasks_assignee_idx      on public.tasks ("assigneeId");

-- Leads are their own object rather than customers in an early status.
-- They arrive in bulk and most never convert; keeping them here means the
-- customer count, pipeline value and billing calendar only ever describe
-- real accounts. Conversion is one-way and recorded on both sides.
create table if not exists public.leads (
  id                    text primary key,
  name                  text not null default '',
  "contactName"         text not null default '',
  "contactTitle"        text not null default '',
  email                 text not null default '',
  phone                 text not null default '',
  "leadStatus"          text not null default 'new',   -- new|working|nurturing|qualified|unqualified|converted
  rating                text not null default 'warm',  -- hot|warm|cold
  source                text not null default '',
  "ownerId"             text not null default '',
  "estValue"            numeric not null default 0,
  "nextFollowUp"        text not null default '',      -- 'YYYY-MM-DD'
  "lastContactedAt"     text not null default '',
  industry              text not null default '',
  address               text not null default '',
  website               text not null default '',
  tags                  jsonb not null default '[]'::jsonb,
  "convertedCustomerId" text not null default '',
  "convertedAt"         text not null default '',
  "createdAt"           timestamptz not null default now(),
  "updatedAt"           timestamptz
);

-- Where the lead ended up, now that conversion produces three records.
alter table public.leads
  add column if not exists "convertedContactId" text not null default '';
alter table public.leads
  add column if not exists "convertedOpportunityId" text not null default '';

-- The other half of the conversion link, so an account can always say
-- where it came from even if the lead row is later deleted.
alter table public.customers
  add column if not exists "convertedFromLeadId" text not null default '';

create index if not exists leads_status_idx    on public.leads ("leadStatus");
create index if not exists leads_followup_idx  on public.leads ("nextFollowUp");
create index if not exists leads_owner_idx     on public.leads ("ownerId");
create index if not exists leads_email_idx     on public.leads (lower(email));

-- ── Daily outreach ────────────────────────────────────────────────
-- Posting in Nextdoor and Facebook groups is a daily habit, so it is
-- tracked as two things: the communities you post in, and each
-- individual touch. Every lead that comes out of one keeps a link back,
-- which is what turns a chore list into a record of which groups are
-- actually worth the time.

create table if not exists public.outreach_groups (
  id            text primary key,
  name          text not null default '',
  channel       text not null default 'facebook',  -- nextdoor|facebook|instagram|linkedin|reddit|other
  url           text not null default '',
  area          text not null default '',
  "memberCount" numeric not null default 0,
  -- Minimum days between posts. Most groups remove you for ignoring
  -- their limit, so the board will not suggest a group inside this gap.
  "cadenceDays" integer not null default 7,
  rules         text not null default '',
  notes         text not null default '',
  active        boolean not null default true,
  "ownerId"     text not null default '',
  "createdAt"   timestamptz not null default now(),
  "updatedAt"   timestamptz
);

create table if not exists public.outreach (
  id          text primary key,
  date        text not null default '',            -- 'YYYY-MM-DD'
  channel     text not null default '',
  "groupId"   text not null default '',
  kind        text not null default 'comment',     -- recommendation|comment|post|dm|follow
  summary     text not null default '',
  url         text not null default '',
  responses   numeric not null default 0,
  "userId"    text not null default '',
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz
);

-- Which touch produced this lead. Leads count themselves rather than the
-- outreach row holding a tally, so the two can never drift apart.
alter table public.leads
  add column if not exists "outreachId" text not null default '';

create index if not exists outreach_date_idx    on public.outreach (date desc);
create index if not exists outreach_group_idx   on public.outreach ("groupId", date desc);
create index if not exists outreach_user_idx    on public.outreach ("userId", date desc);
create index if not exists leads_outreach_idx   on public.leads ("outreachId");

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

-- Outreach touches per day to aim for. 0 means no target, and any day
-- with at least one touch then counts as a day you showed up.
alter table public.settings
  add column if not exists "outreachDailyGoal" integer not null default 0;

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
    'profiles','customers','contacts','opportunities','tasks','vendors','leads',
    'outreach_groups','outreach','work_orders','notes','services',
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
    'customers','contacts','opportunities','tasks','vendors','leads',
    'outreach_groups','outreach','work_orders','notes','time_entries','daily_logs','activity'
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
    'profiles','customers','contacts','opportunities','tasks','vendors','leads',
    'outreach_groups','outreach','work_orders','notes','services',
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


-- ── 7. Migration: split existing accounts into contacts + deals ────
-- Records created before this release hold their contact inline and use
-- the account's own status as the stage of its only deal. These two
-- statements give each of them a real Contact and a real Opportunity so
-- nothing has to be re-entered by hand.
--
-- Both are idempotent: the generated ids are derived from the account
-- id, so re-running does nothing. Neither statement deletes or alters
-- an existing row — the original fields stay exactly where they were.

-- 7a. The inline contact becomes a real Contact, marked primary.
-- The name splits at the first space; with no space the whole string
-- becomes the last name. first || ' ' || last always round-trips to
-- what was typed, so a name that cannot be parsed is never mangled.
insert into public.contacts
  (id, "accountId", "firstName", "lastName", email, phone, "isPrimary", "ownerId", "createdAt")
select
  'ct_mig_' || c.id,
  c.id,
  case when position(' ' in trim(c."contactName")) > 0
       then split_part(trim(c."contactName"), ' ', 1) else '' end,
  case when position(' ' in trim(c."contactName")) > 0
       then trim(substring(trim(c."contactName") from position(' ' in trim(c."contactName")) + 1))
       else trim(c."contactName") end,
  c.email, c.phone, true, c."ownerId", c."createdAt"
from public.customers c
where coalesce(trim(c."contactName"), '') <> ''
  -- skip accounts that already have contacts, so a re-run after real
  -- data entry cannot resurrect a contact somebody deliberately deleted
  and not exists (select 1 from public.contacts x where x."accountId" = c.id)
on conflict (id) do nothing;

-- 7b. The account's status becomes the stage of its first Opportunity.
-- Amount comes from the contract value; the account keeps that value,
-- because what a client pays every month is a different fact from what
-- a single deal was worth.
insert into public.opportunities
  (id, name, "accountId", "contactId", stage, amount, "closeDate", "ownerId",
   type, "leadSource", services, "closedAt", "createdAt")
select
  'op_mig_' || c.id,
  c.name || ' — Initial Engagement',
  c.id,
  coalesce((select x.id from public.contacts x
            where x."accountId" = c.id order by x."isPrimary" desc limit 1), ''),
  case c.status
    when 'new'      then 'prospecting'
    when 'followup' then 'qualification'
    when 'pending'  then 'proposal'
    when 'active'   then 'closedwon'
    when 'lost'     then 'closedlost'
    else 'prospecting'
  end,
  c.value,
  coalesce(nullif(c."billingDate", ''), to_char(now(), 'YYYY-MM-DD')),
  c."ownerId",
  'New Business',
  c.source,
  c.services,
  case when c.status in ('active', 'lost') then to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SSZ') else '' end,
  c."createdAt"
from public.customers c
where not exists (select 1 from public.opportunities o where o."accountId" = c.id)
on conflict (id) do nothing;

-- 7c. Classify the accounts. A won deal makes it a Customer; a lost-only
-- history makes it Former. Everything else is still a Prospect.
update public.customers c
set "accountType" = case
      when exists (select 1 from public.opportunities o
                   where o."accountId" = c.id and o.stage = 'closedwon') then 'customer'
      when c.status = 'lost' then 'former'
      else 'prospect'
    end
where c."accountType" = 'prospect';

-- ── 8. Lead close reason ───────────────────────────────────────────
-- Leads now close in two distinct ways. Unqualified means it was never a
-- fit; Dead means it was a fit and went nowhere anyway. The reason is the
-- only record of which, and of what to do differently next time.
alter table public.leads
  add column if not exists "lostReason" text not null default '';

-- ── 9. Social handles ──────────────────────────────────────────────
-- For a business found in a Facebook group or on Instagram, the handle
-- is often the only way to reach them: no website, no email, a Gmail
-- address at best. Stored as real fields so they are searchable and
-- clickable rather than buried in a note.
--
-- Values are normalised to the bare handle by the app, so the same
-- account pasted as @name, name, or a full profile URL is one value.
do $$
declare t text;
begin
  foreach t in array array['leads', 'customers', 'contacts'] loop
    execute format('alter table public.%I add column if not exists instagram text not null default ''''', t);
    execute format('alter table public.%I add column if not exists tiktok    text not null default ''''', t);
    execute format('alter table public.%I add column if not exists facebook  text not null default ''''', t);
  end loop;
end $$;

-- ── 10. Mockups on leads ───────────────────────────────────────────
-- The pitch for most leads is a mockup. The state worth tracking is
-- READY — built but not yet sent — which is finished work earning
-- nothing, and is invisible unless it is distinguished from "no mockup"
-- and "sent". The two dates are stamped by the app so that "how long has
-- this been sitting" is answerable at all.
alter table public.leads
  add column if not exists "mockupStatus"  text not null default 'none';   -- none|inprogress|ready|sent
alter table public.leads
  add column if not exists "mockupTypes"   jsonb not null default '[]'::jsonb;
alter table public.leads
  add column if not exists "mockupUrl"     text not null default '';
alter table public.leads
  add column if not exists "mockupReadyAt" text not null default '';
alter table public.leads
  add column if not exists "mockupSentAt"  text not null default '';

create index if not exists leads_mockup_idx on public.leads ("mockupStatus");
