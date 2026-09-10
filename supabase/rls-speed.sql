-- ════════════════════════════════════════════════════════════════════
-- Make the policies stop running once per row.
--
-- Paste into Supabase → SQL Editor and run. Safe to run more than once.
-- Run after rep-scope.sql and branches.sql; this only rewrites what they
-- created, and changes no rule - the same people see exactly the same rows.
--
-- WHY
--
-- rep-scope.sql and branches.sql wrote policies like this:
--
--   using (public.crm_role() = 'admin' or "ownerId" = auth.uid()::text)
--
-- crm_role() is a function, and Postgres has no way to know it returns the
-- same answer for every row, so it calls it FOR EVERY ROW IT CHECKS. Each
-- call is itself a query against profiles. Reading a thousand notes runs a
-- thousand extra lookups; reading them under a branch policy, which calls
-- crm_role() and crm_branch() and auth.uid(), runs three thousand.
--
-- The fix is to wrap the call in a scalar subquery:
--
--   using ((select public.crm_role()) = 'admin' or ...)
--
-- Postgres hoists that into an InitPlan - evaluated ONCE per query, the
-- result reused for every row. Same rule, same rows, one lookup instead of
-- a thousand. This is Supabase's own documented guidance for RLS at size,
-- and it gets dramatically more important as a table grows, which is why
-- this was invisible at a hundred leads and painful at two thousand.
--
-- The same trap applies to auth.uid(), so it is wrapped too.
--
-- Realtime matters as much as page load here. Every insert is authorised
-- against these policies for every connected client before it is delivered,
-- so a slow policy makes logging a note feel like the tab has hung.
-- ════════════════════════════════════════════════════════════════════

-- ── 1. Indexes the policies actually need ───────────────────────────
-- A rep's policy filters leads by "ownerId" and notes by the lead they
-- hang off. Without these, both are a sequential scan of the whole table
-- on every read, which no amount of policy tuning fixes.
create index if not exists leads_owner_idx  on public.leads ("ownerId");
create index if not exists notes_entity_idx on public.notes ("entityType", "entityId");
create index if not exists activity_ts_idx  on public.activity (ts desc);

-- ── 2. Leads ────────────────────────────────────────────────────────
drop policy if exists "leads_read" on public.leads;
create policy "leads_read" on public.leads
  for select to authenticated
  using (
    (select public.crm_role()) = 'admin'
    or ((select public.crm_role()) = 'manager' and branch = (select public.crm_branch()))
    or "ownerId" = (select auth.uid()::text)
  );

drop policy if exists "leads_update" on public.leads;
create policy "leads_update" on public.leads
  for update to authenticated
  using (
    (select public.crm_role()) = 'admin'
    or ((select public.crm_role()) = 'manager' and branch = (select public.crm_branch()))
    or "ownerId" = (select auth.uid()::text)
  )
  with check (
    (select public.crm_role()) = 'admin'
    or ((select public.crm_role()) = 'manager' and branch = (select public.crm_branch()))
    or "ownerId" = (select auth.uid()::text)
  );

drop policy if exists "leads_insert" on public.leads;
create policy "leads_insert" on public.leads
  for insert to authenticated
  with check (
    (select public.crm_role()) = 'admin'
    or ((select public.crm_role()) = 'manager' and branch = (select public.crm_branch()))
    or "ownerId" = (select auth.uid()::text)
  );

-- ── 3. Notes ────────────────────────────────────────────────────────
-- The EXISTS stays - a note's visibility really does depend on its lead -
-- but the three function calls inside it no longer run per note.
drop policy if exists "notes_read" on public.notes;
create policy "notes_read" on public.notes
  for select to authenticated
  using (
    (select public.crm_role()) = 'admin'
    or "entityType" <> 'lead'
    or exists (
      select 1 from public.leads l
      where l.id = public.notes."entityId"
        and (
          ((select public.crm_role()) = 'manager' and l.branch = (select public.crm_branch()))
          or l."ownerId" = (select auth.uid()::text)
        )
    )
  );

-- ── 4. Deletes, on every table that has them ────────────────────────
-- Bulk delete checks this once per row too, so removing two thousand
-- leads called crm_role() two thousand times.
do $$
declare t text;
begin
  foreach t in array array[
    'customers','contacts','opportunities','tasks','vendors','leads',
    'outreach_groups','outreach','work_orders','notes','time_entries',
    'daily_logs','activity'
  ] loop
    execute format('drop policy if exists "manager_delete" on public.%I', t);
    execute format(
      'create policy "manager_delete" on public.%I for delete to authenticated
         using ((select public.crm_role()) in (''admin'',''manager''))', t);
  end loop;
end $$;

-- ── 5. Setup tables and profiles ────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['services','statuses','vendor_types','settings'] loop
    execute format('drop policy if exists "admin_write" on public.%I', t);
    execute format(
      'create policy "admin_write" on public.%I for all to authenticated
         using ((select public.crm_role()) = ''admin'')
         with check ((select public.crm_role()) = ''admin'')', t);
  end loop;
end $$;

drop policy if exists "self_or_admin_update" on public.profiles;
create policy "self_or_admin_update" on public.profiles
  for update to authenticated
  using (id = (select auth.uid()::text) or (select public.crm_role()) = 'admin')
  with check (id = (select auth.uid()::text) or (select public.crm_role()) = 'admin');

drop policy if exists "admin_insert" on public.profiles;
create policy "admin_insert" on public.profiles
  for insert to authenticated with check ((select public.crm_role()) = 'admin');

drop policy if exists "admin_delete" on public.profiles;
create policy "admin_delete" on public.profiles
  for delete to authenticated using ((select public.crm_role()) = 'admin');

-- ── 6. The activity log, if activity-admin-only.sql was run ─────────
do $$
begin
  if exists (select 1 from pg_policies
             where schemaname = 'public' and tablename = 'activity'
               and policyname = 'activity_read') then
    drop policy "activity_read" on public.activity;
    create policy "activity_read" on public.activity
      for select to authenticated
      using ((select public.crm_role()) = 'admin');
  end if;
end $$;

-- ── Check it took ───────────────────────────────────────────────────
-- Every policy left calling a function directly, rather than through a
-- subquery, is one that still runs per row. This should come back empty.
select tablename, policyname, cmd
from pg_policies
where schemaname = 'public'
  and (qual ~ '(?<!select )(public\.)?crm_role\(\)'
    or qual ~ '(?<!select )auth\.uid\(\)'
    or with_check ~ '(?<!select )(public\.)?crm_role\(\)'
    or with_check ~ '(?<!select )auth\.uid\(\)')
order by tablename, policyname;

-- How big the tables actually are, which is what decided whether any of
-- this mattered.
select 'leads' as t, count(*) from public.leads
union all select 'notes', count(*) from public.notes
union all select 'activity', count(*) from public.activity
order by 1;


-- ════════════════════════════════════════════════════════════════════
-- TO UNDO — put the per-row calls back. There is no reason to, since the
-- rules are identical either way, but the option should exist.
-- ════════════════════════════════════════════════════════════════════
-- Re-run branches.sql, which recreates the leads and notes policies in
-- their original form, then schema.sql for the rest.
