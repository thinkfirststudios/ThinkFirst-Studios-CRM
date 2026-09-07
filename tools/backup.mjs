/* A full, verified backup of the live CRM database.
 *
 *   cd supabase && npm install pg && cd ..
 *   node tools/backup.mjs
 *
 * Asks for the database password at a hidden prompt (Supabase Dashboard →
 * Project Settings → Database). It is read locally, used for the one
 * connection, and never written anywhere. Set SUPABASE_DB_PASSWORD to skip
 * the prompt — but do not put it on the command line, where it lands in
 * shell history.
 *
 * WHY NOT JUST THE ADMIN BUTTON: Admin → Data & Backup exports whatever
 * the browser has in memory, which makes the backup only as complete as
 * that session's boot and only as current as its last sync. This reads the
 * database directly, so it is the actual truth, and it works when the app
 * does not.
 *
 * The file it writes is deliberately in the same shape as the in-app
 * export, keyed by collection rather than table name, so it can be fed
 * straight back through Admin → Restore Backup. A backup you cannot
 * restore through a path you have actually used is not a backup.
 */
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PROJECT_REF = 'xfczbofrfsgumeicjuoy';

/* collection -> table, mirroring the TABLES map in js/backend.js. If a
   table is added there and not here the check at the end complains. */
const TABLES = {
  users: 'profiles', customers: 'customers', contacts: 'contacts',
  opportunities: 'opportunities', tasks: 'tasks', vendors: 'vendors',
  leads: 'leads', outreachGroups: 'outreach_groups', outreach: 'outreach',
  workOrders: 'work_orders', notes: 'notes', services: 'services',
  timeEntries: 'time_entries', dailyLogs: 'daily_logs', activity: 'activity',
  statuses: 'statuses', vendorTypes: 'vendor_types', settings: 'settings',
  stripeInvoices: 'stripe_invoices', stripeSubscriptions: 'stripe_subscriptions',
  stripeSyncState: 'stripe_sync_state'
};

const REGIONS = [
  'us-east-1', 'us-west-1', 'us-east-2', 'us-west-2',
  'eu-central-1', 'eu-west-1', 'eu-west-2',
  'ap-southeast-1', 'ap-southeast-2', 'ap-northeast-1', 'sa-east-1', 'ca-central-1'
];

function askHidden(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const onData = () => {
      readline.clearLine(process.stdout, 0);
      readline.cursorTo(process.stdout, 0);
      process.stdout.write(question + '*'.repeat(rl.line.length));
    };
    process.stdin.on('data', onData);
    rl.question(question, (answer) => {
      process.stdin.removeListener('data', onData);
      rl.close(); process.stdout.write('\n'); resolve(answer);
    });
  });
}

const { default: pg } = await import('pg').catch(() => {
  console.error('\nMissing the pg driver. Run:\n\n  cd supabase\n  npm install pg\n');
  process.exit(1);
});

const password = process.env.SUPABASE_DB_PASSWORD || await askHidden('Database password: ');
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
      console.error('\nThat database password was rejected. Reset it in Project Settings → Database.');
      process.exit(1);
    }
  }
}
if (!client) {
  console.error('\nCould not reach the pooler in any known region.');
  process.exit(1);
}

try {
  /* Everything is read inside one repeatable-read transaction, so the dump
     is a single consistent instant rather than a smear across however long
     the read takes. A lead converted to an account midway through would
     otherwise be able to appear in both halves, or neither. */
  await client.query('begin transaction isolation level repeatable read read only');

  const db = { version: 1 };
  const counts = {};
  let total = 0;

  for (const [coll, table] of Object.entries(TABLES)) {
    try {
      const { rows } = await client.query(`select * from public."${table}"`);
      db[coll] = rows;
      counts[coll] = rows.length;
      total += rows.length;
    } catch (e) {
      /* A table that does not exist yet is a setup step, not a failure —
         but say so loudly rather than writing a backup with a hole in it
         that only shows up on the day it is restored. */
      db[coll] = [];
      counts[coll] = null;
      console.log(`  !! ${table}: ${e.message.split('\n')[0]}`);
    }
  }

  /* Anything in the database we are not backing up. A table added to the
     app but never added to the map above would otherwise be missed in
     silence, which is the one failure a backup tool must not have. */
  const { rows: present } = await client.query(
    `select table_name from information_schema.tables
      where table_schema = 'public' and table_type = 'BASE TABLE'`);
  const known = new Set(Object.values(TABLES));
  const unbacked = present.map(r => r.table_name).filter(t => !known.has(t));

  await client.query('commit');

  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  /* Deliberately NOT .tmp/ — that directory is disposable by project
     convention and gets cleaned, which is the one thing a backup must
     survive. gitignored, so it never reaches the repo. */
  const dir = path.join(ROOT, 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `crm-backup-${stamp}.json`);
  fs.writeFileSync(file, JSON.stringify(db, null, 2), 'utf8');

  /* Read it back and parse it. Writing a file is not the same as having
     written a good one, and the moment to find that out is now. */
  const back = JSON.parse(fs.readFileSync(file, 'utf8'));
  const reread = Object.keys(TABLES).every(c => (back[c] || []).length === (counts[c] ?? 0));

  console.log('\n' + file);
  console.log((fs.statSync(file).size / 1024).toFixed(0) + ' KB\n');
  for (const [coll, n] of Object.entries(counts)) {
    if (n === null) console.log(`  ${String(coll).padEnd(22)} MISSING TABLE`);
    else if (n) console.log(`  ${String(coll).padEnd(22)} ${n}`);
  }
  console.log(`  ${'—'.repeat(22)} ${total} rows`);

  if (unbacked.length) {
    console.log('\n  NOT BACKED UP (not in the map in this script and in js/backend.js):');
    unbacked.forEach(t => console.log('    ' + t));
  }

  console.log('\n' + (reread
    ? 'BACKUP VERIFIED — written, read back, and every table matches.'
    : 'WARNING: the file did not read back the way it was written.'));
  console.log('Restore with: Admin → Data & Backup → Restore Backup.');
  process.exit(reread && !unbacked.length ? 0 : 1);
} finally {
  await client.end();
}
