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
    customers: 'customers',
    vendors: 'vendors',
    workOrders: 'work_orders',
    notes: 'notes',
    services: 'services',
    timeEntries: 'time_entries',
    dailyLogs: 'daily_logs',
    activity: 'activity',
    statuses: 'statuses',
    vendorTypes: 'vendor_types',
    settings: 'settings'
  };
  var COLLECTIONS = {};
  Object.keys(TABLES).forEach(function (c) { COLLECTIONS[TABLES[c]] = c; });

  /* Fields the app carries in memory but that have no column. */
  var STRIP = ['__local'];

  function clean(rec) {
    var out = {};
    Object.keys(rec).forEach(function (k) {
      if (STRIP.indexOf(k) > -1) return;
      if (rec[k] === undefined) return;
      out[k] = rec[k];
    });
    return out;
  }

  /* ── local ───────────────────────────────────────────────────── */
  var Local = {
    mode: 'local',
    needsAuth: false,
    realtime: false,

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
    replaceAll: function (db) { Local.persist(db); return Promise.resolve(); },
    subscribe: function () {},
    session: function () { return null; },
    signOut: function () { return Promise.resolve(); }
  };

  /* ── supabase ────────────────────────────────────────────────── */
  var client = null;
  var session = null;

  var Remote = {
    mode: 'supabase',
    needsAuth: true,
    realtime: true,
    onRemote: null,      // set by the store
    onError: null,       // set by the store

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
      return client.auth.signUp({
        email: email, password: password, options: { data: { name: name } }
      }).then(function (r) {
        if (r.error) throw r.error;
        session = r.data.session;
        return session;
      });
    },

    signOut: function () {
      return client.auth.signOut().then(function () { session = null; });
    },

    /* Pull every table into the shape the store expects. */
    hydrate: function () {
      var colls = Object.keys(TABLES);
      return Promise.all(colls.map(function (c) {
        return client.from(TABLES[c]).select('*').then(function (r) {
          if (r.error) throw new Error(TABLES[c] + ': ' + r.error.message);
          return r.data || [];
        });
      })).then(function (results) {
        var db = { version: 1 };
        colls.forEach(function (c, i) { db[c] = results[i]; });

        /* settings is a single row in the app's model */
        db.settings = (db.settings && db.settings[0]) ||
          { id: 'org', orgName: 'ThinkFirst Studios', currency: 'USD' };

        /* newest activity first, matching the local implementation */
        db.activity.sort(function (a, b) { return String(b.ts).localeCompare(String(a.ts)); });
        return db;
      });
    },

    persist: function () { /* nothing to do — writes go per-record */ },

    /* Fire-and-forget write-through. The cache already has the change,
       so a failure is surfaced as a toast rather than blocking the UI. */
    write: function (coll, op, rec) {
      var table = TABLES[coll];
      if (!table || !client) return;

      var q;
      if (op === 'delete') q = client.from(table).delete().eq('id', rec.id);
      else q = client.from(table).upsert(clean(rec));   // insert and update both upsert

      q.then(function (r) {
        if (r && r.error) fail(table, op, r.error.message);
      }, function (e) { fail(table, op, e.message); });
    },

    /* Used by backup restore. */
    replaceAll: function (db) {
      var colls = Object.keys(TABLES).filter(function (c) { return c !== 'settings'; });
      return colls.reduce(function (chain, c) {
        return chain.then(function () {
          return client.from(TABLES[c]).delete().neq('id', '__none__').then(function () {
            var rows = (db[c] || []).map(clean);
            if (!rows.length) return null;
            return client.from(TABLES[c]).insert(rows).then(function (r) {
              if (r.error) throw new Error(TABLES[c] + ': ' + r.error.message);
            });
          });
        });
      }, Promise.resolve()).then(function () {
        if (db.settings) return client.from('settings').upsert(clean(db.settings));
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
