# ThinkFirst Studios CRM

A Salesforce-style CRM for ThinkFirst Studios — customers, vendors, work orders and
an everyday tracker, built on the brand guide (orange `#FA7700` on near-black).

**No build step. No install.** Runs as static files, backed by Supabase for the shared
team version or by `localStorage` for offline use.

---

## Running it

```bash
npx serve .
```

Or just open `index.html` — the app uses classic scripts, so `file://` works for the
offline mode. Use a served URL for the Supabase version, since auth email links need
somewhere real to return to.

## What's in it

| Section | What it does |
|---|---|
| **Home** | Open pipeline, recurring revenue, close rate, overdue work, your queue, billing radar, team activity |
| **Customers** | Filterable list view, full record page, CSV export |
| **Pipeline** | Drag-and-drop kanban across the statuses |
| **Daily Tracker** | The everyday work-order board — see below |
| **Work Orders** | Every job across customers *and* vendors, with time logging |
| **Vendors** | Same fields as customers, plus vendor type, payment terms and rating |
| **Billing** | One calendar of incoming (customer) and outgoing (vendor) billing dates |
| **Admin** | Users & roles, service catalog, statuses, vendor types, backup/restore, audit log |

### The requested fields

- **Status** — Follow Up, Sale Lost and Pending ship by default, alongside New and Active.
  Fully editable in **Admin → Pipeline Statuses** (label, colour, order, and whether a
  status counts as open pipeline or as won revenue).
- **Billing Date** — on both customers and vendors, with cycle (Monthly / Quarterly /
  Annual / One-Time / Retainer) and value. Everything rolls up into the Billing calendar
  with overdue and "due in N days" flags.
- **Services** — a catalog managed in Admin, attached to customers, vendors and work orders.
- **Customer notes by different people** — every note is stamped with its author and time.
  Switch the acting user from the chip in the top-right; notes, activity and time entries
  are all attributed to whoever is acting. Notes can be pinned so the whole team sees them
  first, and each record shows who has contributed.

### Daily Tracker

The everyday work-order screen:

- Seven-day strip with per-day load, and a date picker for any other day
- **Roll-forward**: anything still open past its due date automatically appears on today's
  board in a "Rolled Over — Past Due" section, so nothing quietly disappears
