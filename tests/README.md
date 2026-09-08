# Tests

No framework and no install step — plain Node and headless Edge.

    node tests/dates.js                      # one suite
    for f in tests/*.js; do node "$f"; done   # all of them
    powershell -File tests/render-check.ps1   # every route, in a real browser
    powershell -File tests/bulk-check.ps1     # the bulk follow-up flow, clicked
    powershell -File tests/import-check.ps1   # paste, map and import a CSV
    powershell -File tests/bulk-scale.ps1     # clear 2,526 follow-ups at once

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

`paging.js` is the one to keep an eye on. Supabase caps an API response at
the project's "Max rows" setting and reports no error when it truncates, so
a table that outgrows the cap starts disappearing in silence. The suite
stubs a server that enforces a cap and checks every row still arrives.

These used to live in a temp directory and were lost when it was cleaned.
Keep them here.
