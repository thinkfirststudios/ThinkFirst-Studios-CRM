-- ═══════════════════════════════════════════════════════════════════
--  Cut lead tags down to the ones that say why we are calling
--
--  Run in the Supabase SQL Editor, ONE STEP AT A TIME (highlight a step,
--  then Run). Step 1 and 2 change no lead. Step 3 does. Step 5 undoes it.
--
--  WHAT WENT WRONG
--
--  Every import tool wrote its own words into tags: the lead's trade,
--  its city, the list it came from, and notes made while preparing the
--  list. By Oct 2026 that was 749 different tags on 3,795 leads, about
--  450 of them used once, and the tag filter was unusable.
--
--  Nearly all of it repeats a column the lead already has - Industry,
--  Location, Time Zone, the list (source), phone and email. What tags
--  are good for is the thing no column holds: the state of the lead's
--  website, which is the reason to call. So the vocabulary is now:
--
--      website     no website | social only | old site |
--                  brokerage page | has own site
--      calling     company-line  (the app's own switchboard mark)
--      priority    tier 1 | tier 2
--      in common   hockey | racing
--
--  Every other tag comes off. Where a lead has a blank Industry, its
--  first trade tag is copied into Industry before it goes, so no trade
--  is lost. Customers and vendors are not touched.
--
--  The CRM's importer and lead form now only accept tags from this list
--  (S.cleanLeadTags in js/store.js), so the clutter does not grow back.
-- ═══════════════════════════════════════════════════════════════════


-- ── Step 1: the mapping ────────────────────────────────────────────
-- A scratch table: old tag -> new tag. new_tag null means the tag is
-- dropped. is_trade false marks dropped tags that are NOT a trade
-- (places, sources, contact notes), so they are never copied into
-- Industry. Any tag not listed here is dropped and treated as a trade.
-- Touches no lead.
create table if not exists public.tag_cleanup (
  old_tag  text primary key,   -- lower-cased, trimmed
  new_tag  text,
  is_trade boolean not null default false
);
alter table public.tag_cleanup enable row level security;

insert into public.tag_cleanup (old_tag, new_tag) values
  -- website: the tags worth keeping, merged
  ('no-site-found', 'no website'),
  ('no website', 'no website'),
  ('no website listed', 'no website'),
  ('no-website', 'no website'),
  ('social only', 'social only'),
  ('social media only', 'social only'),
  ('social profile only (check)', 'social only'),
  ('no real page', 'social only'),
  ('site 2020 or earlier', 'old site'),
  ('site ~2021', 'old site'),
  ('weak site', 'old site'),
  ('site-broken', 'old site'),
  ('free site builder page', 'old site'),
  ('old site', 'old site'),
  ('brokerage-page', 'brokerage page'),
  ('brokerage page', 'brokerage page'),
  ('own-site', 'has own site'),
  ('has website - not checked', 'has own site'),
  ('has own site', 'has own site'),
  -- calling, priority, in common
  ('reach: switchboard', 'company-line'),
  ('switchboard only', 'company-line'),
  ('company-line', 'company-line'),
  ('tier 1', 'tier 1'),
  ('tier 2', 'tier 2'),
  ('common ground: hockey', 'hockey'),
  ('common ground: racing', 'racing'),
  ('hockey', 'hockey'),
  ('racing', 'racing'),
  -- dropped, and not a trade: where the lead came from
  ('chamber of commerce', null), ('facebook group', null),
  ('walk-in', null), ('trust-based service', null),
  -- dropped, and not a trade: contact notes the columns already hold
  ('phone listed', null), ('email listed', null), ('owner direct', null),
  ('no phone', null), ('no-phone', null), ('second number', null),
  ('toll free', null), ('name unknown', null), ('email incomplete', null),
  ('location from area code', null), ('state unknown', null),
  ('outside the us', null), ('not west coast', null), ('out-of-state', null),
  ('reach: email', null), ('reach: phone', null), ('reach: cell', null),
  ('no way in', null), ('unclaimed listing', null), ('no google listing', null),
  ('disqualified', null), ('domain hijacked', null),
  -- dropped, and not a trade: places
  ('florianópolis', null), ('la county', null), ('austin area', null),
  ('san antonio area', null), ('dallas area', null),
  ('alabama', null), ('alaska', null), ('arizona', null), ('arkansas', null),
  ('california', null), ('colorado', null), ('connecticut', null),
  ('delaware', null), ('florida', null), ('georgia', null), ('hawaii', null),
  ('idaho', null), ('illinois', null), ('indiana', null), ('iowa', null),
  ('kansas', null), ('kentucky', null), ('louisiana', null), ('maine', null),
  ('maryland', null), ('massachusetts', null), ('michigan', null),
  ('minnesota', null), ('mississippi', null), ('missouri', null),
  ('montana', null), ('nebraska', null), ('nevada', null),
  ('new hampshire', null), ('new jersey', null), ('new mexico', null),
  ('new york', null), ('north carolina', null), ('north dakota', null),
  ('ohio', null), ('oklahoma', null), ('oregon', null),
  ('pennsylvania', null), ('rhode island', null), ('south carolina', null),
  ('south dakota', null), ('tennessee', null), ('texas', null),
  ('utah', null), ('vermont', null), ('virginia', null),
  ('washington', null), ('west virginia', null), ('wisconsin', null),
  ('wyoming', null),
  ('san-clemente', null), ('san-juan-capistrano', null), ('dana-point', null),
  ('laguna-niguel', null), ('capistrano-beach', null), ('irvine', null),
  ('huntington-beach', null), ('mission-viejo', null), ('ladera-ranch', null),
  ('laguna-beach', null), ('aliso-viejo', null), ('newport-beach', null),
  ('tustin', null), ('santa-ana', null), ('laguna-woods', null),
  ('fullerton', null), ('garden-grove', null), ('los-alamitos', null)
on conflict (old_tag) do nothing;


-- ── Step 2: preview ────────────────────────────────────────────────
-- Changes nothing. Run each query on its own and read the results.

-- 2a. The headline: how many distinct tags now, and after.
with src as (
  select l.id, t.tag, t.ord, lower(trim(t.tag)) as k
  from public.leads l
  cross join lateral jsonb_array_elements_text(l.tags) with ordinality as t(tag, ord)
),
mapped as (
  select s.*, m.new_tag
  from src s left join public.tag_cleanup m on m.old_tag = s.k
)
select
  (select count(distinct tag) from src)                          as tags_now,
  (select count(distinct new_tag) from mapped)                   as tags_after,
  (select count(distinct id) from src)                           as leads_with_tags_now,
  (select count(distinct id) from mapped where new_tag is not null) as leads_with_tags_after;

-- 2b. What the filter will offer afterwards, with counts.
select m.new_tag as tag, count(distinct l.id) as leads
from public.leads l
cross join lateral jsonb_array_elements_text(l.tags) as t(tag)
join public.tag_cleanup m on m.old_tag = lower(trim(t.tag))
where m.new_tag is not null
group by m.new_tag
order by leads desc;

-- 2c. Every Industry that would be filled in from a trade tag.
-- Expect a short list. If something here is not a trade (a city, a
-- source), add it to tag_cleanup with new_tag null and re-run 2c.
select l.id, l.name, t.tag as trade_tag,
       initcap(replace(t.tag, '-', ' ')) as industry_would_be
from public.leads l
cross join lateral (
  select x.tag
  from jsonb_array_elements_text(l.tags) with ordinality as x(tag, ord)
  left join public.tag_cleanup m on m.old_tag = lower(trim(x.tag))
  where m.old_tag is null          -- unlisted = trade
  order by x.ord
  limit 1
) t
where trim(l.industry) = '';


-- ── Step 3: the cleanup ────────────────────────────────────────────
-- Saves every lead's current tags and industry to a backup table first
-- (kept if the step is ever re-run, so the backup is always the
-- original), then rewrites them. Only leads whose tags or industry
-- actually change are written.
begin;

create table if not exists public.leads_tags_backup_20261022 as
  select id, tags, industry from public.leads;
alter table public.leads_tags_backup_20261022 enable row level security;

with planned as (
  select
    l.id,
    coalesce((
      select jsonb_agg(distinct m.new_tag order by m.new_tag)
      from jsonb_array_elements_text(l.tags) as x(tag)
      join public.tag_cleanup m on m.old_tag = lower(trim(x.tag))
      where m.new_tag is not null
    ), '[]'::jsonb) as new_tags,
    (
      select x.tag
      from jsonb_array_elements_text(l.tags) with ordinality as x(tag, ord)
      left join public.tag_cleanup m on m.old_tag = lower(trim(x.tag))
      where m.old_tag is null
      order by x.ord
      limit 1
    ) as trade_tag
  from public.leads l
)
update public.leads l
   set tags = p.new_tags,
       industry = case
         when trim(l.industry) = '' and p.trade_tag is not null
           then initcap(replace(p.trade_tag, '-', ' '))
         else l.industry
       end
  from planned p
 where l.id = p.id
   and (l.tags <> p.new_tags
        or (trim(l.industry) = '' and p.trade_tag is not null));

commit;


-- ── Step 4: check it worked ────────────────────────────────────────
-- Expect only the ten tags above.
select t.tag, count(*) as leads
from public.leads l
cross join lateral jsonb_array_elements_text(l.tags) as t(tag)
group by t.tag
order by leads desc;

-- Once happy, the scratch mapping can go (keep the backup a while):
-- drop table public.tag_cleanup;


-- ── Step 5: undo (only if needed) ──────────────────────────────────
-- Puts every lead's tags and industry back exactly as they were.
-- update public.leads l
--    set tags = b.tags, industry = b.industry
--   from public.leads_tags_backup_20261022 b
--  where l.id = b.id;
