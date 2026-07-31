/* ═══════════════════════════════════════════════════════════════════
   apply-schema.mjs — run schema.sql straight against Postgres.

   Only needed when the Supabase dashboard's SQL Editor is unavailable.
   Normally you would just paste schema.sql into the SQL Editor.

   This is an ops script, not part of the app — the CRM itself still has
   no dependencies. It needs the `pg` driver:

     cd supabase
     npm install pg
     node apply-schema.mjs

   It asks for your database password (Supabase Dashboard → Project
   Settings → Database → Database password — the one set when the
   project was created). The password is read locally and never written
   to disk or printed.
   ═══════════════════════════════════════════════════════════════════ */

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_REF = 'xfczbofrfsgumeicjuoy';

/* Free-tier direct connections are IPv6-only, so go through the IPv4
   pooler in session mode (5432 — transaction mode can't run all DDL).
   The project's region isn't knowable offline, so try the common ones. */
const REGIONS = [
  'us-east-1', 'us-west-1', 'us-east-2', 'us-west-2',
  'eu-central-1', 'eu-west-1', 'eu-west-2',
  'ap-southeast-1', 'ap-southeast-2', 'ap-northeast-1', 'sa-east-1', 'ca-central-1'
];

function askHidden(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const onData = (char) => {
      if (String(char) === '\n' || String(char) === '\r' || String(char) === '') {
        process.stdin.removeListener('data', onData);
      } else {
        readline.clearLine(process.stdout, 0);
        readline.cursorTo(process.stdout, 0);
        process.stdout.write(question + '*'.repeat(rl.line.length));
      }
    };
    process.stdin.on('data', onData);
    rl.question(question, (answer) => { rl.close(); process.stdout.write('\n'); resolve(answer); });
  });
}

const { default: pg } = await import('pg').catch(() => {
  console.error('\nMissing the pg driver. Run:\n\n  cd supabase\n  npm install pg\n');
  process.exit(1);
});

const sql = fs.readFileSync(path.join(HERE, 'schema.sql'), 'utf8');
console.log(`Loaded schema.sql (${sql.length.toLocaleString()} chars)\n`);

const password = process.env.SUPABASE_DB_PASSWORD || await askHidden('Database password: ');
if (!password) { console.error('No password given.'); process.exit(1); }

async function tryRegion(region) {
  const client = new pg.Client({
    host: `aws-0-${region}.pooler.supabase.com`,
    port: 5432,
    user: `postgres.${PROJECT_REF}`,
    password,
    database: 'postgres',
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 8000,
    statement_timeout: 120000
  });
  await client.connect();
  return client;
}

let client = null;
for (const region of REGIONS) {
  process.stdout.write(`connecting via ${region}… `);
  try {
    client = await tryRegion(region);
    console.log('connected');
    break;
  } catch (err) {
    const m = err.message || String(err);
    console.log(m.slice(0, 60));
    /* A password rejection means the region was right — stop guessing. */
    if (/password authentication failed|Tenant or user not found/i.test(m) &&
        /password authentication failed/i.test(m)) {
      console.error('\nThat database password was rejected. Reset it in Project Settings → Database.');
      process.exit(1);
    }
  }
}

if (!client) {
  console.error('\nCould not reach the pooler in any known region. Check your connection, ' +
                'or grab the exact connection string from Project Settings → Database.');
  process.exit(1);
}

try {
  console.log('\napplying schema…');
  await client.query(sql);
  console.log('schema applied.\n');

  const { rows } = await client.query(
    `select p.role, count(*) over () as total, p.email
       from public.profiles p order by p."createdAt" limit 5`);
  if (rows.length) {
    console.log(`profiles: ${rows[0].total}`);
    rows.forEach(r => console.log(`  ${r.email} — ${r.role}`));
    console.log('\nThe earliest account is the admin. Sign in to the CRM.');
  } else {
    console.log('No profiles yet — sign up in the CRM and the first account becomes admin.');
  }
} catch (err) {
  console.error('\nFailed: ' + err.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
