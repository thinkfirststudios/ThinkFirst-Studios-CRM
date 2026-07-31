# ThinkFirst Studios CRM

A Salesforce-style CRM for ThinkFirst Studios — customers, vendors, work orders and
an everyday tracker, built on the brand guide (orange `#FA7700` on near-black).

**Zero dependencies. No build step. No install.** Open `index.html` and it runs.

---

## Running it

Double-click `index.html`, or serve the folder:

```bash
npx serve .
```

Either works — the app uses classic scripts, so `file://` is fine.

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

## Where the data lives

Everything is in this browser's `localStorage` under `tfs_crm_v1`. That means:

- It works offline and starts instantly
- **It does not sync between machines or teammates** — each browser holds its own copy
- Clearing site data wipes it

Use **Admin → Data & Backup** to export a JSON snapshot (the portable copy) or restore one.
Customers, vendors and billing also export to CSV.

The app ships with demo data so every screen has something in it. **Admin → Data & Backup →
Clear all records** empties it for real use while keeping your users and service catalog.

## Making it multi-user

`js/store.js` is the only file that touches persistence — every view goes through its API
(`all`, `find`, `insert`, `update`, `remove`, plus the domain helpers). Swapping the
`load()`/`save()` pair for `fetch()` calls against a real API is a contained change; the
views don't need to know.

## Roles

Set per user in Admin:

- **admin** — full setup access, including the Admin panel
- **manager** — can delete records and reassign ownership
- **rep** — day-to-day CRM use

The acting-user switcher is a convenience for a single shared machine, not authentication.
Real auth belongs with the server-backed version above.

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
