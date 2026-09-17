-- Hand one rep's whole book to another, when a rep leaves.
--
-- Frank has gone, so his leads, his open call backs and his follow-ups go to
-- Josh. 736 leads is too many to select in the UI a page at a time, and the
-- UI cannot move the call backs at all - they are tasks assigned to Frank,
-- and if they stay assigned to Frank then Josh inherits the leads without
-- the reminders attached to them.
--
-- Run this in the Supabase SQL editor, a step at a time, reading each result
-- before running the next. Nothing is destroyed: step 2 keeps a record of
-- who owned what, so this can be undone.
--
-- Set these two first. Emails, not names - two people can share a name and
-- nobody mistypes an address they can see in the users list.

-- ---------------------------------------------------------------------
-- STEP 0 - who is who. Copy the two emails out of this into the lines
--          marked LEAVING and TAKING OVER below.
-- ---------------------------------------------------------------------
select id, name, email, role, branch, active
  from public.profiles
 order by active desc, name;


-- ---------------------------------------------------------------------
-- STEP 1 - look before you leap. Run this and read the numbers. If
--          "leaving" or "taking over" is 0, an email is wrong - fix it
--          before going on. Nothing is changed by this step.
-- ---------------------------------------------------------------------
with who as (
  select
    (select id from public.profiles where lower(email) = lower('FRANK@EXAMPLE.COM')) as leaving,
    (select id from public.profiles where lower(email) = lower('JOSH@EXAMPLE.COM'))  as taking
)
select
  (select count(*) from public.profiles p, who w where p.id = w.leaving)         as "leaving  (must be 1)",
  (select count(*) from public.profiles p, who w where p.id = w.taking)          as "taking over (must be 1)",
  (select count(*) from public.leads    l, who w where l."ownerId" = w.leaving)  as "leads that move",
  (select count(*) from public.tasks    t, who w where t."assigneeId" = w.leaving
     and t.status = 'open')                                                      as "open call backs/tasks that move",
  (select count(*) from public.leads    l, who w where l."ownerId" = w.leaving
     and l."nextFollowUp" <> '' and l."nextFollowUp" <= to_char(now(), 'YYYY-MM-DD'))
                                                                                 as "of those leads, overdue today",
  (select count(distinct l.branch) from public.leads l, who w where l."ownerId" = w.leaving)
                                                                                 as "branches involved (expect 1)",
  (select p.branch from public.profiles p, who w where p.id = w.taking)          as "branch of the one taking over";


-- ---------------------------------------------------------------------
-- STEP 2 - keep a record of who owned what, so this is reversible. RLS is
--          switched on with no policy, which means nothing can read it
--          through the API - only this editor. Undo is at the bottom.
-- ---------------------------------------------------------------------
create table if not exists public.lead_owner_history (
  "leadId"      text not null,
  "wasOwnedBy"  text not null,
  "movedTo"     text not null,
  "movedAt"     timestamptz not null default now(),
  reason        text not null default ''
);
alter table public.lead_owner_history enable row level security;

insert into public.lead_owner_history ("leadId", "wasOwnedBy", "movedTo", reason)
select l.id, l."ownerId", w.taking, 'rep left - book handed over'
  from public.leads l,
       (select
          (select id from public.profiles where lower(email) = lower('FRANK@EXAMPLE.COM')) as leaving,
          (select id from public.profiles where lower(email) = lower('JOSH@EXAMPLE.COM'))  as taking) w
 where l."ownerId" = w.leaving
   and w.taking is not null;
-- Read the row count. It must equal "leads that move" from step 1.


-- ---------------------------------------------------------------------
-- STEP 3 - the handover itself. Both statements or neither.
--
-- A wrong email fails safe: the subquery gives null, the where clause
-- matches nothing, and the not-null constraint on "ownerId" rejects a null
-- rather than blanking the column.
-- ---------------------------------------------------------------------
begin;

update public.leads
   set "ownerId"  = (select id from public.profiles where lower(email) = lower('JOSH@EXAMPLE.COM')),
       "updatedAt" = now()
 where "ownerId" = (select id from public.profiles where lower(email) = lower('FRANK@EXAMPLE.COM'));

-- The call backs and follow-up tasks sitting on those leads. Only the open
-- ones: a task Frank completed is a record of what Frank did, and rewriting
-- it would make the history say Josh made calls he never made.
update public.tasks
   set "assigneeId" = (select id from public.profiles where lower(email) = lower('JOSH@EXAMPLE.COM')),
       "updatedAt"  = now()
 where "assigneeId" = (select id from public.profiles where lower(email) = lower('FRANK@EXAMPLE.COM'))
   and status = 'open';

commit;


-- ---------------------------------------------------------------------
-- STEP 4 - check it landed. "left behind" must be 0 and "now Josh's" must
--          have grown by the number from step 1.
-- ---------------------------------------------------------------------
select
  (select count(*) from public.leads where "ownerId" =
     (select id from public.profiles where lower(email) = lower('FRANK@EXAMPLE.COM')))  as "left behind (must be 0)",
  (select count(*) from public.leads where "ownerId" =
     (select id from public.profiles where lower(email) = lower('JOSH@EXAMPLE.COM')))   as "now Josh's",
  (select count(*) from public.tasks where status = 'open' and "assigneeId" =
     (select id from public.profiles where lower(email) = lower('FRANK@EXAMPLE.COM')))  as "call backs left behind (must be 0)";


-- ---------------------------------------------------------------------
-- STEP 5 - close the leaver's account. Separate from the handover on
--          purpose: someone who has left should not be able to sign in and
--          read, or export, a book of real people's phone numbers. Do this
--          even if the handover is postponed.
--
--          This stops the CRM showing them as a person work can be given
--          to. It does NOT revoke their login - that is Authentication →
--          Users in the dashboard, where the user must also be deleted or
--          banned. Both are needed.
-- ---------------------------------------------------------------------
update public.profiles
   set active = false,
       "updatedAt" = now()
 where lower(email) = lower('FRANK@EXAMPLE.COM');


-- ---------------------------------------------------------------------
-- UNDO - only if step 4 says something went wrong. Puts every lead back
--        with whoever held it before the most recent move.
-- ---------------------------------------------------------------------
-- update public.leads l
--    set "ownerId" = h."wasOwnedBy", "updatedAt" = now()
--   from (select distinct on ("leadId") "leadId", "wasOwnedBy"
--           from public.lead_owner_history order by "leadId", "movedAt" desc) h
--  where l.id = h."leadId";
