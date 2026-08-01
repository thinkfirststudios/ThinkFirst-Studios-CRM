/* ═══════════════════════════════════════════════════════════════════
   store.js — the app's single source of truth.

   Views read from a synchronous in-memory cache, exactly as before.
   All I/O goes through js/backend.js:
     boot()      hydrates the cache once
     mutations   write through to the backend
     onRemote    folds a teammate's change back into the cache

   Because the cache stays synchronous, no view needed to change when
   this moved from localStorage to Supabase.
   ═══════════════════════════════════════════════════════════════════ */
(function (root) {
  'use strict';

  var B = root.Backend;
  var SESSION_KEY = 'tfs_crm_me';

  /* ── helpers ─────────────────────────────────────────────────── */
  function uid(prefix) {
    return prefix + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }
  function today() { return new Date().toISOString().slice(0, 10); }
  function shift(days) {
    var d = new Date(); d.setDate(d.getDate() + days);
    return d.toISOString().slice(0, 10);
  }
  function now() { return new Date().toISOString(); }
  function initials(name) {
    return (name || '?').split(/\s+/).slice(0, 2).map(function (p) { return p[0]; }).join('').toUpperCase();
  }

  /* ── reference defaults (also seeded server-side by schema.sql) ── */
  var DEFAULT_STATUSES = [
    { id: 'new',       label: 'New',        tone: 'b-blue',   order: 1, open: true,  won: false },
    { id: 'followup',  label: 'Follow Up',  tone: 'b-orange', order: 2, open: true,  won: false },
    { id: 'pending',   label: 'Pending',    tone: 'b-yellow', order: 3, open: true,  won: false },
    { id: 'active',    label: 'Active',     tone: 'b-green',  order: 4, open: false, won: true  },
    { id: 'lost',      label: 'Sale Lost',  tone: 'b-red',    order: 5, open: false, won: false }
  ];

  var DEFAULT_VENDOR_TYPES = [
    { id: 'subcontractor', label: 'Subcontractor' },
    { id: 'supplier',      label: 'Supplier' },
    { id: 'freelancer',    label: 'Freelancer' },
    { id: 'software',      label: 'Software / SaaS' },
    { id: 'agency',        label: 'Agency Partner' },
    { id: 'print',         label: 'Print / Fabrication' },
    { id: 'media',         label: 'Media Buyer' }
  ];

  var WO_STATUSES = [
    { id: 'notstarted', label: 'Not Started', tone: 'b-grey' },
    { id: 'inprogress', label: 'In Progress', tone: 'b-orange' },
    { id: 'blocked',    label: 'Blocked',     tone: 'b-red' },
    { id: 'review',     label: 'In Review',   tone: 'b-violet' },
    { id: 'complete',   label: 'Complete',    tone: 'b-green' }
  ];

  var PRIORITIES = [
    { id: 'low',    label: 'Low',    tone: 'b-grey',   color: '#5C6470' },
    { id: 'normal', label: 'Normal', tone: 'b-blue',   color: '#4C8DFF' },
    { id: 'high',   label: 'High',   tone: 'b-orange', color: '#FA7700' },
    { id: 'urgent', label: 'Urgent', tone: 'b-red',    color: '#E5484D' }
  ];

  /* Whether an account is expected to pay. Structured rather than a tag,
     because revenue, pipeline value and the MRR goal all depend on it —
     a misspelled tag would quietly skew the numbers. */
  var BILLING_TYPES = [
    { id: 'paid',     label: 'Paid',      tone: 'b-green',  revenue: true,
      hint: 'A normal paying account.' },
    { id: 'probono',  label: 'Pro Bono',  tone: 'b-violet', revenue: false,
      hint: 'Work done for free. Excluded from revenue and never shown as unpaid.' },
    { id: 'internal', label: 'Internal',  tone: 'b-grey',   revenue: false,
      hint: 'Our own projects. Excluded from revenue.' },
    { id: 'trial',    label: 'Trial',     tone: 'b-blue',   revenue: false,
      hint: 'Not billing yet. Excluded until moved to Paid.' }
  ];

  var BILLING_CYCLES = ['Monthly', 'Quarterly', 'Annual', 'One-Time', 'Retainer'];
  var ROLES = ['admin', 'manager', 'rep'];

  var EMPTY_COLLS = ['users', 'services', 'customers', 'vendors', 'workOrders',
    'notes', 'timeEntries', 'dailyLogs', 'activity', 'statuses', 'vendorTypes',
    'stripeInvoices', 'stripeSubscriptions', 'stripeSyncState'];

  function emptyDb() {
    var db = { version: 1, settings: { id: 'org', orgName: 'ThinkFirst Studios', currency: 'USD' } };
    EMPTY_COLLS.forEach(function (c) { db[c] = []; });
    db.statuses = DEFAULT_STATUSES.slice();
    db.vendorTypes = DEFAULT_VENDOR_TYPES.slice();
    return db;
  }

  /* ── demo seed (local mode only) ─────────────────────────────── */
  function seed() {
    var users = [
      { id: 'u_alex',  name: 'Alex Phillips', email: 'alex@thinkfirststudios.com',  role: 'admin',   title: 'Founder',         active: true, createdAt: now() },
      { id: 'u_jordan',name: 'Jordan Reyes',  email: 'jordan@thinkfirststudios.com',role: 'manager', title: 'Account Manager', active: true, createdAt: now() },
      { id: 'u_sam',   name: 'Sam Okafor',    email: 'sam@thinkfirststudios.com',   role: 'rep',     title: 'Sales Rep',       active: true, createdAt: now() },
      { id: 'u_riley', name: 'Riley Chen',    email: 'riley@thinkfirststudios.com', role: 'rep',     title: 'Production Lead', active: true, createdAt: now() }
    ];

    var services = [
      { id: 's_brand',  name: 'Brand Identity',     category: 'Creative',  rate: 4500, cycle: 'One-Time', active: true },
      { id: 's_web',    name: 'Website Build',      category: 'Web',       rate: 6500, cycle: 'One-Time', active: true },
      { id: 's_care',   name: 'Website Care Plan',  category: 'Web',       rate: 250,  cycle: 'Monthly',  active: true },
      { id: 's_seo',    name: 'SEO Retainer',       category: 'Marketing', rate: 1200, cycle: 'Monthly',  active: true },
      { id: 's_ads',    name: 'Paid Ads Management',category: 'Marketing', rate: 1500, cycle: 'Monthly',  active: true },
      { id: 's_social', name: 'Social Content',     category: 'Marketing', rate: 900,  cycle: 'Monthly',  active: true },
      { id: 's_video',  name: 'Video Production',   category: 'Creative',  rate: 3200, cycle: 'One-Time', active: true },
      { id: 's_photo',  name: 'Photography',        category: 'Creative',  rate: 1100, cycle: 'One-Time', active: true },
      { id: 's_auto',   name: 'CRM / Automation',   category: 'Systems',   rate: 2400, cycle: 'One-Time', active: true }
    ];

    var customers = [
      { id: 'c_1', name: 'Sonoran Ridge Realty',  contactName: 'Marcy Delgado', email: 'marcy@sonoranridge.com', phone: '(602) 555-0188',
        status: 'followup', ownerId: 'u_sam',    services: ['s_web', 's_seo'],            billingDate: shift(9),  billingCycle: 'Monthly',  value: 7700,
        industry: 'Real Estate', source: 'Referral',   address: 'Scottsdale, AZ', website: 'sonoranridge.com', createdAt: now() },
      { id: 'c_2', name: 'Copperline Roofing',    contactName: 'Dan Whitaker',  email: 'dan@copperlineroofing.com', phone: '(480) 555-0142',
        status: 'active',   ownerId: 'u_jordan', services: ['s_ads', 's_care', 's_social'], billingDate: shift(3),  billingCycle: 'Monthly',  value: 2650,
        industry: 'Home Services', source: 'Google Ads', address: 'Mesa, AZ', website: 'copperlineroofing.com', createdAt: now() },
      { id: 'c_3', name: 'Vela Coffee Co.',       contactName: 'Priya Nair',    email: 'priya@velacoffee.com', phone: '(602) 555-0119',
        status: 'pending',  ownerId: 'u_sam',    services: ['s_brand', 's_photo'],        billingDate: shift(21), billingCycle: 'One-Time', value: 5600,
        industry: 'Food & Bev', source: 'Instagram', address: 'Phoenix, AZ', website: 'velacoffee.com', createdAt: now() },
      { id: 'c_4', name: 'Halstead Legal Group',  contactName: 'Ted Halstead',  email: 'ted@halsteadlegal.com', phone: '(623) 555-0177',
        status: 'active',   ownerId: 'u_jordan', services: ['s_seo', 's_care'],           billingDate: shift(-2), billingCycle: 'Monthly',  value: 1450,
        industry: 'Legal', source: 'Referral', address: 'Glendale, AZ', website: 'halsteadlegal.com', createdAt: now() },
      { id: 'c_5', name: 'Bright Path Dental',    contactName: 'Dr. Ana Ruiz',  email: 'ana@brightpathdental.com', phone: '(480) 555-0163',
        status: 'lost',     ownerId: 'u_sam',    services: ['s_web'],                     billingDate: '',        billingCycle: 'One-Time', value: 6500,
        industry: 'Healthcare', source: 'Cold Outreach', address: 'Chandler, AZ', website: 'brightpathdental.com', createdAt: now() },
      { id: 'c_6', name: 'Ironvale Fitness',      contactName: 'Marcus Boone',  email: 'marcus@ironvale.fit', phone: '(602) 555-0154',
        status: 'new',      ownerId: 'u_sam',    services: ['s_social', 's_video'],       billingDate: shift(30), billingCycle: 'Monthly',  value: 4100,
        industry: 'Fitness', source: 'Website Form', address: 'Tempe, AZ', website: 'ironvale.fit', createdAt: now() },
      { id: 'c_7', name: 'Cactus Bloom Events',   contactName: 'Nina Alvarez',  email: 'nina@cactusbloom.co', phone: '(480) 555-0135',
        status: 'followup', ownerId: 'u_jordan', services: ['s_brand', 's_web', 's_auto'],billingDate: shift(14), billingCycle: 'Retainer', value: 13400,
        industry: 'Events', source: 'Referral', address: 'Gilbert, AZ', website: 'cactusbloom.co', createdAt: now() },
      { id: 'c_8', name: 'Northline HVAC',        contactName: 'Greg Tomlin',   email: 'greg@northlinehvac.com', phone: '(623) 555-0126',
        status: 'active',   ownerId: 'u_jordan', services: ['s_ads', 's_seo', 's_care'],  billingDate: shift(6),  billingCycle: 'Monthly',  value: 2950,
        industry: 'Home Services', source: 'Referral', address: 'Peoria, AZ', website: 'northlinehvac.com', createdAt: now() }
    ];

    var vendors = [
      { id: 'v_1', name: 'Redstone Print Works', vendorType: 'print', contactName: 'Owen Marsh', email: 'owen@redstoneprint.com', phone: '(602) 555-0201',
        status: 'active', ownerId: 'u_riley', services: ['s_brand'], billingDate: shift(11), billingCycle: 'Monthly', value: 800,
        rating: 5, terms: 'Net 15', address: 'Phoenix, AZ', website: 'redstoneprint.com', createdAt: now() },
      { id: 'v_2', name: 'Lumen Media Buying',   vendorType: 'media', contactName: 'Kate Sorensen', email: 'kate@lumenmedia.io', phone: '(480) 555-0210',
        status: 'active', ownerId: 'u_jordan', services: ['s_ads'], billingDate: shift(1), billingCycle: 'Monthly', value: 1800,
        rating: 4, terms: 'Net 30', address: 'Remote', website: 'lumenmedia.io', createdAt: now() },
      { id: 'v_3', name: 'Pike & Co. Dev Shop',  vendorType: 'subcontractor', contactName: 'Ravi Pike', email: 'ravi@pikeco.dev', phone: '(602) 555-0233',
        status: 'pending', ownerId: 'u_riley', services: ['s_web', 's_auto'], billingDate: shift(18), billingCycle: 'One-Time', value: 4200,
        rating: 4, terms: 'Net 15', address: 'Remote', website: 'pikeco.dev', createdAt: now() },
      { id: 'v_4', name: 'Northstar Hosting',    vendorType: 'software', contactName: 'Support Desk', email: 'billing@northstarhost.com', phone: '(888) 555-0244',
        status: 'active', ownerId: 'u_alex', services: ['s_care'], billingDate: shift(-1), billingCycle: 'Annual', value: 1440,
        rating: 3, terms: 'Prepaid', address: 'Remote', website: 'northstarhost.com', createdAt: now() },
      { id: 'v_5', name: 'Juniper Studio (Video)', vendorType: 'freelancer', contactName: 'Elle Navarro', email: 'elle@juniper.studio', phone: '(480) 555-0255',
        status: 'followup', ownerId: 'u_riley', services: ['s_video', 's_photo'], billingDate: shift(25), billingCycle: 'One-Time', value: 2100,
        rating: 5, terms: '50% Deposit', address: 'Tempe, AZ', website: 'juniper.studio', createdAt: now() }
    ];

    var workOrders = [
      { id: 'w_1', title: 'Homepage wireframe review',        entityType: 'customer', entityId: 'c_1', assigneeId: 'u_riley', serviceId: 's_web',
        status: 'inprogress', priority: 'high',   scheduledDate: today(),   dueDate: today(),   estHours: 3, description: 'Walk Marcy through v2 wireframes and lock scope.', createdAt: now(), completedAt: '' },
      { id: 'w_2', title: 'April ad creative refresh',        entityType: 'customer', entityId: 'c_2', assigneeId: 'u_jordan', serviceId: 's_ads',
        status: 'notstarted', priority: 'normal', scheduledDate: today(),   dueDate: shift(2),  estHours: 2, description: 'Three new hooks + thumbnail set.', createdAt: now(), completedAt: '' },
      { id: 'w_3', title: 'Logo concept round 2',             entityType: 'customer', entityId: 'c_3', assigneeId: 'u_riley', serviceId: 's_brand',
        status: 'review',     priority: 'high',   scheduledDate: today(),   dueDate: today(),   estHours: 4, description: 'Refine the two marks Priya flagged.', createdAt: now(), completedAt: '' },
      /* w_4 and w_10 were scheduled for earlier days and never closed — they
         demonstrate the tracker's roll-forward onto today. */
      { id: 'w_4', title: 'Monthly SEO report — Halstead',    entityType: 'customer', entityId: 'c_4', assigneeId: 'u_sam', serviceId: 's_seo',
        status: 'notstarted', priority: 'normal', scheduledDate: shift(-1), dueDate: shift(-1), estHours: 1.5, description: 'Pull GSC + rankings, write summary.', createdAt: now(), completedAt: '' },
      { id: 'w_5', title: 'Push print files to Redstone',     entityType: 'vendor',   entityId: 'v_1', assigneeId: 'u_riley', serviceId: 's_brand',
        status: 'blocked',    priority: 'urgent', scheduledDate: today(),   dueDate: today(),   estHours: 1, description: 'Waiting on final Pantone sign-off from client.', createdAt: now(), completedAt: '' },
      { id: 'w_6', title: 'Quarterly budget sync — Lumen',    entityType: 'vendor',   entityId: 'v_2', assigneeId: 'u_jordan', serviceId: 's_ads',
        status: 'notstarted', priority: 'normal', scheduledDate: shift(1),  dueDate: shift(1),  estHours: 1, description: 'Confirm Q3 spend split across accounts.', createdAt: now(), completedAt: '' },
      { id: 'w_7', title: 'Care plan updates — batch',        entityType: 'customer', entityId: 'c_8', assigneeId: 'u_riley', serviceId: 's_care',
        status: 'complete',   priority: 'low',    scheduledDate: shift(-1), dueDate: shift(-1), estHours: 1, description: 'Plugin + core updates, backup verify.', createdAt: now(), completedAt: now() },
      { id: 'w_8', title: 'Proposal follow-up call',          entityType: 'customer', entityId: 'c_7', assigneeId: 'u_jordan', serviceId: 's_auto',
        status: 'notstarted', priority: 'high',   scheduledDate: shift(1),  dueDate: shift(1),  estHours: .5, description: 'Nina asked to revisit the automation line item.', createdAt: now(), completedAt: '' },
      { id: 'w_9', title: 'Kickoff deck for Ironvale',        entityType: 'customer', entityId: 'c_6', assigneeId: 'u_sam', serviceId: 's_social',
        status: 'notstarted', priority: 'normal', scheduledDate: shift(2),  dueDate: shift(3),  estHours: 2, description: 'Content pillars + posting cadence.', createdAt: now(), completedAt: '' },
      { id: 'w_10', title: 'Renew Northstar hosting',         entityType: 'vendor',   entityId: 'v_4', assigneeId: 'u_alex', serviceId: 's_care',
        status: 'notstarted', priority: 'urgent', scheduledDate: shift(-2), dueDate: shift(-2), estHours: .5, description: 'Annual invoice is past due — confirm card on file.', createdAt: now(), completedAt: '' }
    ];

    var notes = [
      { id: uid('n'), entityType: 'customer', entityId: 'c_1', authorId: 'u_sam',    body: 'Marcy wants the new site live before the fall listing push. Hard date: Sept 15.', pinned: true,  createdAt: now() },
      { id: uid('n'), entityType: 'customer', entityId: 'c_1', authorId: 'u_jordan', body: 'Heads up — their office manager handles invoicing, not Marcy. Billing emails should go to ap@sonoranridge.com.', pinned: false, createdAt: now() },
      { id: uid('n'), entityType: 'customer', entityId: 'c_2', authorId: 'u_jordan', body: 'Dan is happy with lead volume but wants cost-per-lead under $60. Watch the Mesa campaign.', pinned: true, createdAt: now() },
      { id: uid('n'), entityType: 'customer', entityId: 'c_3', authorId: 'u_riley',  body: 'Priya leans toward the stamped/monoline direction. Avoid anything too script-y.', pinned: false, createdAt: now() },
      { id: uid('n'), entityType: 'customer', entityId: 'c_5', authorId: 'u_sam',    body: 'Lost to an in-house hire. Worth a check-in next spring — they liked the proposal but had no budget.', pinned: true, createdAt: now() },
      { id: uid('n'), entityType: 'vendor',   entityId: 'v_1', authorId: 'u_riley',  body: 'Redstone needs print files 5 business days ahead of any deadline. They do NOT rush without a 30% fee.', pinned: true, createdAt: now() },
      { id: uid('n'), entityType: 'vendor',   entityId: 'v_3', authorId: 'u_alex',   body: 'Ravi hasn\'t signed the updated MSA yet. Do not assign new work until that\'s back.', pinned: true, createdAt: now() }
    ];

    var db = emptyDb();
    db.users = users;
    db.services = services;
    db.customers = customers;
    db.vendors = vendors;
    db.workOrders = workOrders;
    db.notes = notes;
    return db;
  }

  /* ── cache + notification ────────────────────────────────────── */
  var db = emptyDb();
  var listeners = [];
  var booted = false;

  function notify() { listeners.forEach(function (fn) { fn(); }); }

  /* Persist (local mode writes the whole blob) and notify subscribers. */
  function save() {
    if (B.mode === 'local') B.persist(db);
    notify();
  }

  /* Write one record through to the backend. */
  function push(coll, op, rec) {
    if (B.mode === 'local') B.persist(db);
    else B.write(coll, op, rec);
  }

  /* ── session ─────────────────────────────────────────────────── */
  var meId = null;

  function resolveMe() {
    if (B.mode === 'supabase') {
      var s = B.session();
      meId = s && s.user ? s.user.id : null;
      return;
    }
    meId = localStorage.getItem(SESSION_KEY);
    if (!meId || !db.users.some(function (u) { return u.id === meId; })) {
      meId = (db.users[0] || {}).id || null;
      if (meId) localStorage.setItem(SESSION_KEY, meId);
    }
  }

  /* ── boot ────────────────────────────────────────────────────── */
  function boot() {
    return B.init(B.config)
      .then(function () {
        if (B.mode === 'supabase' && !B.session()) return null;   // auth screen takes over
        return B.hydrate();
      })
      .then(function (loaded) {
        if (loaded) {
          db = loaded;
          /* a brand-new Supabase project may have no reference rows yet */
          if (!db.statuses || !db.statuses.length) db.statuses = DEFAULT_STATUSES.slice();
          if (!db.vendorTypes || !db.vendorTypes.length) db.vendorTypes = DEFAULT_VENDOR_TYPES.slice();
        } else if (B.mode === 'local') {
          db = seed();
          B.persist(db);
        }

        resolveMe();

        if (B.mode === 'supabase' && B.session()) {
          B.onError = function (table, op, msg) {
            if (root.UI) root.UI.toast('Could not save to ' + table + ': ' + msg, 'err');
          };
          B.subscribe(applyRemote);
        }

        booted = true;
        return { authenticated: B.mode === 'local' || !!B.session() };
      });
  }

  /* A teammate changed something — fold it into the cache and repaint. */
  function applyRemote(coll, event, newRow, oldRow) {
    if (coll === 'settings') {
      if (newRow) db.settings = newRow;
      if (root.render) root.render();
      return;
    }
    var list = db[coll];
    if (!list) return;

    var id = (newRow && newRow.id) || (oldRow && oldRow.id);
    if (!id) return;
    var idx = -1;
    for (var i = 0; i < list.length; i++) if (list[i].id === id) { idx = i; break; }

    if (event === 'DELETE') { if (idx > -1) list.splice(idx, 1); }
    else if (idx > -1) list[idx] = newRow;
    else if (coll === 'activity') list.unshift(newRow);
    else list.push(newRow);

    notify();
    if (root.render) root.render();
  }

  /* ── activity log ────────────────────────────────────────────── */
  function log(action, entityType, entityId, detail) {
    var entry = {
      id: uid('a'), ts: now(), userId: meId || '',
      action: action, entityType: entityType, entityId: entityId, detail: detail || ''
    };
    db.activity.unshift(entry);
    if (db.activity.length > 500) db.activity.length = 500;
    if (B.mode === 'supabase') B.write('activity', 'insert', entry);
  }

  /* ── generic collection ops ──────────────────────────────────── */
  function all(coll) { return db[coll] || []; }

  function find(coll, id) {
    var list = db[coll] || [];
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  function insert(coll, obj, prefix, label) {
    obj.id = obj.id || uid(prefix || 'x');
    obj.createdAt = obj.createdAt || now();
    db[coll].push(obj);
    log('created', coll, obj.id, label || obj.name || obj.title || '');
    push(coll, 'insert', obj);
    notify();
    return obj;
  }

  function update(coll, id, patch, label) {
    var rec = find(coll, id);
    if (!rec) return null;
    var changed = [];
    Object.keys(patch).forEach(function (k) {
      if (JSON.stringify(rec[k]) !== JSON.stringify(patch[k])) changed.push(k);
      rec[k] = patch[k];
    });
    rec.updatedAt = now();
    if (changed.length) log('updated', coll, id, label || changed.join(', '));
    push(coll, 'update', rec);
    notify();
    return rec;
  }

  function remove(coll, id) {
    var rec = find(coll, id);
    db[coll] = db[coll].filter(function (r) { return r.id !== id; });
    if (rec) log('deleted', coll, id, rec.name || rec.title || '');
    push(coll, 'delete', { id: id });
    notify();
  }

  /* ── public API ──────────────────────────────────────────────── */
  var API = {
    /* lifecycle */
    boot: boot,
    isBooted: function () { return booted; },
    mode: function () { return B.mode; },
    db: function () { return db; },
    save: save,
    onChange: function (fn) { listeners.push(fn); },

    uid: uid, today: today, shift: shift, nowISO: now, initials: initials,
    all: all, find: find, insert: insert, update: update, remove: remove,

    /* reference */
    STATUSES: function () { return db.statuses.slice().sort(function (a, b) { return a.order - b.order; }); },
    status: function (id) {
      return find('statuses', id) || { id: id, label: id || '—', tone: 'b-grey', order: 99 };
    },
    VENDOR_TYPES: function () { return db.vendorTypes; },
    vendorType: function (id) { return find('vendorTypes', id) || { id: id, label: id || '—' }; },
    WO_STATUSES: WO_STATUSES,
    woStatus: function (id) {
      for (var i = 0; i < WO_STATUSES.length; i++) if (WO_STATUSES[i].id === id) return WO_STATUSES[i];
      return { id: id, label: id || '—', tone: 'b-grey' };
    },
    PRIORITIES: PRIORITIES,
    priority: function (id) {
      for (var i = 0; i < PRIORITIES.length; i++) if (PRIORITIES[i].id === id) return PRIORITIES[i];
      return PRIORITIES[1];
    },
    BILLING_CYCLES: BILLING_CYCLES,
    ROLES: ROLES,

    /* ── billing type ───────────────────────────────────────────── */
    BILLING_TYPES: BILLING_TYPES,
    billingType: function (id) {
      for (var i = 0; i < BILLING_TYPES.length; i++) if (BILLING_TYPES[i].id === id) return BILLING_TYPES[i];
      return BILLING_TYPES[0];              // records predating the field are Paid
    },
    /* Does this account count toward money? */
    isRevenue: function (c) { return API.billingType(c && c.billingType).revenue; },
    isFree: function (c) { return !API.isRevenue(c); },

    /* ── tags ───────────────────────────────────────────────────── */
    tagsOf: function (rec) { return (rec && rec.tags) || []; },
    /* Every tag in use, for filters and autocomplete. */
    allTags: function () {
      var seen = {};
      db.customers.concat(db.vendors).forEach(function (r) {
        (r.tags || []).forEach(function (t) { if (t) seen[t] = (seen[t] || 0) + 1; });
      });
      return Object.keys(seen).sort(function (a, b) {
        return seen[b] - seen[a] || a.localeCompare(b);
      });
    },
    /* "a, b ,, c" → ["a","b","c"] — deduped, order preserved. */
    parseTags: function (text) {
      var out = [], seen = {};
      String(text || '').split(',').forEach(function (t) {
        t = t.trim();
        if (t && !seen[t.toLowerCase()]) { seen[t.toLowerCase()] = 1; out.push(t); }
      });
      return out;
    },
    hasTag: function (rec, tag) {
      return (rec.tags || []).some(function (t) { return t.toLowerCase() === String(tag).toLowerCase(); });
    },

    /* session */
    me: function () {
      var u = find('users', meId);
      if (u) return u;
      if (B.mode === 'supabase') {
        var s = B.session();
        /* the profile row may not have replicated yet on first sign-in */
        return { id: meId || '', name: (s && s.user && s.user.email) || 'You', role: 'rep', email: (s && s.user && s.user.email) || '', title: '' };
      }
      return db.users[0] || { id: '', name: 'You', role: 'admin', email: '', title: '' };
    },
    /* Switching acting user is a single-machine convenience — it only
       exists offline. On Supabase you are whoever you signed in as. */
    canSwitchUser: function () { return B.mode === 'local'; },
    setMe: function (id) {
      if (B.mode !== 'local') return;
      meId = id; localStorage.setItem(SESSION_KEY, id); notify();
    },
    signOut: function () { return B.signOut(); },
    isAdmin: function () { return API.me().role === 'admin'; },
    canManage: function () { var r = API.me().role; return r === 'admin' || r === 'manager'; },
    user: function (id) { return find('users', id) || { id: '', name: 'Unassigned', role: '', email: '' }; },
    activeUsers: function () { return db.users.filter(function (u) { return u.active; }); },

    /* services */
    service: function (id) { return find('services', id) || { id: id, name: '—', rate: 0 }; },
    serviceNames: function (ids) { return (ids || []).map(function (id) { return API.service(id).name; }); },

    /* records */
    record: function (type, id) { return find(type === 'vendor' ? 'vendors' : 'customers', id); },
    recordName: function (type, id) {
      var r = API.record(type, id);
      return r ? r.name : 'Unknown';
    },

    /* notes */
    notesFor: function (type, id) {
      return db.notes
        .filter(function (n) { return n.entityType === type && n.entityId === id; })
        .sort(function (a, b) {
          if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
          return String(b.createdAt).localeCompare(String(a.createdAt));
        });
    },
    addNote: function (type, id, body) {
      var n = { id: uid('n'), entityType: type, entityId: id, authorId: meId || '', body: body, pinned: false, createdAt: now() };
      db.notes.push(n);
      log('noted', type, id, body.slice(0, 70));
      push('notes', 'insert', n);
      notify();
      return n;
    },

    /* work orders */
    workOrdersFor: function (type, id) {
      return db.workOrders.filter(function (w) { return w.entityType === type && w.entityId === id; });
    },
    workOrdersOn: function (date) {
      return db.workOrders.filter(function (w) {
        if (w.scheduledDate === date) return true;
        return date === today() && w.status !== 'complete' && w.dueDate && w.dueDate < date;
      });
    },
    isOverdue: function (w) {
      return w.status !== 'complete' && w.dueDate && w.dueDate < today();
    },
    setWorkOrderStatus: function (id, status) {
      var w = find('workOrders', id);
      if (!w) return;
      w.status = status;
      w.completedAt = status === 'complete' ? now() : '';
      w.updatedAt = now();
      log(status === 'complete' ? 'completed' : 'moved', 'workOrders', id, w.title + ' → ' + API.woStatus(status).label);
      push('workOrders', 'update', w);
      notify();
    },

    /* time tracking */
    logTime: function (workOrderId, date, hours, note) {
      var t = { id: uid('t'), workOrderId: workOrderId, date: date, userId: meId || '', hours: Number(hours) || 0, note: note || '', createdAt: now() };
      db.timeEntries.push(t);
      log('logged time', 'workOrders', workOrderId, t.hours + 'h');
      push('timeEntries', 'insert', t);
      notify();
      return t;
    },
    timeFor: function (workOrderId) {
      return db.timeEntries.filter(function (t) { return t.workOrderId === workOrderId; });
    },
    hoursOn: function (date, userId) {
      return db.timeEntries.reduce(function (sum, t) {
        if (t.date !== date) return sum;
        if (userId && t.userId !== userId) return sum;
        return sum + (Number(t.hours) || 0);
      }, 0);
    },

    /* daily log */
    dailyLog: function (date, userId) {
      var uid_ = userId || meId;
      return db.dailyLogs.filter(function (l) { return l.date === date && l.userId === uid_; })[0] || null;
    },
    saveDailyLog: function (date, summary) {
      var existing = API.dailyLog(date, meId);
      if (existing) {
        existing.summary = summary;
        existing.updatedAt = now();
        push('dailyLogs', 'update', existing);
      } else {
        var row = { id: uid('dl'), date: date, userId: meId || '', summary: summary, createdAt: now() };
        db.dailyLogs.push(row);
        push('dailyLogs', 'insert', row);
      }
      log('logged day', 'dailyLogs', date, '');
      notify();
    },

    /* settings */
    saveSettings: function (patch) {
      Object.keys(patch).forEach(function (k) { db.settings[k] = patch[k]; });
      db.settings.id = db.settings.id || 'org';
      push('settings', 'update', db.settings);
      notify();
    },

    /* activity */
    activityFor: function (type, id) {
      return db.activity.filter(function (a) { return a.entityType === type && a.entityId === id; });
    },

    /* ── Stripe mirror (read-only; filled by the stripe-sync function) ──
       A customer is "on Stripe" only once it carries a stripeCustomerId.
       Everyone else stays on the manual billingDate/value fields, and the
       UI has to keep the two visibly apart — an unlinked customer is not
       an unpaid one. */
    stripeEnabled: function () { return B.mode === 'supabase'; },
    isOnStripe: function (c) { return !!(c && c.stripeCustomerId); },

    invoicesFor: function (customerId) {
      return db.stripeInvoices
        .filter(function (i) { return i.customerId === customerId; })
        .sort(function (a, b) { return String(b.createdAt || '').localeCompare(String(a.createdAt || '')); });
    },
    subscriptionsFor: function (customerId) {
      return db.stripeSubscriptions.filter(function (s) { return s.customerId === customerId; });
    },
    unlinkedInvoices: function () {
      return db.stripeInvoices.filter(function (i) { return !i.customerId; });
    },

    /* cents → "$1,234.56" (Stripe reports the smallest currency unit) */
    cents: function (n) {
      return '$' + ((Number(n) || 0) / 100).toLocaleString('en-US', {
        minimumFractionDigits: 2, maximumFractionDigits: 2
      });
    },

    /* What a customer's billing actually looks like right now. */
    billingHealth: function (c) {
      /* A free account owes nothing, so it must never read as unpaid or
         overdue. This check comes first — before Stripe — because even a
         pro bono client with a $0 Stripe record should say "Pro Bono". */
      if (API.isFree(c)) {
        var bt = API.billingType(c.billingType);
        return { source: 'free', label: bt.label, tone: bt.tone,
                 outstanding: 0, openCount: 0, overdue: false };
      }
      if (!API.isOnStripe(c)) {
        return { source: 'manual', label: 'Not on Stripe', tone: 'b-grey',
                 outstanding: 0, openCount: 0, overdue: false };
      }
      var invoices = API.invoicesFor(c.id);
      var open = invoices.filter(function (i) { return i.status === 'open'; });
      var outstanding = open.reduce(function (s, i) { return s + (Number(i.amountRemainingCents) || 0); }, 0);
      var today = API.today();
      var overdue = open.some(function (i) { return i.dueDate && i.dueDate < today; });
      var failed = invoices.some(function (i) {
        return i.status === 'open' && Number(i.amountPaidCents) === 0 && i.dueDate && i.dueDate < today;
      });

      var label, tone;
      if (overdue) { label = 'Past due'; tone = 'b-red'; }
      else if (open.length) { label = 'Invoice open'; tone = 'b-yellow'; }
      else if (invoices.length) { label = 'Paid up'; tone = 'b-green'; }
      else { label = 'No invoices'; tone = 'b-grey'; }

      return {
        source: 'stripe', label: label, tone: tone,
        outstanding: outstanding, openCount: open.length,
        overdue: overdue, failed: failed,
        lastPaid: invoices.filter(function (i) { return i.paidAt; })[0] || null
      };
    },

    /* Recurring revenue straight from Stripe subscriptions, for comparison
       against the hand-entered mrr() figure. */
    stripeMrr: function () {
      return db.stripeSubscriptions.reduce(function (s, sub) {
        if (sub.status !== 'active' && sub.status !== 'trialing') return s;
        var cents = Number(sub.amountCents) || 0;
        var n = Number(sub.intervalCount) || 1;
        if (sub.interval === 'month') return s + cents / n;
        if (sub.interval === 'year') return s + cents / (12 * n);
        if (sub.interval === 'week') return s + (cents * 52) / (12 * n);
        if (sub.interval === 'day') return s + (cents * 365) / (12 * n);
        return s;
      }, 0);
    },

    syncState: function () {
      return find('stripeSyncState', 'stripe') || null;
    },

    /* ── Recurring revenue, one definition ──────────────────────────
       Everything that shows an MRR figure goes through here so the
       dashboard, the goal tracker and the Billing screen can never
       quote different numbers. Cents throughout, matching Stripe. */
    recurringCents: function () {
      if (API.stripeEnabled() && db.stripeSubscriptions.length) {
        return { cents: API.stripeMrr(), source: 'stripe' };
      }
      return { cents: Math.round(API.mrr() * 100), source: 'crm' };
    },

    /* ── MRR goal ───────────────────────────────────────────────── */
    mrrGoalCents: function () { return Number(db.settings.mrrGoalCents) || 0; },
    setMrrGoal: function (dollars) {
      API.saveSettings({ mrrGoalCents: Math.round((Number(dollars) || 0) * 100) });
    },
    goalProgress: function () {
      var goal = API.mrrGoalCents();
      if (!goal) return null;
      var current = API.recurringCents();
      var pct = Math.round((current.cents / goal) * 100);
      return {
        goal: goal,
        current: current.cents,
        source: current.source,
        remaining: Math.max(0, goal - current.cents),
        pct: pct,
        clamped: Math.max(0, Math.min(100, pct)),
        hit: current.cents >= goal
      };
    },

    /* Ask the Edge Function to pull everything already in Stripe. */
    stripeBackfill: function () {
      if (B.mode !== 'supabase') return Promise.reject(new Error('Connect Supabase first.'));
      return B.invokeFunction('stripe-sync', { action: 'backfill' });
    },

    /* money */
    money: function (n) {
      n = Number(n) || 0;
      return '$' + n.toLocaleString('en-US', { maximumFractionDigits: 0 });
    },
    mrr: function () {
      return db.customers.reduce(function (s, c) {
        var st = API.status(c.status);
        if (!st.won) return s;
        if (!API.isRevenue(c)) return s;        // pro bono / internal / trial

        var v = Number(c.value) || 0;
        if (c.billingCycle === 'Monthly' || c.billingCycle === 'Retainer') return s + v;
        if (c.billingCycle === 'Quarterly') return s + v / 3;
        if (c.billingCycle === 'Annual') return s + v / 12;
        return s;
      }, 0);
    },
    daysUntil: function (dateStr) {
      if (!dateStr) return null;
      var ms = new Date(dateStr + 'T00:00:00') - new Date(today() + 'T00:00:00');
      return Math.round(ms / 86400000);
    },

    /* backup / restore */
    exportJSON: function () { return JSON.stringify(db, null, 2); },
    importJSON: function (text) {
      var incoming = JSON.parse(text);
      if (!incoming.customers || !incoming.users) throw new Error('That file does not look like a CRM backup.');
      db = incoming;
      if (B.mode === 'local') { B.persist(db); notify(); return Promise.resolve(); }
      return B.replaceAll(db).then(notify);
    },
    resetToSeed: function () {
      db = seed();
      if (B.mode === 'local') {
        meId = db.users[0].id;
        localStorage.setItem(SESSION_KEY, meId);
        B.persist(db);
        notify();
        return Promise.resolve();
      }
      return B.replaceAll(db).then(notify);
    },
    wipe: function () {
      var keepUsers = db.users, keepServices = db.services;
      var fresh = emptyDb();
      fresh.users = keepUsers;
      fresh.services = keepServices;
      fresh.settings = db.settings;
      db = fresh;
      if (B.mode === 'local') { B.persist(db); notify(); return Promise.resolve(); }
      return B.replaceAll(db).then(notify);
    }
  };

  root.Store = API;
})(window);
