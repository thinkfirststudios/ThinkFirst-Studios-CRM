-- ═══════════════════════════════════════════════════════════════════
--  New lead statuses, and No answer going to a second caller
--
--  Run in the Supabase SQL Editor, ONE STEP AT A TIME (highlight a step,
--  then Run). Step 1 changes nothing. Step 2 changes lead statuses.
--  Step 3 adds the hand-off function. Step 5 undoes step 2.
--
--  THE NEW STATUSES (agreed Oct 2026)
--
--      open, still to ring      New lead · No answer · Left voicemail · Hung up
--      closed                   Do not call · Pitch no sale (with why) ·
--                               Pitch and sale (converts to a customer)
--
--  Two stored ids are kept and only relabelled, so those rows need no
--  change at all:
--      'dead'       now shows as Do not call   (every old Dead lead)
--      'converted'  now shows as Pitch and sale
--
--  The ids that go away:
--      working, nurturing, qualified  -> 'noanswer'  (rung, no result)
--      unqualified                    -> 'dead'      (Do not call)
--
--  The app already reads the old ids as the new ones (LEAD_STATUS_ALIASES
--  in js/store.js), so nothing breaks before this runs. Running it makes
--  the stored value match what the screens show.
--
--  NO ANSWER -> SOMEONE ELSE
--
--  Marking a lead No answer hands it to another rep in its branch for the
--  second call. A rep may only save leads they own (leads_update policy),
--  so they cannot give one away with a normal save. hand_off_lead (step 3)
--  makes that single change on their behalf, and only for a lead they
--  own, to an active person in the same branch who is not themselves.
--  Until step 3 runs, a rep's hand-off fails with a message saying so;
--  admins and managers hand off without it.
-- ═══════════════════════════════════════════════════════════════════


-- ── Step 1: preview ────────────────────────────────────────────────
-- Changes nothing. What every lead is now, and what it will become.
select "leadStatus" as now,
       case "leadStatus"
         when 'working'     then 'noanswer'
         when 'nurturing'   then 'noanswer'
         when 'qualified'   then 'noanswer'
         when 'unqualified' then 'dead'
         else "leadStatus"
       end as becomes,
       count(*) as leads
from public.leads
group by 1, 2
order by leads desc;


-- ── Step 2: rename the old statuses ────────────────────────────────
-- Keeps a copy of every changed row's old status first, so step 5 can
-- put it back. Unqualified leads with no reason get one saying where
-- they came from, so a Do not call is never a mystery.
begin;

create table if not exists public.leads_status_backup_20261026 (
  id text primary key,
  "leadStatus" text,
  "lostReason" text
);
alter table public.leads_status_backup_20261026 enable row level security;

insert into public.leads_status_backup_20261026 (id, "leadStatus", "lostReason")
select id, "leadStatus", "lostReason"
from public.leads
where "leadStatus" in ('working', 'nurturing', 'qualified', 'unqualified')
on conflict (id) do nothing;

update public.leads
   set "lostReason" = case
         when "leadStatus" = 'unqualified' and trim(coalesce("lostReason", '')) = ''
           then 'Not a fit (was Unqualified)'
         else "lostReason"
       end,
       "leadStatus" = case "leadStatus"
         when 'unqualified' then 'dead'
         else 'noanswer'
       end,
       "updatedAt" = now()
 where "leadStatus" in ('working', 'nurturing', 'qualified', 'unqualified');

commit;


-- ── Step 3: the No answer hand-off ─────────────────────────────────
-- Callable by any signed-in user; it checks everything itself. Security
-- definer so it can make the one change RLS would refuse a rep.
create or replace function public.hand_off_lead(p_lead text, p_to text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  l       public.leads;
  caller  text := auth.uid()::text;
  who     text := public.crm_role();
begin
  select * into l from public.leads where id = p_lead;
  if not found then
    raise exception 'That lead no longer exists.';
  end if;

  if not (who = 'admin'
          or (who = 'manager' and coalesce(l.branch, '') = public.crm_branch())
          or l."ownerId" = caller) then
    raise exception 'You can only hand off your own leads.';
  end if;

  if p_to = caller then
    raise exception 'The second call has to go to somebody else.';
  end if;

  if not exists (select 1 from public.profiles p
                  where p.id = p_to and p.active
                    and coalesce(p.branch, '') = coalesce(l.branch, '')) then
    raise exception 'That person cannot take this lead (inactive or another branch).';
  end if;

  update public.leads
     set "ownerId" = p_to, "updatedAt" = now()
   where id = p_lead;
end;
$$;

revoke all on function public.hand_off_lead(text, text) from public;
grant execute on function public.hand_off_lead(text, text) to authenticated;


-- ── Step 4: check it worked ────────────────────────────────────────
-- Expect no working / nurturing / qualified / unqualified rows, and the
-- function listed once.
select "leadStatus", count(*) as leads
from public.leads
group by 1
order by leads desc;

select proname from pg_proc where proname = 'hand_off_lead';


-- ── Step 5: undo step 2 (only if needed) ───────────────────────────
-- update public.leads l
--    set "leadStatus" = b."leadStatus", "lostReason" = b."lostReason"
--   from public.leads_status_backup_20261026 b
--  where l.id = b.id;
