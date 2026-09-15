-- ════════════════════════════════════════════════════════════════════
-- Two columns on leads, for the mockup work queue.
--
-- Paste into Supabase → SQL Editor and run. Safe to run more than once,
-- and safe to run even if you already ran mockup-design-link.sql - this
-- file includes that column too, so it is the only one you need.
--
--   mockupDesignUrl    the graphic design mockup, beside the website one.
--                      A lead used to hold a single link, so a design
--                      mockup had nowhere to go but on top of the website
--                      one.
--
--   mockupRequestedAt  the day a rep asked for the work. Without it the
--                      Work To Build list cannot say how long anything has
--                      been waiting, which is the only number on it that
--                      says what to pick up next.
--
-- Nothing already saved moves or changes. Until this is run the CRM keeps
-- working: the design link field is shown switched off, the queue simply
-- does not show ages, and the update banner names what is waiting - rather
-- than letting anyone type something the save would quietly drop.
-- ════════════════════════════════════════════════════════════════════

alter table public.leads
  add column if not exists "mockupDesignUrl"   text not null default '';
alter table public.leads
  add column if not exists "mockupRequestedAt" text not null default '';

-- ── Check it took ───────────────────────────────────────────────────
select column_name
from information_schema.columns
where table_schema = 'public' and table_name = 'leads'
  and column_name like 'mockup%'
order by column_name;


-- ════════════════════════════════════════════════════════════════════
-- TO UNDO — this deletes everything saved in those columns.
-- ════════════════════════════════════════════════════════════════════
-- alter table public.leads drop column if exists "mockupDesignUrl";
-- alter table public.leads drop column if exists "mockupRequestedAt";
