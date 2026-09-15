-- ════════════════════════════════════════════════════════════════════
-- A second mockup link on leads: one for graphic design work.
--
-- Paste into Supabase → SQL Editor and run. Safe to run more than once.
--
-- A lead used to hold a single mockup link, which was fine while every
-- mockup was a website. Once graphic design mockups are being pitched too,
-- the second link had nowhere to go but on top of the first. The existing
-- "mockupUrl" stays exactly as it is and is now the website link; this adds
-- the design link beside it. No existing link moves or changes.
--
-- Until this is run, the CRM shows the design link field greyed out and
-- names "Graphic design mockup links" in the update banner, so nobody can
-- type a link that would silently not save.
-- ════════════════════════════════════════════════════════════════════

alter table public.leads
  add column if not exists "mockupDesignUrl" text not null default '';

-- ── Check it took ───────────────────────────────────────────────────
select column_name, data_type, column_default
from information_schema.columns
where table_schema = 'public' and table_name = 'leads'
  and column_name in ('mockupUrl', 'mockupDesignUrl')
order by column_name;


-- ════════════════════════════════════════════════════════════════════
-- TO UNDO — this deletes every design link saved in it.
-- ════════════════════════════════════════════════════════════════════
-- alter table public.leads drop column if exists "mockupDesignUrl";
