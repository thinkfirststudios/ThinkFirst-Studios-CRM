/* Delete leads that came from an import.
 *
 *   node tools/prune-leads.mjs                        # no-phone ones, dry run
 *   node tools/prune-leads.mjs --confirm              # no-phone ones, for real
 *   node tools/prune-leads.mjs --scope=all            # all of them, dry run
 *   node tools/prune-leads.mjs --scope=all --confirm  # all of them, for real
 *
 * Asks for the database password at a hidden prompt, same as backup.mjs.
 * Set SUPABASE_DB_PASSWORD to skip it, but never put it on the command line
 * where it lands in shell history.
 *
 * Scoped deliberately. Only leads whose source is the imported list are
 * considered, so leads that were in the CRM before the import cannot be
 * caught by this however sparse their contact details are.
 *
 * Everything it deletes is written to a JSON file BEFORE the delete runs,
 * so this is reversible. That matters more than usual here: most of these
 * people have an email address, and "no phone" is a judgement about how you
 * want to work the list rather than a fact that makes them worthless.
 */
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PROJECT_REF = 'xfczbofrfsgumeicjuoy';
const SOURCE = 'Realtor List';
const CONFIRM = process.argv.includes('--confirm');

/* Two scopes, and the wider one has to be asked for by name. Defaulting to
   everything would make a mistyped flag a catastrophe instead of a no-op. */
const SCOPE = (process.argv.find(a => a.startsWith('--scope=')) || '--scope=no-phone')
  .split('=')[1];
if (SCOPE !== 'no-phone' && SCOPE !== 'all') {
  console.error(`Unknown --scope=${SCOPE}. Use "no-phone" or "all".`);
  process.exit(1);
}
const WHERE = SCOPE === 'all'
  ? 'source = $1'
  : `source = $1 and (phone is null or btrim(phone) = '')`;

const REGIONS = [
  'us-east-1', 'us-west-1', 'us-east-2', 'us-west-2',
  'eu-central-1', 'eu-west-1', 'eu-west-2',
  'ap-southeast-1', 'ap-southeast-2', 'ap-northeast-1', 'sa-east-1', 'ca-central-1'
];

function ask(question, hidden) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const onData = () => {
      if (!hidden) return;
      readline.clearLine(process.stdout, 0);
      readline.cursorTo(process.stdout, 0);
      process.stdout.write(question + '*'.repeat(rl.line.length));
    };
    process.stdin.on('data', onData);
    rl.question(question, (answer) => {
      process.stdin.removeListener('data', onData);
      rl.close();
      if (hidden) process.stdout.write('\n');
      resolve(answer);
    });
  });
}

const { default: pg } = await import('pg').catch(() => {
  console.error('\nMissing the pg driver. Run:  npm install pg\n');
  process.exit(1);
});

const password = process.env.SUPABASE_DB_PASSWORD || await ask('Database password: ', true);
if (!password) { console.error('No password given.'); process.exit(1); }

let client = null;
for (const region of REGIONS) {
  process.stdout.write(`connecting via ${region}… `);
  const c = new pg.Client({
    host: `aws-0-${region}.pooler.supabase.com`, port: 5432,
    user: `postgres.${PROJECT_REF}`, password, database: 'postgres',
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 8000, statement_timeout: 120000
  });
  try { await c.connect(); client = c; console.log('connected'); break; }
  catch (err) {
    const m = err.message || String(err);
    console.log(m.slice(0, 60));
    if (/password authentication failed/i.test(m)) {
      console.error('\nThat password was rejected. Reset it in Project Settings → Database.');
      process.exit(1);
    }
  }
}
if (!client) { console.error('\nCould not reach the pooler in any region.'); process.exit(1); }

try {
  const { rows: all } = await client.query(
    `select count(*)::int as n from public.leads where source = $1`, [SOURCE]);
  const { rows: doomed } = await client.query(
    `select * from public.leads where ${WHERE} order by name`, [SOURCE]);

  console.log(`\nleads from "${SOURCE}": ${all[0].n}`);
  console.log(SCOPE === 'all'
    ? `scope: ALL of them — ${doomed.length} would be deleted`
    : `of those, with no phone number: ${doomed.length}`);

  if (!doomed.length) {
    console.log('\nNothing to do.');
    process.exit(0);
  }

  const withEmail = doomed.filter(r => (r.email || '').trim()).length;
  console.log(`  ${withEmail} of them still have an email address`);
  console.log(`  ${doomed.length - withEmail} have neither a phone nor an email`);

  const ids = doomed.map(r => r.id);
  const { rows: notes } = await client.query(
    `select * from public.notes where "entityType" = 'lead' and "entityId" = any($1)`, [ids]);
  console.log(`  ${notes.length} attached notes would go with them`);

  console.log('\nfirst few:');
  doomed.slice(0, 8).forEach(r => {
    console.log(`  ${String(r.name).slice(0, 34).padEnd(34)} ${(r.email || '(no email)').slice(0, 38)}`);
  });
  if (doomed.length > 8) console.log(`  … and ${doomed.length - 8} more`);

  if (!CONFIRM) {
    console.log('\nThis was a dry run. Nothing was deleted.');
    console.log(`Run again with --scope=${SCOPE} --confirm to go ahead.`);
    process.exit(0);
  }

  /* Written before anything is deleted, so a change of mind is a restore
     rather than a re-import of the whole list. */
  const dir = path.join(ROOT, 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const file = path.join(dir, `deleted-leads-${stamp}.json`);
  fs.writeFileSync(file, JSON.stringify({ leads: doomed, notes }, null, 2), 'utf8');
  const back = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (back.leads.length !== doomed.length) {
    console.error('\nThe rescue file did not read back correctly. Stopping without deleting.');
    process.exit(1);
  }
  console.log(`\nsaved ${back.leads.length} leads and ${back.notes.length} notes to`);
  console.log('  ' + file);

  const answer = await ask(`\nType the number ${doomed.length} to delete them: `);
  if (answer.trim() !== String(doomed.length)) {
    console.log('Not confirmed. Nothing deleted.');
    process.exit(0);
  }

  /* Both deletes in one transaction: leads without their notes, or notes
     without their leads, is a worse state than either doing nothing or
     doing all of it. */
  await client.query('begin');
  const delNotes = await client.query(
    `delete from public.notes where "entityType" = 'lead' and "entityId" = any($1)`, [ids]);
  const delLeads = await client.query(
    `delete from public.leads where id = any($1)`, [ids]);
  await client.query('commit');

  const { rows: left } = await client.query(
    `select count(*)::int as n from public.leads where source = $1`, [SOURCE]);
  const { rows: stillBlank } = await client.query(
    `select count(*)::int as n from public.leads
      where source = $1 and (phone is null or btrim(phone) = '')`, [SOURCE]);
  const summary = SCOPE === 'all'
    ? `"${SOURCE}" now holds ${left[0].n} leads`
    : `"${SOURCE}" now holds ${left[0].n} leads, ${stillBlank[0].n} of them without a phone`;

  console.log(`\ndeleted ${delLeads.rowCount} leads and ${delNotes.rowCount} notes`);
  console.log(summary);
  console.log('\nReload the CRM to see it.');
  console.log('To undo: Admin → Data & Backup → Restore Backup will not merge, so restore');
  console.log('the full backup instead, or hand me ' + path.basename(file) + ' and I will re-import it.');
} finally {
  await client.end();
}