- Group the board by status or by person; filter to **My day** or the whole **Team**
- One-click complete, inline time logging against estimates
- Team Load panel (who's carrying what, % done, hours)
- End-of-day log saved per person, per day

### Vendors

Vendors carry the same categories as customers — status, billing date, services, notes,
owner — plus **vendor type** (Subcontractor, Supplier, Freelancer, Software/SaaS, Agency
Partner, Print/Fabrication, Media Buyer — all editable in Admin) and their own **work
orders**, which flow into the same Daily Tracker as customer work.

## Two modes

The app reads `js/config.js` at boot and runs one of two ways.

| | **Offline** (blank config) | **Live** (Supabase configured) |
|---|---|---|
| Storage | `localStorage`, this browser only | Shared Postgres |
| Accounts | None — pick a teammate from the chip | Real sign-in |
| Sharing | Nothing is shared | Whole team, updating live |
| Roles | UI-level only | Enforced by the database |

The top bar shows which one you're in: **Live** or **Offline**.

The offline mode is the demo — it ships with sample accounts so every screen has something
in it. If the backend is configured but unreachable, the app **stops with an error rather
than silently falling back**, so a connection problem never looks like your team's data
vanished.

## Setting up the live version

**1. Create the tables.** Supabase Dashboard → **SQL Editor** → New query → paste all of
[`supabase/schema.sql`](supabase/schema.sql) → Run. It's idempotent, so re-running is safe.
This creates the tables, the row-level security policies, realtime, and the reference data.

> If the dashboard itself is down (`Failed to fetch (api.supabase.com)`), the SQL Editor is
> unavailable but your project's database is a separate service and is usually still fine.
> [`supabase/apply-schema.mjs`](supabase/apply-schema.mjs) applies the same file directly
> over the connection pooler: `cd supabase && npm install pg && node apply-schema.mjs`.
> It prompts for your database password locally. That `pg` install is for this script only —
> the app itself stays dependency-free.

**2. Point the app at your project.** Fill in `url` and `anonKey` in
[`js/config.js`](js/config.js). That key is the *publishable/anon* key — it's designed to
ship in client code and is safe to commit. Your security is the RLS policies from step 1,
which is why step 1 is not optional. A `service_role` key must **never** go in this file.

**3. Host it.** Auth email links need a real URL to return to — they can't redirect to a
`file://` path. Either:

- **GitHub Pages** — Settings → Pages → Source `main` / `/ (root)`, or
- **Locally** — `npx serve -l 3000`

Then set Supabase → **Authentication → URL Configuration → Site URL** to that address.
If you leave it as the default `http://localhost:3000` and nothing is running there,
confirmation links land on *"This site can't be reached"* — the account is still created
and confirmed, the redirect just has nowhere to go.

**4. Sign up.** The first account becomes the **admin**; everyone after starts as a **rep**,
and an admin promotes them in Admin → Users & Roles. If you signed up before running
step 1, re-run `schema.sql` — it backfills a profile for any existing login and makes the
earliest account the admin.

> For a small internal team, consider turning off **Authentication → Sign In / Providers →
> Email → Confirm email**. Sign-up then works instantly with no email round-trip and no
> redirect to get wrong.

## Access model

Every signed-in teammate **sees everything** — all customers, vendors, work orders and notes.

- **admin** — the Admin panel and all setup tables (services, statuses, vendor types)
- **manager** — can delete records
- **rep** — day-to-day use: create and edit anything, delete nothing

Reads and writes are open to the whole team; deletes and setup are restricted. Those rules
live in the database policies, not just the interface, so they hold even if someone pokes at
the API directly. In offline mode the acting-user switcher is a convenience, not
authentication — it exists so you can see how multi-author notes behave.

## Stripe

Stripe is mirrored into the CRM so the Billing screen shows what customers
*actually* paid, rather than dates somebody typed in. It is **read-only in one
direction**: the CRM never writes to Stripe, and nothing in the app can write to
the mirror tables — they have SELECT policies and no INSERT/UPDATE/DELETE
policies, so only the Edge Function's service role can fill them. The CRM
therefore cannot drift out of step with what you billed.

Customers are linked by `stripeCustomerId`. Anyone without one keeps their manual
billing fields and is labelled **Tracked manually** — deliberately *not* styled as
unpaid, because "we don't bill them through Stripe" and "they haven't paid" are
very different things.

### Setup

1. **Restricted API key.** Stripe → Developers → API keys → Create restricted key →
   template **"Reporting, analytics, and accounting"** (read-only). Needs Read on
   Customers, Invoices, Subscriptions, Charges, Products, Prices. Never use the
   standard `sk_live_` secret key — it can move money.
2. **Store it.** Supabase → Edge Functions → Secrets → `STRIPE_SECRET_KEY`.
3. **Tables.** Run [`supabase/stripe.sql`](supabase/stripe.sql) in the SQL Editor.
4. **Deploy the function:**
   ```bash
   npx supabase functions deploy stripe-sync --project-ref xfczbofrfsgumeicjuoy
   ```
5. **Webhook.** Stripe → Developers → Webhooks → Add endpoint → the function's URL
   (`https://<ref>.supabase.co/functions/v1/stripe-sync`). Subscribe to
   `invoice.paid`, `invoice.payment_failed`, `invoice.finalized`, `invoice.updated`,
   `invoice.voided`, `customer.subscription.created/updated/deleted`.
6. **Signing secret.** Copy the `whsec_…` → Supabase secret `STRIPE_WEBHOOK_SECRET`.
   Until this is set the function rejects webhooks — without signature verification
   anyone could POST a fake "paid" event.
7. **Backfill.** Admin → Stripe → **Pull everything from Stripe**. Safe to re-run;
   everything upserts on Stripe ids.

Unmatched invoices (Stripe customers with no CRM counterpart) are listed in
Admin → Stripe. The function auto-links by email once, then remembers.

## Backups

**Admin → Data & Backup** exports the whole database as JSON and restores it, in either
mode. Because record ids are plain text and carry across, a backup taken from the offline
version imports straight into Supabase with its ids intact — that's the migration path if
you've already entered real data locally.

Customers, vendors and billing also export to CSV.

## How the backend swap works

`js/backend.js` is an adapter with two implementations behind one interface; `js/store.js`
keeps a synchronous in-memory cache either way — hydrate once at boot, write through on
every change, fold teammates' realtime changes back in. That's why moving from localStorage
to Postgres needed **no changes to any view file**.

## Shortcuts

- `/` — focus global search (customers, vendors, work orders, note bodies)
- `Ctrl+Shift+N` — quick create
- `Ctrl+Enter` — post a note
- `Esc` — close a dialog

## Layout

```
index.html          shell: topbar, nav rail, overlay roots
css/app.css         design tokens from the brand guide + all components
assets/             logo mark (SVG)
js/store.js         schema, seed data, CRUD, audit trail  ← the only persistence layer
js/ui.js            rendering primitives: tables, badges, modals, notes, timeline
js/app.js           hash router, global search, user switcher, shortcuts
js/views/           one file per screen
```
