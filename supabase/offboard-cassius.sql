-- ════════════════════════════════════════════════════════════════════
--  Cassius has left TFS. Archive his 84 Brazil leads and close his
--  account.
--
--  Run in the Supabase SQL editor, a step at a time, reading each result
--  before running the next. Nothing is destroyed - step 3 records the
--  state of every lead before it changes, so all of this is reversible
--  from the block at the bottom.
--
--  DO STEP 6 TODAY, whatever happens to the leads. Setting active = false
--  does not revoke a login. Until the Authentication user is banned he can
--  still sign in and export 84 real people's phone numbers.
--
--  WHAT HE HOLDS (20 September export - re-check with step 2)
--     84 leads, every one Florianopolis, Brazil
--     84 with a mockup built: 78 "Ready to send", 6 already "Sent"
--     15 with a follow-up booked
--
--  ARCHIVING, NOT DELETING. The leads keep their mockups, notes, links and
--  history. They move to a closed status so they leave the Active list
--  instead of sitting in it unworked, they get a reason written on them so
--  anyone opening one later knows why, and they get a tag so the whole
--  book can be pulled back in one filter. Reviving one puts it straight
--  back in play and writes "Reopened. Previously closed because: ..." onto
--  the record by itself.
--
--  The owner is deliberately left as Cassius. The book is being shelved,
--  not handed over, and his name on it is the record of who built those
--  78 mockups.
-- ════════════════════════════════════════════════════════════════════


-- ---------------------------------------------------------------------
-- STEP 1 - who is who, and which statuses this CRM actually has.
--
--          Copy his exact email into the CASSIUS@EXAMPLE.COM lines below.
--          Emails, not names: nobody mistypes an address they can see.
--
--          The second query matters. The status list is configurable and
--          yours is not the default one, so pick the id of the closed
--          status you want these parked under - the one with open = false
--          and won = false, something like 'lost' or 'dead' - and put it
--          in the ARCHIVE_STATUS line at step 4.
-- ---------------------------------------------------------------------
select id, name, email, role, branch, active
  from public.profiles
 order by active desc, name;

select id, label, "order", open, won
  from public.statuses
 order by "order";


-- ---------------------------------------------------------------------
-- STEP 2 - look before you leap. Check these numbers match what you
--          expect before anything changes.
-- ---------------------------------------------------------------------
with who as (
  select id from public.profiles
   where lower(email) = lower('CASSIUS@EXAMPLE.COM')
)
select
  (select count(*) from public.leads
    where "ownerId" = (select id from who))                        as "leads he owns",
  (select count(*) from public.leads
    where "ownerId" = (select id from who)
      and (coalesce("mockupUrl",'') <> ''
        or coalesce("mockupDesignUrl",'') <> ''))                  as "with a mockup built",
  (select count(*) from public.leads
    where "ownerId" = (select id from who)
      and coalesce("nextFollowUp",'') <> '')                       as "follow-ups booked",
  (select count(*) from public.tasks
    where "assigneeId" = (select id from who) and status = 'open') as "open call backs";


-- ---------------------------------------------------------------------
-- STEP 3 - remember how every lead looked before it was touched. This is
--          the undo. RLS is on with no policy, so nothing can read it
--          through the API - only this editor.
-- ---------------------------------------------------------------------
create table if not exists public.lead_archive_history (
  "leadId"        text not null,
  "wasStatus"     text not null default '',
  "wasLostReason" text not null default '',
  "wasOwnedBy"    text not null default '',
  "wasFollowUp"   text not null default '',
  "archivedAt"    timestamptz not null default now(),
  reason          text not null default ''
);
alter table public.lead_archive_history enable row level security;

insert into public.lead_archive_history
       ("leadId", "wasStatus", "wasLostReason", "wasOwnedBy", "wasFollowUp", reason)
select l.id,
       coalesce(l."leadStatus", ''),
       coalesce(l."lostReason", ''),
       coalesce(l."ownerId", ''),
       coalesce(l."nextFollowUp", ''),
       'Cassius left TFS - Brazil book archived'
  from public.leads l
 where l."ownerId" = (select id from public.profiles
                       where lower(email) = lower('CASSIUS@EXAMPLE.COM'));
-- The row count must equal "leads he owns" from step 2.


-- ---------------------------------------------------------------------
-- STEP 4 - the archive itself.
--
--          Put the closed status id from step 1 in BOTH places marked
--          ARCHIVE_STATUS. If you get it wrong the update still runs, so
--          check step 5 afterwards and use the undo if it looks wrong.
--
--          The tag is added to whatever tags are already there, and
--          de-duplicated, so running this twice cannot double it up.
-- ---------------------------------------------------------------------
begin;

