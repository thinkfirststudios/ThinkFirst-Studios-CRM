-- ════════════════════════════════════════════════════════════════════
-- Reps see only their own leads.
--
-- Paste into Supabase → SQL Editor and run. Safe to run more than once.
--
-- WHY THIS FILE EXISTS, AND WHY THE UI ALONE IS NOT ENOUGH
--
-- Hiding the "Everyone" tab stops an honest mistake. It does not stop
-- anybody: the browser holds a full copy of every lead it is allowed to
-- read, and until this runs, "allowed to read" means all of them. A rep
-- with the developer console open, or one who types a name into the global
-- search, would find leads the screen was not showing.
--
-- These policies move the rule to the database, where the app cannot talk
-- its way past it. After this, a rep's browser never receives another
-- person's lead in the first place.
--
-- WHAT CHANGES FOR A REP
--   · the Leads screen holds only their own — which is what it shows anyway
--   · global search finds only their own leads
--   · the dashboard follow-up queue counts only their own
--   · they cannot edit a lead belonging to somebody else
--
-- Admins and managers are unaffected and still see everything.
--
-- Accounts, contacts and opportunities are deliberately left team-wide: a
-- converted lead becomes shared work, and a rep needs to see that a company
-- is already a customer before ringing them.
--
-- TO UNDO, run the block at the bottom of this file.
-- ════════════════════════════════════════════════════════════════════

-- Reading. Admins and managers see everything; everybody else sees the
-- leads they own.
drop policy if exists "team_read" on public.leads;
drop policy if exists "leads_read" on public.leads;
create policy "leads_read" on public.leads
  for select to authenticated
  using (
    public.crm_role() in ('admin', 'manager')
    or "ownerId" = auth.uid()::text
  );

-- Editing. Same rule: a rep may work their own leads and nobody else's.
-- Both halves are needed - USING decides which rows may be targeted, WITH
-- CHECK decides what they may be changed into, and without the second a rep
-- could hand their own lead to somebody else and lose sight of it.
drop policy if exists "team_update" on public.leads;
drop policy if exists "leads_update" on public.leads;
create policy "leads_update" on public.leads
  for update to authenticated
  using (
    public.crm_role() in ('admin', 'manager')
    or "ownerId" = auth.uid()::text
  )
  with check (
    public.crm_role() in ('admin', 'manager')
    or "ownerId" = auth.uid()::text
  );

-- Creating. A rep may add a lead, and it is theirs. Admins and managers may
-- create one owned by anybody, which is what an import assigned to a rep is.
drop policy if exists "team_insert" on public.leads;
drop policy if exists "leads_insert" on public.leads;
create policy "leads_insert" on public.leads
  for insert to authenticated
  with check (
    public.crm_role() in ('admin', 'manager')
    or "ownerId" = auth.uid()::text
  );

-- Deleting is already admin and manager only, by "manager_delete" in
-- schema.sql. Left alone.

-- A rep's own notes on their own leads. Notes are keyed by entity rather
-- than by owner, so without this a rep could still read the notes attached
-- to a lead they cannot see - which would leak exactly what the lead policy
-- is there to protect.
drop policy if exists "team_read" on public.notes;
drop policy if exists "notes_read" on public.notes;
create policy "notes_read" on public.notes
  for select to authenticated
  using (
    public.crm_role() in ('admin', 'manager')
    or "entityType" <> 'lead'
    or exists (
      select 1 from public.leads l
      where l.id = public.notes."entityId"
        and l."ownerId" = auth.uid()::text
    )
  );

-- ── Check it took ───────────────────────────────────────────────────
-- Should list leads_read, leads_update, leads_insert and manager_delete.
select policyname, cmd
from pg_policies
where schemaname = 'public' and tablename = 'leads'
order by policyname;


-- ════════════════════════════════════════════════════════════════════
-- TO UNDO — put everything back to team-wide. Run this block on its own.
-- ════════════════════════════════════════════════════════════════════
-- drop policy if exists "leads_read"   on public.leads;
-- drop policy if exists "leads_update" on public.leads;
-- drop policy if exists "leads_insert" on public.leads;
-- drop policy if exists "notes_read"   on public.notes;
-- create policy "team_read"   on public.leads for select to authenticated using (true);
-- create policy "team_update" on public.leads for update to authenticated using (true) with check (true);
-- create policy "team_insert" on public.leads for insert to authenticated with check (true);
-- create policy "team_read"   on public.notes for select to authenticated using (true);
