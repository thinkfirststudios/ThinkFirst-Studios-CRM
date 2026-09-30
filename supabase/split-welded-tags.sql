-- ═══════════════════════════════════════════════════════════════════
--  Split tags that arrived welded into one string
--
--  Run in the Supabase SQL Editor. Safe to run twice - a second run
--  finds nothing left to do.
--
--  WHAT WENT WRONG
--
--  S.parseTags splits a tags cell on commas and nothing else, but the
--  import-prep tools joined tags with a pipe. So a lead meant to carry
--  two tags arrived carrying one:
--
--      ["realtor | no-site-found"]     instead of  ["realtor",
--                                                   "no-site-found"]
--
--  1,500 of 1,714 leads are like this. The cost is not cosmetic: the
--  687 realtors with no website cannot be filtered to, because
--  "no-site-found" does not exist as a tag anywhere - only
--  "realtor | no-site-found" does. The same goes for the 448 with
--  their own site and the 282 on a brokerage page.
--
--  Both tools now join with commas, so nothing new arrives like this.
--  This repairs what is already in.
-- ═══════════════════════════════════════════════════════════════════

-- ── Look before touching ───────────────────────────────────────────
-- Run this on its own first. It changes nothing and shows the damage.
select
  count(*) filter (where t.tag like '%|%')                  as welded_tags,
  count(distinct l.id) filter (where t.tag like '%|%')      as leads_affected
from public.leads l
cross join lateral jsonb_array_elements_text(l.tags) as t(tag);


-- ── The repair ─────────────────────────────────────────────────────
-- Each tag is split on the pipe, trimmed, blanks dropped, and the
-- result de-duplicated so a lead that already carried "realtor" on its
-- own does not end up with it twice.
--
-- Only rows that actually contain a pipe are written, so this does not
-- churn the 214 leads whose tags were always fine - and does not fire
-- their realtime updates at every open browser.
with exploded as (
  select
    l.id,
    jsonb_agg(distinct trim(piece) order by trim(piece)) as fixed
  from public.leads l
  cross join lateral jsonb_array_elements_text(l.tags) as t(tag)
  cross join lateral unnest(string_to_array(t.tag, '|')) as p(piece)
  where trim(piece) <> ''
  group by l.id
)
update public.leads l
   set tags = e.fixed
  from exploded e
 where l.id = e.id
   and exists (
     select 1
     from jsonb_array_elements_text(l.tags) as t(tag)
     where t.tag like '%|%'
   );


-- ── Check it worked ────────────────────────────────────────────────
-- Expect welded_tags = 0, and the tags that were buried now countable.
select t.tag, count(*) as leads
from public.leads l
cross join lateral jsonb_array_elements_text(l.tags) as t(tag)
group by t.tag
order by leads desc
limit 20;


-- ── The same for customers, which share the tag shape ──────────────
with exploded as (
  select
    c.id,
    jsonb_agg(distinct trim(piece) order by trim(piece)) as fixed
  from public.customers c
  cross join lateral jsonb_array_elements_text(c.tags) as t(tag)
  cross join lateral unnest(string_to_array(t.tag, '|')) as p(piece)
  where trim(piece) <> ''
  group by c.id
)
update public.customers c
   set tags = e.fixed
  from exploded e
 where c.id = e.id
   and exists (
     select 1
     from jsonb_array_elements_text(c.tags) as t(tag)
     where t.tag like '%|%'
   );
