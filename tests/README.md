# Tests

No framework and no install step — plain Node and headless Edge.

    node tests/dates.js                      # one suite
    for f in tests/*.js; do node "$f"; done   # all of them
    powershell -File tests/render-check.ps1   # every route, in a real browser
    powershell -File tests/bulk-check.ps1     # the bulk follow-up flow, clicked
    powershell -File tests/import-check.ps1   # paste, map and import a CSV
    powershell -File tests/bulk-scale.ps1     # clear 2,526 follow-ups at once
    powershell -File tests/import-scale.ps1   # import 2,526 rows, with notes
    powershell -File tests/import-real.ps1    # import the actual realtor CSV
    powershell -File tests/scroll-check.ps1   # scroll survives a repaint
    powershell -File tests/my-leads.ps1       # a rep lands on their own leads

Each `.js` suite boots the real `js/store.js` and `js/backend.js` against a
stubbed Supabase client, so it exercises the shipping code rather than a
copy of it. A suite prints `ALL PASS` and exits 0, or lists failures and
exits 1.

`render-check.ps1` stages a copy of the app with a blank config (which puts
it in local/demo mode with seed data), then loads every route in headless
Edge and checks the expected content rendered.

`bulk-check.ps1` stages the app the same way but injects a driver that
clicks through the bulk follow-up flow — tick, count, select-all, apply,
unschedule — because a route that renders is not the same as a checkbox
that works.

`branches.js` covers territories: a manager sees their branch and no
other, a rep sees their own leads wherever they are, and a blank branch
is a branch rather than a special case - which is what lets this ship
before anybody is configured. It runs in local mode because switching
who is acting is the whole subject, and only local mode allows it.

`owner-lock.js` covers who may be named as an owner: a rep gets their
name and no picker, and the value posted is the record's current owner so
that opening a teammate's account and pressing Save does not take it over.
Its last assertion reads the view sources and fails if a new screen builds
an owner select of its own, which is how the rule stays in one place.

`signin-log.js` covers sign-ins reaching the activity feed, and - the
half that matters - staying quiet for reloads, second tabs and restored
sessions, so the log never fills with events nobody performed.

`assign.js` covers splitting a list between reps: even shares, dealt
rather than sliced into regional blocks, nothing outside the selection
touched, and each person's follow-up queue holding only their own.

`bulk-delete.js` covers the one action with no undo: that the selection
is respected exactly, that a lead takes its notes with it rather than
leaving orphans in the totals, and that the delete goes out as one
request per chunk rather than one per row.

`attention.js` pins what "Follow Up Now" means: overdue or due today,
never a lead nobody has scheduled. Narrowing it is what stops a large
undated import from reading as thousands of things due now, and the suite
checks the real work still shows up.

`paging.js` is the one to keep an eye on. Supabase caps an API response at
the project's "Max rows" setting and reports no error when it truncates, so
a table that outgrows the cap starts disappearing in silence. The suite
stubs a server that enforces a cap and checks every row still arrives.

These used to live in a temp directory and were lost when it was cleaned.
Keep them here.
