/* ═══════════════════════════════════════════════════════════════════
   backend.js — the I/O adapter behind the store.

   Two implementations, one interface:
     • local    — localStorage, single browser, no account (demo mode)
     • supabase — shared Postgres, real auth, live updates

   The store keeps its synchronous in-memory cache either way. This file
   only handles: hydrate once at boot, write through on every change,
   and push remote changes back into the cache.
   ═══════════════════════════════════════════════════════════════════ */
(function (root) {
  'use strict';

  var KEY = 'tfs_crm_v1';

  /* JS collection name → Postgres table name */
  var TABLES = {
    users: 'profiles',
    /* `customers` is the Account object — see the naming note in
       store.js. The UI never says "customer" for it. */
    customers: 'customers',
    contacts: 'contacts',
    opportunities: 'opportunities',
    tasks: 'tasks',
    vendors: 'vendors',
    leads: 'leads',
    outreachGroups: 'outreach_groups',
    outreach: 'outreach',
    workOrders: 'work_orders',
    notes: 'notes',
    services: 'services',
    timeEntries: 'time_entries',
    dailyLogs: 'daily_logs',
    activity: 'activity',
    statuses: 'statuses',
    vendorTypes: 'vendor_types',
    settings: 'settings',
    /* Stripe mirror — read-only in the app, written only by the
       stripe-sync Edge Function. */
    stripeInvoices: 'stripe_invoices',
    stripeSubscriptions: 'stripe_subscriptions',
    stripeSyncState: 'stripe_sync_state'
  };

  /* Tables the app must never try to write to. */
  var READ_ONLY = { stripeInvoices: 1, stripeSubscriptions: 1, stripeSyncState: 1 };
  var COLLECTIONS = {};
  Object.keys(TABLES).forEach(function (c) { COLLECTIONS[TABLES[c]] = c; });

  /* PostgREST's wording for "that table is not in the database". A
       missing table is a setup step; anything else is a real failure. */
  var MISSING_TABLE = /schema cache|Could not find the table|does not exist|relation .* does not exist/i;

  /* Without these there is no application to run, so their absence means
     the schema was never applied and the setup screen is the right
     answer. Every other table belongs to one feature: if it is missing,
     that feature is unavailable and the rest of the CRM carries on.
     Locking someone out of their customer list because a tracker added
     last week has no table is the wrong trade. */
  var CORE_TABLES = { profiles: 1, customers: 1, settings: 1 };

  /* Fields the app carries in memory but that have no column. */
  var STRIP = ['__local'];

  /* ── Columns added after the first release ───────────────────────
     A write sends the WHOLE record, so a single column the database has
     not got yet makes PostgREST reject the entire row. The change lands
     in the in-memory cache, looks saved, and is gone on reload — which
     is indistinguishable from the app losing your work.

     These are probed at boot so a missing one can be stripped from
     writes instead: that field stops saving and says so, and everything
     else on the record still goes through.

     ADD TO THIS LIST WHENEVER A COLUMN IS ADDED TO schema.sql. */
  var EXPECTED_COLUMNS = {
    customers: ['accountType', 'billingType', 'tags', 'convertedFromLeadId',
                'instagram', 'tiktok', 'facebook'],
    contacts:  ['instagram', 'tiktok', 'facebook'],
    leads:     ['lostReason', 'outreachId', 'instagram', 'tiktok', 'facebook',
                'mockupStatus', 'mockupTypes', 'mockupUrl', 'mockupReadyAt', 'mockupSentAt',
                'convertedContactId', 'convertedOpportunityId'],
    vendors:   ['tags'],
    settings:  ['mrrGoalCents', 'outreachDailyGoal']
  };
  var MISSING_COLUMN = /column .* does not exist/i;

  function clean(rec, table) {
    var gone = (Remote.missingColumns && Remote.missingColumns[table]) || null;
    var out = {};
    Object.keys(rec).forEach(function (k) {
      if (STRIP.indexOf(k) > -1) return;
      if (rec[k] === undefined) return;
      /* Dropping the field is the lesser harm: the alternative is the
         whole record failing to save because of it. */
      if (gone && gone.indexOf(k) > -1) return;
      out[k] = rec[k];
    });
    return out;
  }

  /* One request per table while healthy; only narrows down column by
     column when something is actually missing. */
  function probeColumns() {
    var tables = Object.keys(EXPECTED_COLUMNS).filter(function (t) {
      return Remote.missing.indexOf(t) < 0;      // table itself is absent
    });
    /* This runs inside boot, so it must never be the thing that stops the
       app starting. Anything unexpected here means "assume every column
       is present" — the old behaviour — rather than no CRM at all. */
    function ask(table, cols) {
      try {
        var q = client.from(table).select(cols);
        return (q && typeof q.limit === 'function' ? q.limit(1) : q);
      } catch (e) {
        return Promise.resolve({ error: null });
      }
    }
    return Promise.all(tables.map(function (table) {
      var cols = EXPECTED_COLUMNS[table];
      return ask(table, cols.join(',')).then(function (r) {
        if (!r || !r.error || !MISSING_COLUMN.test(r.error.message || '')) return null;
        return Promise.all(cols.map(function (c) {
          return ask(table, c).then(function (one) {
            return (one && one.error && MISSING_COLUMN.test(one.error.message || '')) ? c : null;
          }, function () { return null; });
        })).then(function (found) {
          var missing = found.filter(Boolean);
          return missing.length ? { table: table, columns: missing } : null;
        });
      }, function () { return null; });
    })).then(function (results) {
      var map = {};
      results.filter(Boolean).forEach(function (r) { map[r.table] = r.columns; });
      Remote.missingColumns = map;
      return map;
    });
  }

  /* ── local ───────────────────────────────────────────────────── */
  var Local = {
    mode: 'local',
    needsAuth: false,
    realtime: false,
    missing: [],
    missingColumns: {},

    init: function () { return Promise.resolve(); },
    hydrate: function () {
      try {
        var raw = localStorage.getItem(KEY);
        return Promise.resolve(raw ? JSON.parse(raw) : null);
      } catch (e) {
        console.warn('CRM: could not read saved data, reseeding.', e);
        return Promise.resolve(null);
      }
    },
    persist: function (db) {
      try { localStorage.setItem(KEY, JSON.stringify(db)); }
      catch (e) { console.error('CRM: save failed', e); }
    },
    write: function () { /* persist() already wrote the whole db */ },
    writeMany: function () { /* ditto */ },
    replaceAll: function (db) { Local.persist(db); return Promise.resolve(); },
    subscribe: function () {},
    session: function () { return null; },
    signOut: function () { return Promise.resolve(); }
  };

  /* ── supabase ────────────────────────────────────────────────── */
  var client = null;
  var session = null;
  var pendingProbe = Promise.resolve({});

  var Remote = {
    mode: 'supabase',
    needsAuth: true,
    realtime: true,
    onRemote: null,      // set by the store
    onError: null,       // set by the store
    missing: [],         // tables this database does not have yet
    missingColumns: {},  // columns it does not have yet, by table

    init: function (cfg) {
      if (!root.supabase || !root.supabase.createClient) {
        return Promise.reject(new Error(
          'The Supabase library did not load. Check your connection, or blank out the url in js/config.js to run in offline demo mode.'));
      }
      client = root.supabase.createClient(cfg.url, cfg.anonKey, {
        auth: { persistSession: true, autoRefreshToken: true }
      });
      return client.auth.getSession().then(function (r) {
        session = r.data.session;
        client.auth.onAuthStateChange(function (_evt, s) { session = s; });
        return session;
      });
    },

    session: function () { return session; },
    client: function () { return client; },

    signIn: function (email, password) {
      return client.auth.signInWithPassword({ email: email, password: password })
        .then(function (r) {
          if (r.error) throw r.error;
          session = r.data.session;
          return session;
        });
    },

    signUp: function (email, password, name) {
      var opts = { data: { name: name } };
      /* Send the confirmation link back to wherever this app is actually
         being served, instead of the project's default Site URL. Skipped
         on file://, where origin is "null" and no redirect is possible. */
      var loc = root.location;
      if (loc && /^https?:$/.test(loc.protocol)) {
        opts.emailRedirectTo = loc.origin + loc.pathname;
      }
      return client.auth.signUp({
        email: email, password: password, options: opts
      }).then(function (r) {
        if (r.error) throw r.error;
        session = r.data.session;
        return session;
      });
    },

    signOut: function () {
      return client.auth.signOut().then(function () { session = null; });
    },

    /* Pull every table into the shape the store expects.

       Every table is reported, not just the first one to fail. Throwing
       on the first missing table means fixing them one at a time, with a
       round trip to the SQL editor for each — which is exactly what
       happens after an update that adds several tables at once. */
    hydrate: function () {
      var colls = Object.keys(TABLES);
      return Promise.all(colls.map(function (c) {
        return client.from(TABLES[c]).select('*').then(function (r) {
          if (r.error) return { __fail: TABLES[c], __msg: r.error.message };
          return r.data || [];
        }, function (e) {
          return { __fail: TABLES[c], __msg: (e && e.message) || String(e) };
        });
      })).then(function (results) {
        var failed = results.filter(function (r) { return r && r.__fail; });

        /* Only stop for something that cannot be worked around: a core
           table, or a failure that is not simply a missing table (auth,
           network, a broken policy). A feature table that has not been
           created yet degrades to an empty list instead. */
        var fatal = failed.filter(function (f) {
          return CORE_TABLES[COLLECTIONS[f.__fail]] || !MISSING_TABLE.test(f.__msg);
        });
        if (fatal.length) {
          var err = new Error(failed.map(function (f) {
            return f.__fail + ': ' + f.__msg;
          }).join('\n'));
          err.missingTables = failed
            .filter(function (f) { return MISSING_TABLE.test(f.__msg); })
            .map(function (f) { return f.__fail; });
          err.failedTables = failed.map(function (f) { return f.__fail; });
          err.totalTables = colls.length;
          throw err;
        }

        Remote.missing = failed.map(function (f) { return f.__fail; });
        pendingProbe = probeColumns();

        var db = { version: 1 };
        colls.forEach(function (c, i) {
          db[c] = (results[i] && results[i].__fail) ? [] : results[i];
        });

        /* settings is a single row in the app's model */
        db.settings = (db.settings && db.settings[0]) ||
          { id: 'org', orgName: 'ThinkFirst Studios', currency: 'USD' };

        /* newest activity first, matching the local implementation */
        db.activity.sort(function (a, b) { return String(b.ts).localeCompare(String(a.ts)); });
        /* Writes must not start before we know which columns exist,
           or the first save races the probe and fails anyway. */
        return pendingProbe.then(function () { return db; });
      });
    },

    persist: function () { /* nothing to do — writes go per-record */ },

    /* Fire-and-forget write-through. The cache already has the change,
       so a failure is surfaced as a toast rather than blocking the UI. */
    write: function (coll, op, rec) {
      var table = TABLES[coll];
      if (!table || !client) return;
      if (READ_ONLY[coll]) {
        console.warn('CRM: ' + coll + ' mirrors Stripe and is not writable from the app.');
        return;
      }
      /* Say why rather than letting PostgREST answer with a schema-cache
         error that reads like a bug. */
      if (Remote.missing.indexOf(table) > -1) {
        fail(table, op, 'this table does not exist yet — run the database update to enable it');
        return;
      }

      var q;
      if (op === 'delete') q = client.from(table).delete().eq('id', rec.id);
      else q = client.from(table).upsert(clean(rec, table));   // insert and update both upsert

      q.then(function (r) {
        if (r && r.error) fail(table, op, r.error.message);
      }, function (e) { fail(table, op, e.message); });
    },

    /* One round trip for a whole batch (bulk import). Chunked because a
       single enormous request is the thing most likely to be rejected. */
    writeMany: function (coll, rows) {
      var table = TABLES[coll];
      if (!table || !client || READ_ONLY[coll] || !rows || !rows.length) return;
      var CHUNK = 200;
      for (var i = 0; i < rows.length; i += CHUNK) {
        (function (batch) {
          client.from(table).upsert(batch.map(function (x) { return clean(x, table); })).then(function (r) {
            if (r && r.error) fail(table, 'import', r.error.message);
          }, function (e) { fail(table, 'import', e.message); });
        })(rows.slice(i, i + CHUNK));
      }
    },

    /* Used by backup restore. */
    replaceAll: function (db) {
      /* Never wipe the Stripe mirror — it is not ours to restore, and the
         Edge Function will repopulate it anyway. */
      var colls = Object.keys(TABLES).filter(function (c) {
        return c !== 'settings' && !READ_ONLY[c];
      });
      return colls.reduce(function (chain, c) {
        return chain.then(function () {
          return client.from(TABLES[c]).delete().neq('id', '__none__').then(function () {
            var rows = (db[c] || []).map(function (x) { return clean(x, TABLES[c]); });
            if (!rows.length) return null;
            return client.from(TABLES[c]).insert(rows).then(function (r) {
              if (r.error) throw new Error(TABLES[c] + ': ' + r.error.message);
            });
          });
        });
      }, Promise.resolve()).then(function () {
        if (db.settings) return client.from('settings').upsert(clean(db.settings, 'settings'));
      });
    },

    /* Call an Edge Function as the signed-in user, so the function can
       check their role. Returns the parsed JSON body. */
    invokeFunction: function (name, payload) {
      if (!client) return Promise.reject(new Error('Not connected.'));
      return client.functions.invoke(name, { body: payload }).then(function (r) {
        if (r.error) {
          /* supabase-js hides the response body on non-2xx — dig it out so
             the user sees the real reason rather than "Edge Function error". */
          var ctx = r.error.context;
          if (ctx && typeof ctx.json === 'function') {
            return ctx.json().then(function (body) {
              throw new Error((body && body.error) || r.error.message);
            }, function () { throw new Error(r.error.message); });
          }
          throw new Error(r.error.message);
        }
        return r.data;
      });
    },

    subscribe: function (onRemote) {
      if (!client) return;
      client.channel('crm-all')
        .on('postgres_changes', { event: '*', schema: 'public' }, function (payload) {
          var coll = COLLECTIONS[payload.table];
          if (!coll) return;
          onRemote(coll, payload.eventType, payload.new, payload.old);
        })
        .subscribe();
    }
  };

  function fail(table, op, msg) {
    console.error('Supabase ' + op + ' on ' + table + ' failed:', msg);
    if (Remote.onError) Remote.onError(table, op, msg);
  }

  /* ── selection ───────────────────────────────────────────────── */
  var cfg = (root.CRM_CONFIG && root.CRM_CONFIG.supabase) || {};
  var useRemote = !!(cfg.url && cfg.anonKey);

  root.Backend = useRemote ? Remote : Local;
  root.Backend.config = cfg;
  root.Backend.TABLES = TABLES;
})(window);