update public.leads
   set "leadStatus" = 'ARCHIVE_STATUS',
       "lostReason" = 'Brazil book archived - Cassius left TFS, October 2026. '
                   || 'Mockup already built; revive this lead if Brazil restarts.',
       tags         = (
         select coalesce(jsonb_agg(distinct t), '[]'::jsonb)
           from jsonb_array_elements_text(
                  coalesce(tags, '[]'::jsonb) || '["brazil-archived"]'::jsonb
                ) as x(t)
       ),
       "nextFollowUp" = '',
       "updatedAt"    = now()
 where "ownerId" = (select id from public.profiles
                     where lower(email) = lower('CASSIUS@EXAMPLE.COM'));

-- The booked call backs have nobody left to make them, and an open task
-- on a disabled user shows as overdue for ever.
--
-- They have to be closed as 'completed' and not anything tidier, because
-- the app decides a task is finished with status === 'completed' and
-- nothing else - a 'cancelled' task would still be counted as open, still
-- sit in the call back queue and still go overdue, which is the whole
-- problem this is meant to fix.
--
-- 'completed' on its own would say the call was made. So the reason goes
-- on the task itself: the queue is clear and the record still says
-- plainly that nobody rang. Tasks he genuinely completed are not touched.
update public.tasks
   set status        = 'completed',
       "completedAt" = to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
       description   = trim(both ' ' from coalesce(description, ''))
                    || case when coalesce(description,'') = '' then '' else ' ' end
                    || '[Closed without being actioned: Cassius left TFS and the '
                    || 'Brazil book was archived in October 2026. This call was never made.]',
       "updatedAt"   = now()
 where "assigneeId" = (select id from public.profiles
                        where lower(email) = lower('CASSIUS@EXAMPLE.COM'))
   and status = 'open';

commit;


-- ---------------------------------------------------------------------
-- STEP 5 - check it landed. "still open" must be 0, and the archived
--          count must match "leads he owns" from step 2.
-- ---------------------------------------------------------------------
with who as (
  select id from public.profiles
   where lower(email) = lower('CASSIUS@EXAMPLE.COM')
)
select
  (select count(*) from public.leads l
     join public.statuses s on s.id = l."leadStatus"
    where l."ownerId" = (select id from who) and s.open)            as "still open (must be 0)",
  (select count(*) from public.leads
    where "ownerId" = (select id from who)
      and tags @> '["brazil-archived"]'::jsonb)                     as "archived",
  (select count(*) from public.leads
    where "ownerId" = (select id from who)
      and (coalesce("mockupUrl",'') <> ''
        or coalesce("mockupDesignUrl",'') <> ''))                   as "mockups still on the records",
  (select count(*) from public.tasks
    where status = 'open' and "assigneeId" = (select id from who))  as "open call backs (must be 0)",
  (select count(*) from public.lead_archive_history
    where reason = 'Cassius left TFS - Brazil book archived')       as "remembered for undo";


-- ---------------------------------------------------------------------
-- STEP 6 - close the account. Run this even if everything above is
--          postponed.
--
--          This takes him out of the owner dropdowns and the assign
--          dialogs. His name still shows on every record he touched - the
--          rows keep pointing at his profile - so none of the history is
--          lost.
-- ---------------------------------------------------------------------
update public.profiles
   set active      = false,
       "updatedAt" = now()
 where lower(email) = lower('CASSIUS@EXAMPLE.COM');


-- ---------------------------------------------------------------------
-- STEP 7 - THE PART SQL CANNOT DO. Same sitting as step 6.
--
--          active = false does NOT revoke his login. Until this is done
--          he can still sign in, and the leads list, the export button
--          and 84 real people's phone numbers are still in front of him.
--
--          Supabase dashboard → Authentication → Users → his email:
--            · "Ban user"    locks him out, keeps the account, reversible
--            · "Delete user" removes the login entirely
--
--          Ban is the safer one while anything is still being sorted out.
--
--          Afterwards he should be banned or gone there, AND showing
--          active = false here.
-- ---------------------------------------------------------------------
select name, email, role, branch, active
  from public.profiles
 where lower(email) = lower('CASSIUS@EXAMPLE.COM');


-- ════════════════════════════════════════════════════════════════════
--  TO UNDO the archive - every lead back exactly as it was, including
--  whatever status and reason it had before.
--
--  This does not reopen his account: that is step 6 with active = true,
--  plus un-banning him in Authentication → Users.
-- ════════════════════════════════════════════════════════════════════
-- begin;
-- update public.leads l
--    set "leadStatus"   = h."wasStatus",
--        "lostReason"   = h."wasLostReason",
--        "nextFollowUp" = h."wasFollowUp",
--        tags         = (
--          select coalesce(jsonb_agg(t), '[]'::jsonb)
--            from jsonb_array_elements_text(coalesce(l.tags,'[]'::jsonb)) as x(t)
--           where t <> 'brazil-archived'
--        ),
--        "updatedAt"  = now()
--   from public.lead_archive_history h
--  where h."leadId" = l.id
--    and h.reason   = 'Cassius left TFS - Brazil book archived';
-- delete from public.lead_archive_history
--  where reason = 'Cassius left TFS - Brazil book archived';
-- commit;
