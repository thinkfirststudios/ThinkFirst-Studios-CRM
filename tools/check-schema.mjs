/* Is the live database ready for the fields we are about to import?
 *
 *   node tools/check-schema.mjs
 *
 * Needs no password. Row-level security hides the DATA from the anon key,
 * but PostgREST still reports a missing COLUMN before it ever gets to the
 * policy check — asking for a column that does not exist returns 42703
 * either way. That is enough to tell whether a migration has been run.
 *
 * This matters before a bulk import because backend.js deliberately strips
 * fields whose columns are absent, so one un-run migration does not reject
 * every row. The cost of that kindness is silence: the import succeeds and
 * the handles are simply gone. Better to know first.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const cfg = readFileSync(join(ROOT, 'js', 'config.js'), 'utf8');
const url = (cfg.match(/url:\s*'([^']+)'/) || [])[1];
const key = (cfg.match(/anonKey:\s*'([^']+)'/) || [])[1];
if (!url || !key) {
  console.error('js/config.js has no Supabase url/anonKey — nothing to check.');
  process.exit(1);
}

/* Grouped by the migration that adds them, so a failure names the fix. */
const GROUPS = [
  { table: 'leads', migration: 'the socials migration',
    cols: ['instagram', 'tiktok', 'facebook'] },
  { table: 'leads', migration: 'the mockup migration',
    cols: ['mockupStatus', 'mockupTypes', 'mockupUrl', 'mockupReadyAt', 'mockupSentAt'] },
  { table: 'leads', migration: 'the dead-lead migration',
    cols: ['lostReason'] },
  { table: 'leads', migration: 'the conversion migration',
    cols: ['outreachId', 'convertedContactId', 'convertedOpportunityId'] },
  /* Straight from the create table in supabase/schema.sql. A lead's notes
     live in their own table keyed by entity, so there is no notes column
     here and asking for one is a false alarm. */
  { table: 'leads', migration: 'core (should always be present)',
    cols: ['id', 'name', 'contactName', 'contactTitle', 'email', 'phone',
           'leadStatus', 'rating', 'source', 'ownerId', 'estValue',
           'nextFollowUp', 'lastContactedAt', 'industry', 'address',
           'website', 'tags', 'convertedCustomerId', 'convertedAt',
           'createdAt', 'updatedAt'] },
  { table: 'notes', migration: 'notes are their own table, not a lead column',
    cols: ['id', 'entityType', 'entityId', 'body'] }
];

async function has(table, col) {
  const r = await fetch(
    `${url}/rest/v1/${table}?select=${encodeURIComponent('"' + col + '"')}&limit=1`,
    { headers: { apikey: key, Authorization: 'Bearer ' + key } });
  if (r.ok) return true;
  const body = await r.text();
  if (/42703|does not exist/i.test(body)) return false;
  throw new Error(`${table}.${col}: HTTP ${r.status} ${body.slice(0, 160)}`);
}

const missing = [];
console.log('Checking the live schema at ' + url.replace(/https:\/\//, '') + '\n');
for (const g of GROUPS) {
  const gone = [];
  for (const c of g.cols) {
    try { if (!(await has(g.table, c))) gone.push(c); }
    catch (e) { console.log('  ??   ' + e.message); }
  }
  if (gone.length) {
    missing.push({ ...g, gone });
    console.log(`  MISSING  ${g.table}: ${gone.join(', ')}`);
    console.log(`           (${g.migration})`);
  } else {
    console.log(`  ok       ${g.table}: ${g.cols.length} columns — ${g.migration}`);
  }
}

if (missing.length) {
  console.log('\nAnything imported into those fields will be dropped on the way in.');
  console.log('Run the migration first, or accept the loss knowingly.');
  process.exit(1);
}
console.log('\nSCHEMA READY — every field the importer writes has a column.');
