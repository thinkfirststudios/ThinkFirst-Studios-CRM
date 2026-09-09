-- ════════════════════════════════════════════════════════════════════
-- Only admins can read the activity log.
--
-- Paste into Supabase → SQL Editor and run. Safe to run more than once.
-- Run rep-scope.sql first; this finishes the job it starts.
--
-- WHY
--
-- Scoping leads stopped a rep listing somebody else's. It did not stop them
-- reading about one. Every action writes a line here, and those lines carry
-- the lead's name and the first 70 characters of any note:
--
--   Alex Herrman  created  Sarah Whitfield
--   Alex Herrman  noted    called, wants a redesign before the spring market
--
-- The Team Activity card on the home page shows the last twelve of those to
-- whoever is looking. So the log had to move behind the same door.
--
-- READING is admin-only. WRITING is deliberately left open to everybody,
-- and that distinction is the whole point of this file: every action any
-- teammate takes writes a line here. Restricting inserts would make each
-- one fail, and a rep would watch "Could not save to activity" appear every
-- time they touched a lead. They write lines they cannot read back, which
-- is exactly what an audit log should do.
--
-- WHAT CHANGES
--   · admins: nothing
--   · everybody else: the Team Activity card disappears from the home page
--     rather than sitting there empty, and Admin → Audit Log was already
--     admin-only
--
-- A rep still sees their own work everywhere it matters: their leads, their
-- follow-up queue, their outreach streak, the notes on their own leads.
--
-- TO UNDO, run the block at the bottom.
-- ════════════════════════════════════════════════════════════════════

drop policy if exists "team_read" on public.activity;
drop policy if exists "activity_read" on public.activity;
create policy "activity_read" on public.activity
  for select to authenticated
  using (public.crm_role() = 'admin');

-- Inserts stay team-wide. See the note above: this is not an oversight.
-- "team_insert" from schema.sql is left exactly as it is.

-- ── Check it took ───────────────────────────────────────────────────
-- Expect activity_read for SELECT, and team_insert still there for INSERT.
select policyname, cmd
from pg_policies
where schemaname = 'public' and tablename = 'activity'
order by policyname;


-- ════════════════════════════════════════════════════════════════════
-- TO UNDO — put the log back in front of the whole team.
-- ════════════════════════════════════════════════════════════════════
-- drop policy if exists "activity_read" on public.activity;
-- create policy "team_read" on public.activity
--   for select to authenticated using (true);
