-- ═══════════════════════════════════════════════════════════════════
--  Every tag in use, and how many records carry it
--
--  Run in the Supabase SQL Editor. Reads only - changes nothing.
--
--  The tag filter lists every distinct tag on every lead, customer and
--  vendor, and each import tool invented its own words ("no website",
--  "no website listed", "no-site-found"), so the dropdown has grown past
--  being usable. This is the inventory to decide the clean-up from.
--  Export the result as CSV (the button above the results grid).
-- ═══════════════════════════════════════════════════════════════════

with t as (
  select 'leads' as tbl, tag from public.leads,
    lateral jsonb_array_elements_text(tags) as tag
  union all
  select 'customers', tag from public.customers,
    lateral jsonb_array_elements_text(tags) as tag
  union all
  select 'vendors', tag from public.vendors,
    lateral jsonb_array_elements_text(tags) as tag
)
select
  tag,
  count(*)                                  as uses,
  count(*) filter (where tbl = 'leads')     as leads,
  count(*) filter (where tbl = 'customers') as customers,
  count(*) filter (where tbl = 'vendors')   as vendors
from t
group by tag
order by uses desc, tag;
