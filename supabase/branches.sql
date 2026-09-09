-- ════════════════════════════════════════════════════════════════════
-- Branches: a manager runs one, and sees only its leads.
--
-- Paste into Supabase → SQL Editor and run. Safe to run more than once.
-- Run rep-scope.sql first; this builds on it.
--
-- WHY
--
-- Until now "manager" meant "sees everything", which is the wrong shape for
-- somebody running Brazil: it would hand them every US lead. A branch is
-- the missing axis. Roles say what you may do; the branch says where.
--
--   admin    every branch, everywhere
--   manager  their own branch, every owner in it
--   rep      their own leads, wherever they are
--
-- A blank branch is a branch. Everything that exists today has one - the
-- column defaults to '' - so a manager with a blank branch sees exactly the
-- leads that already existed, and nothing changes for anybody until a
-- branch is actually set. There is no special case for "unset", because a
-- rule with an exception in it is a rule somebody will get wrong.
--
-- SETTING IT UP
--   1. run this file
--   2. Admin → Users & Roles → give Cassius role "manager", branch "Brazil"
--   3. his reps get role "rep", branch "Brazil"
--   4. leads created or imported by them carry "Brazil" automatically
--
-- US leads keep the blank branch and stay invisible to Brazil. If you later
-- want the US named rather than blank, set the US leads and the US people
-- to the same value in one go - see the bottom of this file.
-- ════════════════════════════════════════════════════════════════════

-- ── 1. The column, on people and on leads ───────────────────────────
alter table public.profiles add column if not exists branch text not null default '';
alter table public.leads    add column if not exists branch text not null default '';

create index if not exists leads_branch_idx on public.leads (branch);

-- ── 2. Who am I, and where ──────────────────────────────────────────
-- Mirrors crm_role(). Security definer so it can read profiles without the
-- caller needing to, and stable so the planner may call it once per query.
create or replace function public.crm_branch()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select branch from public.profiles where id = auth.uid()::text), '');
$$;

revoke all on function public.crm_branch() from public;
grant execute on function public.crm_branch() to authenticated;

-- ── 3. Leads ────────────────────────────────────────────────────────
drop policy if exists "team_read"    on public.leads;
drop policy if exists "leads_read"   on public.leads;
create policy "leads_read" on public.leads
  for select to authenticated
  using (
    public.crm_role() = 'admin'
    or (public.crm_role() = 'manager' and branch = public.crm_branch())
    or "ownerId" = auth.uid()::text
  );

drop policy if exists "team_update"  on public.leads;
drop policy if exists "leads_update" on public.leads;
create policy "leads_update" on public.leads
  for update to authenticated
  using (
    public.crm_role() = 'admin'
    or (public.crm_role() = 'manager' and branch = public.crm_branch())
    or "ownerId" = auth.uid()::text
  )
  -- A manager may not push a lead into another branch, and a rep may not
  -- hand one to somebody else. Without the WITH CHECK half, either could
  -- move a row somewhere they can no longer see it.
  with check (
    public.crm_role() = 'admin'
    or (public.crm_role() = 'manager' and branch = public.crm_branch())
    or "ownerId" = auth.uid()::text
  );

drop policy if exists "team_insert"  on public.leads;
drop policy if exists "leads_insert" on public.leads;
create policy "leads_insert" on public.leads
  for insert to authenticated
  with check (
    public.crm_role() = 'admin'
    or (public.crm_role() = 'manager' and branch = public.crm_branch())
    or "ownerId" = auth.uid()::text
  );

-- Deleting stays admin and manager only, from schema.sql. A manager can
-- only target rows they can see, so the branch rule already applies.

-- ── 4. Notes follow the lead they hang off ──────────────────────────
drop policy if exists "team_read"  on public.notes;
drop policy if exists "notes_read" on public.notes;
create policy "notes_read" on public.notes
  for select to authenticated
  using (
    public.crm_role() = 'admin'
    or "entityType" <> 'lead'
    or exists (
      select 1 from public.leads l
      where l.id = public.notes."entityId"
        and (
          (public.crm_role() = 'manager' and l.branch = public.crm_branch())
          or l."ownerId" = auth.uid()::text
        )
    )
  );

-- ── 5. People ───────────────────────────────────────────────────────
-- A manager needs to see who is in their branch, to assign work to them.
-- Everybody can still see everybody's name: a lead's owner has to render,
-- and hiding names would only turn the Owner column into "Unassigned".
-- The branch is not a secret; the leads are.

-- ── Check it took ───────────────────────────────────────────────────
select policyname, cmd from pg_policies
where schemaname = 'public' and tablename in ('leads', 'notes')
order by tablename, policyname;

select id, name, role, branch from public.profiles order by role, name;


-- ════════════════════════════════════════════════════════════════════
-- OPTIONAL — name the US branch instead of leaving it blank.
-- Run BOTH statements together or neither: naming the leads without
-- naming the people would hide every US lead from its own manager.
-- ════════════════════════════════════════════════════════════════════
-- update public.leads    set branch = 'US' where branch = '';
-- update public.profiles set branch = 'US' where branch = '' and role <> 'admin';


-- ════════════════════════════════════════════════════════════════════
-- TO UNDO — back to rep-scope.sql behaviour, branch ignored.
-- The column is left in place; dropping it would lose the data.
-- ════════════════════════════════════════════════════════════════════
-- drop policy if exists "leads_read"   on public.leads;
-- drop policy if exists "leads_update" on public.leads;
-- drop policy if exists "leads_insert" on public.leads;
-- create policy "leads_read" on public.leads for select to authenticated
--   using (public.crm_role() in ('admin','manager') or "ownerId" = auth.uid()::text);
-- create policy "leads_update" on public.leads for update to authenticated
--   using (public.crm_role() in ('admin','manager') or "ownerId" = auth.uid()::text)
--   with check (public.crm_role() in ('admin','manager') or "ownerId" = auth.uid()::text);
-- create policy "leads_insert" on public.leads for insert to authenticated
--   with check (public.crm_role() in ('admin','manager') or "ownerId" = auth.uid()::text);
