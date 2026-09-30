-- ═══════════════════════════════════════════════════════════════════
--  ThinkFirst Studios CRM — pitch page view counts
--
--  Run AFTER schema.sql, in the Supabase SQL Editor. Idempotent.
--
--  The private pitch pages on thinkfirststudios.com/p/ post a beacon
--  when a prospect opens one. The pitch-view Edge Function receives it
--  and writes here.
--
--  Same shape as the Stripe mirror: the team can SELECT, and there are
--  no INSERT/UPDATE/DELETE policies at all, so only the service role —
--  which only the Edge Function holds — can write. A prospect's browser
--  never touches the database directly, and nothing the CRM does can
--  forge a view.
-- ═══════════════════════════════════════════════════════════════════

-- ── Raw views ──────────────────────────────────────────────────────
-- One row per open. Kept alongside the rollup on the lead because the
-- rollup answers "did they look?" while this answers "how many times,
-- and when" — which is the difference between a follow-up and a nudge.
create table if not exists public.pitch_views (
  id         bigint generated always as identity primary key,
  industry   text        not null default '',   -- website category, e.g. 'Automotive'
  "leadId"   text        not null default '',   -- from ?r=, '' when the link was sent by hand
  "viewedAt" timestamptz not null default now(),
  referrer   text        not null default '',
  "userAgent" text       not null default ''
);

create index if not exists pitch_views_lead_idx     on public.pitch_views ("leadId") where "leadId" <> '';
create index if not exists pitch_views_industry_idx on public.pitch_views (industry);
create index if not exists pitch_views_when_idx     on public.pitch_views ("viewedAt" desc);

alter table public.pitch_views enable row level security;

-- Readable by anyone signed into the CRM. No write policies on purpose.
drop policy if exists pitch_views_read on public.pitch_views;
create policy pitch_views_read on public.pitch_views
  for select to authenticated using (true);


-- ── Rollup on the lead ─────────────────────────────────────────────
-- So the record can show "3 views, last Tuesday" without the CRM
-- querying pitch_views on every render. The CRM checks for these
-- columns before showing the block, so it stays quiet until this runs.
alter table public.leads
  add column if not exists "pitchViews" integer not null default 0;

alter table public.leads
  add column if not exists "pitchViewedAt" timestamptz;


-- ── Keep the rollup in step ────────────────────────────────────────
-- A trigger rather than two writes from the Edge Function: if the
-- function ever fails between the insert and the update, the count and
-- the rows would disagree and nobody would notice for weeks.
create or replace function public.bump_pitch_view() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new."leadId" <> '' then
    update public.leads
       set "pitchViews"    = coalesce("pitchViews", 0) + 1,
           "pitchViewedAt" = new."viewedAt"
     where id = new."leadId";
  end if;
  return new;
end;
$$;

drop trigger if exists pitch_views_bump on public.pitch_views;
create trigger pitch_views_bump
  after insert on public.pitch_views
  for each row execute function public.bump_pitch_view();


-- ── Handy read ─────────────────────────────────────────────────────
-- Which industries actually get opened. Worth looking at before
-- deciding which trade to build the next batch of demos for.
create or replace view public.pitch_view_summary as
  select industry,
         count(*)                                   as views,
         count(distinct "leadId") filter (where "leadId" <> '') as leads,
         max("viewedAt")                            as last_viewed
    from public.pitch_views
   group by industry
   order by views desc;
