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
    powershell -File tests/zone-filter.ps1    # filter the list to one coast
    powershell -File tests/shield-admin.ps1   # who gets the cover on focus loss

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

`import-brazil.ps1` drives the real Brazil CSV through the real dialog.
It exists because that file breaks importers in ways the US one does not:
accented names, social profiles instead of websites, and fifteen agents
behind one brokerage domain. It caught the dedupe bug below. Its literals
are \uXXXX escapes - PowerShell 5.1 reads a BOM-less .ps1 as ANSI, so a
non-ASCII character in the driver arrives mangled and the test then fails
on its own encoding rather than on the app.

`dedupe.js` also covers the roster case: many people, one domain. Keying
on the domain alone made all fifteen Invista agents the same lead, so
fourteen realtors were dropped as duplicates - and the import still
reported success, which is the part that would have gone unnoticed.


`branch-field.js` covers a lead carrying its branch out of the form. The
form had no branch input at all, and UI.values() only collects named
inputs, so a lead added by hand saved with no branch - the blank one, the
US - and a manager in Brazil would have filed it where they cannot see it.
It also covers settling on one spelling, because "brazil" beside "Brazil"
is two territories and the symptom is an empty list.

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

`pre-upload.js` is the one to run on a new batch of CRM-READY files:

    node tests/pre-upload.js --ready A.csv B.csv --sources sheetA.csv sheetB.csv

It reads them with the importer's real header matcher and the store's real
`parseTags`, `zoneOf`, `zoneLabel` and `leadKey`, because a prep tool that
produces a tidy CSV proves nothing about what the CRM will make of it.
Every list since September has arrived in a different column shape and the
failures keep being the same four: a header read as the wrong field, tags
welded into one, a Location the zone logic cannot read, and two leads
keying as the same lead.

With `--sources` it also does the one check the prep tools cannot do for
themselves. The researcher writes a TZ column by hand, so the zone the CRM
derives from the Location can be compared against what a person said. Two
independent signals disagreeing is the cheapest bug detector available
without live data, and on its first run it found a Flower Mound tennis
coach filed in Mountain time because his mobile is an Arizona number.

`young-owner-import.js` reads the five CSVs of a batch before it is
uploaded, using the importer's real header matcher and the store's real
`parseTags`, `zoneOf` and `leadKey`. A prep tool producing a tidy CSV
proves nothing; what matters is what the CRM makes of it. It caught three
things on its first run: 140 Instagram handles dropped at the last step
because the output gate only passed values containing "insta" and these
were bare `@handles`; a 45-character unfilterable tag built out of an
industry with commas in it; and a wrap shop in Ontario, California filed
as being in Canada. It needs the files in `~/Downloads`, so it is a
pre-upload check rather than part of a normal run.

`paging.js` is the one to keep an eye on. Supabase caps an API response at
the project's "Max rows" setting and reports no error when it truncates, so
a table that outgrows the cap starts disappearing in silence. The suite
stubs a server that enforces a cap and checks every row still arrives.

These used to live in a temp directory and were lost when it was cleaned.
Keep them here.
