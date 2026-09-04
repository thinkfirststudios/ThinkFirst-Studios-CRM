# Tests

No framework and no install step — plain Node and headless Edge.

    node tests/dates.js                      # one suite
    for f in tests/*.js; do node "$f"; done   # all of them
    powershell -File tests/render-check.ps1   # every route, in a real browser
    powershell -File tests/bulk-check.ps1     # the bulk follow-up flow, clicked

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

These used to live in a temp directory and were lost when it was cleaned.
Keep them here.
