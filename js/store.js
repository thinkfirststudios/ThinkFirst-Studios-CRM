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
  /* A calendar day in the USER'S timezone.

     toISOString() is UTC. West of Greenwich that means the "date" flips
     hours before midnight actually arrives — at UTC-7 every evening from
     5pm onward it already reads as tomorrow. Dates are displayed by
     parsing 'YYYY-MM-DD' as LOCAL midnight, so the day shown was right
     while the arithmetic against it was a day ahead: a follow-up set to
     today came straight back as "1d overdue". Every date key in the app
     goes through here so display and arithmetic agree. */
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function dateKey(d) {
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }
  function today() { return dateKey(new Date()); }
  function shift(days) {
    var d = new Date(); d.setDate(d.getDate() + days);
    return dateKey(d);
  }
  function now() { return new Date().toISOString(); }
  function initials(name) {
    return (name || '?').split(/\s+/).slice(0, 2).map(function (p) { return p[0]; }).join('').toUpperCase();
  }
  /* "Dan Whitaker" → {first:'Dan', last:'Whitaker'}. With no space at all
     the whole string becomes the last name, since that is the half every
     CRM treats as required. Either way first + ' ' + last round-trips to
     what was typed, so the split never mangles a name it cannot parse. */
  function splitName(full) {
    var s = String(full || '').trim();
    var i = s.indexOf(' ');
    if (i < 0) return { first: '', last: s };
    return { first: s.slice(0, i), last: s.slice(i + 1).trim() };
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

  /* ── Leads ──────────────────────────────────────────────────────
     A lead is deliberately NOT a customer with a different status.
     Leads arrive in volume and most never become anything; mixing them
     into customers would inflate the account count, drag unqualified
     names through the pipeline board and the billing calendar, and make
     "how many customers do we have" unanswerable. They convert into a
     customer once, and that conversion is the number worth measuring. */
  var LEAD_STATUSES = [
    { id: 'new',         label: 'New',         tone: 'b-blue',   order: 1, open: true,
      hint: 'Captured but not contacted yet.' },
    { id: 'working',     label: 'Working',     tone: 'b-orange', order: 2, open: true,
      hint: 'Actively reaching out.' },
    { id: 'nurturing',   label: 'Nurturing',   tone: 'b-violet', order: 3, open: true,
      hint: 'Interested but not now — keep warm.' },
    { id: 'qualified',   label: 'Qualified',   tone: 'b-green',  order: 4, open: true,
      hint: 'Real fit and real budget. Ready to convert.' },
    /* Two ways to lose a lead, and they are not the same thing.

       Unqualified is a judgement you made: wrong service, wrong area, no
       budget. Nothing went wrong — filtering these out early is the job
       working. Dead is a lead that WAS a fit and went nowhere anyway:
       they stopped replying, or went elsewhere.

       Collapsing both into one status hides the only number that tells
       you whether to change how you follow up. A pile of unqualified
       leads means your targeting is loose; a pile of dead ones means you
       are losing people you could have won. So the red is on Dead —
       being unqualified is not the outcome to feel bad about. */
    { id: 'unqualified', label: 'Unqualified', tone: 'b-grey',   order: 5, open: false,
      hint: 'Not a fit — wrong service, wrong area, no budget. Correctly filtered out.' },
    { id: 'dead',        label: 'Dead',        tone: 'b-red',    order: 6, open: false,
      hint: 'Was a fit but went nowhere — stopped replying, or went elsewhere. Can be revived.' },
    { id: 'converted',   label: 'Converted',   tone: 'b-green',  order: 7, open: false,
      hint: 'Became a customer. Set automatically — do not pick by hand.' }
  ];

  var LEAD_RATINGS = [
    { id: 'hot',  label: 'Hot',  tone: 'b-red',    order: 1 },
    { id: 'warm', label: 'Warm', tone: 'b-orange', order: 2 },
    { id: 'cold', label: 'Cold', tone: 'b-blue',   order: 3 }
  ];

  var LEAD_SOURCES = ['Referral', 'Website Form', 'Google Ads', 'Cold Outreach',
    'Instagram', 'Facebook', 'LinkedIn', 'Networking', 'Walk-In', 'Repeat Client', 'List / Import'];

  /* Follow-up urgency. "Unscheduled" ranks above "this week" on purpose:
     a lead with no next touch booked is how leads quietly rot, and it
     should look like a problem rather than a blank. */
  var FOLLOW_UP = {
    overdue:     { key: 'overdue',     label: 'Overdue',           tone: 'b-red',    rank: 0 },
    today:       { key: 'today',       label: 'Due today',         tone: 'b-orange', rank: 1 },
    unscheduled: { key: 'unscheduled', label: 'No follow-up set',  tone: 'b-yellow', rank: 2 },
    soon:        { key: 'soon',        label: 'This week',         tone: 'b-blue',   rank: 3 },
    scheduled:   { key: 'scheduled',   label: 'Scheduled',         tone: 'b-grey',   rank: 4 },
    closed:      { key: 'closed',      label: 'Closed',            tone: 'b-grey',   rank: 5 }
  };
  function fuState(base, days) {
    return { key: base.key, label: base.label, tone: base.tone, rank: base.rank, days: days };
  }

  /* ── Accounts, Contacts, Opportunities ──────────────────────────
     The Salesforce split: the company, the people at it, and the deals.
     One record per company was the original design and it could not
     hold a second contact or a second deal — a repeat client had to
     overwrite the history of the first sale to record the next one.

     NAMING: the Account object is still stored under its original name
     (`customers` table, `customers` collection, entityType 'customer').
     Renaming it would have meant rewriting entityType on every existing
     note and work order, and re-pointing the Stripe mirror and its Edge
     Function — a cascade of changes to live data for a cosmetic gain.
     Everything the user sees says "Account"; only the storage keeps the
     older word. S.ACCOUNTS / S.ACCOUNT_TYPE below are the seam. */
  var ACCOUNT_TYPES = [
    { id: 'prospect', label: 'Prospect',        tone: 'b-blue',   order: 1,
      hint: 'No closed deal yet.' },
    { id: 'customer', label: 'Customer',        tone: 'b-green',  order: 2,
      hint: 'Has won business with us.' },
    { id: 'partner',  label: 'Partner',         tone: 'b-violet', order: 3,
      hint: 'We work alongside them rather than sell to them.' },
    { id: 'former',   label: 'Former Customer', tone: 'b-grey',   order: 4,
      hint: 'Was a customer, no longer active.' }
  ];

  /* Deal stages. Probability drives the weighted forecast, which is the
     only number that answers "what will we actually close". */
  var OPP_STAGES = [
    { id: 'prospecting',   label: 'Prospecting',   tone: 'b-grey',   order: 1, probability: 10,  open: true,  won: false },
    { id: 'qualification', label: 'Qualification', tone: 'b-blue',   order: 2, probability: 25,  open: true,  won: false },
    { id: 'proposal',      label: 'Proposal',      tone: 'b-orange', order: 3, probability: 50,  open: true,  won: false },
    { id: 'negotiation',   label: 'Negotiation',   tone: 'b-yellow', order: 4, probability: 75,  open: true,  won: false },
    { id: 'closedwon',     label: 'Closed Won',    tone: 'b-green',  order: 5, probability: 100, open: false, won: true  },
    { id: 'closedlost',    label: 'Closed Lost',   tone: 'b-red',    order: 6, probability: 0,   open: false, won: false }
  ];

  var OPP_TYPES = ['New Business', 'Renewal', 'Upsell / Expansion', 'Replacement'];

  var CONTACT_ROLES = ['Decision Maker', 'Economic Buyer', 'Technical Buyer',
    'Influencer', 'Champion', 'Billing Contact', 'Day-to-Day Contact'];

  /* ── Activities ─────────────────────────────────────────────────
     Task, Event and logged Call, as in Salesforce. One table: they
     share every field that matters and differ only in whether they
     have a time and whether they start life already done. */
  var TASK_KINDS = [
    { id: 'task',  label: 'Task',  tone: 'b-blue',   verb: 'New Task',
      hint: 'Something to do by a date.' },
    { id: 'call',  label: 'Call',  tone: 'b-green',  verb: 'Log a Call',
      hint: 'A call that already happened — logged as done.' },
    { id: 'event', label: 'Event', tone: 'b-violet', verb: 'New Event',
      hint: 'A meeting at a time.' }
  ];

  /* ── Daily outreach ─────────────────────────────────────────────
     Posting in Nextdoor and Facebook groups is a habit, not a project:
     the whole value is in doing it every day and in knowing which
     communities actually produce business. So two records — the places
     you post (outreachGroups) and each individual touch (outreach) —
     and every lead that comes out of one keeps a link back to it. */
  var OUTREACH_CHANNELS = [
    { id: 'nextdoor',  label: 'Nextdoor',       tone: 'b-green',  order: 1 },
    { id: 'facebook',  label: 'Facebook Group', tone: 'b-blue',   order: 2 },
    { id: 'instagram', label: 'Instagram',      tone: 'b-violet', order: 3 },
    { id: 'linkedin',  label: 'LinkedIn',       tone: 'b-blue',   order: 4 },
    { id: 'reddit',    label: 'Reddit',         tone: 'b-orange', order: 5 },
    { id: 'other',     label: 'Other',          tone: 'b-grey',   order: 6 }
  ];

  var OUTREACH_KINDS = [
    { id: 'recommendation', label: 'Recommendation reply', tone: 'b-green',
      hint: 'Answering "anyone know a good…". The highest-intent thing you can do.' },
    { id: 'comment', label: 'Helpful comment', tone: 'b-blue',
      hint: 'Answering a question without pitching.' },
    { id: 'post',    label: 'Post',            tone: 'b-orange',
      hint: 'Something you published to the group.' },
    { id: 'dm',      label: 'Direct message',  tone: 'b-violet',
      hint: 'Reaching out to one person.' },
    { id: 'follow',  label: 'Follow-up',       tone: 'b-grey',
      hint: 'Circling back on an earlier thread.' }
  ];

  var BILLING_CYCLES = ['Monthly', 'Quarterly', 'Annual', 'One-Time', 'Retainer'];
  var ROLES = ['admin', 'manager', 'rep'];

  var EMPTY_COLLS = ['users', 'services', 'customers', 'contacts', 'opportunities',
    'tasks', 'vendors', 'leads', 'outreachGroups', 'outreach', 'workOrders',
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

    /* An account is a Prospect until it has won business. */
    customers.forEach(function (c) {
      c.accountType = c.status === 'active' ? 'customer' : c.status === 'lost' ? 'former' : 'prospect';
    });

    /* Several accounts carry more than one person, which is the whole
       point of splitting contacts out of the account record. */
    var contacts = [
      { id: 'ct_1', accountId: 'c_1', firstName: 'Marcy',  lastName: 'Delgado', title: 'Managing Broker',
        email: 'marcy@sonoranridge.com', phone: '(602) 555-0188', role: 'Decision Maker', isPrimary: true,  ownerId: 'u_sam',    tags: [], createdAt: now() },
      { id: 'ct_2', accountId: 'c_1', firstName: 'Rhonda', lastName: 'Pike',    title: 'Office Manager',
        email: 'ap@sonoranridge.com',    phone: '(602) 555-0189', role: 'Billing Contact', isPrimary: false, ownerId: 'u_sam',    tags: [], createdAt: now() },
      { id: 'ct_3', accountId: 'c_2', firstName: 'Dan',    lastName: 'Whitaker', title: 'Owner',
        email: 'dan@copperlineroofing.com', phone: '(480) 555-0142', role: 'Decision Maker', isPrimary: true, ownerId: 'u_jordan', tags: [], createdAt: now() },
      { id: 'ct_4', accountId: 'c_2', firstName: 'Elena',  lastName: 'Moss',    title: 'Operations Lead',
        email: 'elena@copperlineroofing.com', phone: '(480) 555-0143', role: 'Day-to-Day Contact', isPrimary: false, ownerId: 'u_jordan', tags: [], createdAt: now() },
      { id: 'ct_5', accountId: 'c_3', firstName: 'Priya',  lastName: 'Nair',    title: 'Founder',
        email: 'priya@velacoffee.com',  phone: '(602) 555-0119', role: 'Decision Maker', isPrimary: true,  ownerId: 'u_sam',    tags: [], createdAt: now() },
      { id: 'ct_6', accountId: 'c_4', firstName: 'Ted',    lastName: 'Halstead', title: 'Managing Partner',
        email: 'ted@halsteadlegal.com', phone: '(623) 555-0177', role: 'Economic Buyer', isPrimary: true,  ownerId: 'u_jordan', tags: [], createdAt: now() },
      { id: 'ct_7', accountId: 'c_6', firstName: 'Marcus', lastName: 'Boone',   title: 'Owner',
        email: 'marcus@ironvale.fit',   phone: '(602) 555-0154', role: 'Decision Maker', isPrimary: true,  ownerId: 'u_sam',    tags: [], createdAt: now() },
      { id: 'ct_8', accountId: 'c_7', firstName: 'Nina',   lastName: 'Alvarez', title: 'Creative Director',
        email: 'nina@cactusbloom.co',   phone: '(480) 555-0135', role: 'Champion', isPrimary: true,  ownerId: 'u_jordan', tags: [], createdAt: now() },
      { id: 'ct_9', accountId: 'c_8', firstName: 'Greg',   lastName: 'Tomlin',  title: 'General Manager',
        email: 'greg@northlinehvac.com', phone: '(623) 555-0126', role: 'Decision Maker', isPrimary: true, ownerId: 'u_jordan', tags: [], createdAt: now() },
      { id: 'ct_10', accountId: 'c_5', firstName: 'Dr. Ana', lastName: 'Ruiz',  title: 'Practice Owner',
        email: 'ana@brightpathdental.com', phone: '(480) 555-0163', role: 'Decision Maker', isPrimary: true, ownerId: 'u_sam', tags: [], createdAt: now() }
    ];

    /* c_2 has two: the original sale and a live upsell. That pair is
       exactly what the old one-deal-per-customer model could not hold. */
    var opportunities = [
      { id: 'op_1', name: 'Sonoran Ridge — Website + SEO',     accountId: 'c_1', contactId: 'ct_1', stage: 'proposal',
        amount: 7700, closeDate: shift(12), ownerId: 'u_sam',    type: 'New Business', leadSource: 'Referral',
        services: ['s_web', 's_seo'], nextStep: 'Send revised scope with the Sept 15 date locked.', createdAt: now() },
      { id: 'op_2', name: 'Copperline — Ads + Care Plan',      accountId: 'c_2', contactId: 'ct_3', stage: 'closedwon',
        amount: 2650, closeDate: shift(-40), ownerId: 'u_jordan', type: 'New Business', leadSource: 'Google Ads',
        services: ['s_ads', 's_care', 's_social'], nextStep: '', createdAt: now(), closedAt: now() },
      { id: 'op_3', name: 'Copperline — Video Package',        accountId: 'c_2', contactId: 'ct_4', stage: 'negotiation',
        amount: 3200, closeDate: shift(9), ownerId: 'u_jordan', type: 'Upsell / Expansion', leadSource: 'Repeat Client',
        services: ['s_video'], nextStep: 'Dan wants the shoot before the busy season — confirm crew.', createdAt: now() },
      { id: 'op_4', name: 'Vela Coffee — Brand + Photography', accountId: 'c_3', contactId: 'ct_5', stage: 'qualification',
        amount: 5600, closeDate: shift(24), ownerId: 'u_sam',    type: 'New Business', leadSource: 'Instagram',
        services: ['s_brand', 's_photo'], nextStep: 'Present the two remaining marks.', createdAt: now() },
      { id: 'op_5', name: 'Halstead — SEO Renewal',            accountId: 'c_4', contactId: 'ct_6', stage: 'closedwon',
        amount: 1450, closeDate: shift(-15), ownerId: 'u_jordan', type: 'Renewal', leadSource: 'Referral',
        services: ['s_seo', 's_care'], nextStep: '', createdAt: now(), closedAt: now() },
      { id: 'op_6', name: 'Bright Path — Website Build',       accountId: 'c_5', contactId: 'ct_10', stage: 'closedlost',
        amount: 6500, closeDate: shift(-30), ownerId: 'u_sam',    type: 'New Business', leadSource: 'Cold Outreach',
        services: ['s_web'], nextStep: '', lostReason: 'Hired in-house instead. No budget this cycle.', createdAt: now(), closedAt: now() },
      { id: 'op_7', name: 'Ironvale — Social + Video',         accountId: 'c_6', contactId: 'ct_7', stage: 'prospecting',
        amount: 4100, closeDate: shift(38), ownerId: 'u_sam',    type: 'New Business', leadSource: 'Website Form',
        services: ['s_social', 's_video'], nextStep: 'Book the discovery call.', createdAt: now() },
      { id: 'op_8', name: 'Cactus Bloom — Full Retainer',      accountId: 'c_7', contactId: 'ct_8', stage: 'negotiation',
        amount: 13400, closeDate: shift(6), ownerId: 'u_jordan', type: 'New Business', leadSource: 'Referral',
        services: ['s_brand', 's_web', 's_auto'], nextStep: 'Nina wants the automation line item revisited.', createdAt: now() },
      { id: 'op_9', name: 'Northline — Ads + SEO Renewal',     accountId: 'c_8', contactId: 'ct_9', stage: 'closedwon',
        amount: 2950, closeDate: shift(-8), ownerId: 'u_jordan', type: 'Renewal', leadSource: 'Referral',
        services: ['s_ads', 's_seo', 's_care'], nextStep: '', createdAt: now(), closedAt: now() }
    ];

    var tasks = [
      { id: 'tk_1', kind: 'task',  subject: 'Send revised scope to Marcy', status: 'open', priority: 'high',
        dueDate: shift(-1), entityType: 'opportunity', entityId: 'op_1', assigneeId: 'u_sam',
        description: 'Include the Sept 15 launch date and the reduced page count.', createdById: 'u_sam', createdAt: now() },
      { id: 'tk_2', kind: 'call',  subject: 'Called Dan re: video package', status: 'completed', priority: 'normal',
        dueDate: shift(-2), entityType: 'opportunity', entityId: 'op_3', assigneeId: 'u_jordan',
        description: 'Wants the shoot done before September. Asked for a crew of two.', createdById: 'u_jordan',
        completedAt: now(), createdAt: now() },
      { id: 'tk_3', kind: 'event', subject: 'Discovery call — Ironvale', status: 'open', priority: 'normal',
        dueDate: today(), startTime: '14:00', endTime: '14:45', entityType: 'opportunity', entityId: 'op_7',
        assigneeId: 'u_sam', description: 'Content pillars and posting cadence.', createdById: 'u_sam', createdAt: now() },
      { id: 'tk_4', kind: 'task',  subject: 'Chase the signed MSA from Pike & Co.', status: 'open', priority: 'urgent',
        dueDate: shift(-4), entityType: 'vendor', entityId: 'v_3', assigneeId: 'u_alex',
        description: '', createdById: 'u_alex', createdAt: now() },
      { id: 'tk_5', kind: 'task',  subject: 'Quarterly check-in with Ted', status: 'open', priority: 'low',
        dueDate: shift(5), entityType: 'customer', entityId: 'c_4', assigneeId: 'u_jordan',
        description: '', createdById: 'u_jordan', createdAt: now() },
      { id: 'tk_6', kind: 'call',  subject: 'Left voicemail for Nina', status: 'completed', priority: 'normal',
        dueDate: shift(-3), entityType: 'opportunity', entityId: 'op_8', assigneeId: 'u_jordan',
        description: 'No answer. Following up by email.', createdById: 'u_jordan', completedAt: now(), createdAt: now() },
      { id: 'tk_7', kind: 'task',  subject: 'Prep the Cactus Bloom contract', status: 'open', priority: 'high',
        dueDate: today(), entityType: 'opportunity', entityId: 'op_8', assigneeId: 'u_jordan',
        description: '', createdById: 'u_jordan', createdAt: now() }
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

    /* A spread of follow-up states so the "needs attention" logic is
       visible the moment you open the screen: two overdue, one due
       today, one never scheduled, one converted. */
    var leads = [
      { id: 'l_1', name: 'Saguaro Auto Spa', contactName: 'Luis Ferrer', contactTitle: 'Owner',
        email: 'luis@saguaroauto.com', phone: '(602) 555-0301', leadStatus: 'working', rating: 'hot',
        source: 'Referral', ownerId: 'u_sam', estValue: 3800, nextFollowUp: shift(-3), lastContactedAt: shift(-10),
        industry: 'Automotive', address: 'Phoenix, AZ', website: 'saguaroauto.com', tags: ['Local'],
        outreachId: 'or_3', convertedCustomerId: '', convertedAt: '', createdAt: now() },
      { id: 'l_2', name: 'Mesquite Grill House', contactName: 'Dana Whitmore', contactTitle: 'GM',
        email: 'dana@mesquitegrill.com', phone: '(480) 555-0312', leadStatus: 'qualified', rating: 'hot',
        source: 'Website Form', ownerId: 'u_jordan', estValue: 9200, nextFollowUp: shift(-1), lastContactedAt: shift(-4),
        industry: 'Food & Bev', address: 'Gilbert, AZ', website: 'mesquitegrill.com', tags: ['Local', 'Referral'],
        outreachId: 'or_6', convertedCustomerId: '', convertedAt: '', createdAt: now() },
      { id: 'l_3', name: 'Verde Valley Landscaping', contactName: 'Tomas Rivera', contactTitle: 'Owner',
        email: 'tomas@verdevalleyland.com', phone: '(928) 555-0323', leadStatus: 'working', rating: 'warm',
        source: 'Google Ads', ownerId: 'u_sam', estValue: 2400, nextFollowUp: today(), lastContactedAt: shift(-6),
        industry: 'Home Services', address: 'Cottonwood, AZ', website: 'verdevalleyland.com', tags: [],
        outreachId: 'or_8', convertedCustomerId: '', convertedAt: '', createdAt: now() },
      { id: 'l_4', name: 'Pinnacle Peak Orthodontics', contactName: 'Dr. Hana Kim', contactTitle: 'Practice Owner',
        email: 'hana@pinnacleortho.com', phone: '(480) 555-0334', leadStatus: 'new', rating: 'warm',
        source: 'List / Import', ownerId: 'u_sam', estValue: 0, nextFollowUp: '', lastContactedAt: '',
        industry: 'Healthcare', address: 'Scottsdale, AZ', website: 'pinnacleortho.com', tags: [],
        convertedCustomerId: '', convertedAt: '', createdAt: now() },
      { id: 'l_5', name: 'Foothills Boutique', contactName: 'Serena Cole', contactTitle: 'Founder',
        email: 'serena@foothillsboutique.com', phone: '(602) 555-0345', leadStatus: 'nurturing', rating: 'cold',
        source: 'Instagram', ownerId: 'u_jordan', estValue: 1500, nextFollowUp: shift(21), lastContactedAt: shift(-14),
        industry: 'Retail', address: 'Ahwatukee, AZ', website: 'foothillsboutique.com', tags: ['Local'],
        convertedCustomerId: '', convertedAt: '', createdAt: now() },
      { id: 'l_6', name: 'Desert Sky Insurance', contactName: 'Ray Nkemdirim', contactTitle: 'Agent',
        email: 'ray@desertskyins.com', phone: '(623) 555-0356', leadStatus: 'unqualified', rating: 'cold',
        source: 'Cold Outreach', ownerId: 'u_sam', estValue: 0, nextFollowUp: '', lastContactedAt: shift(-30),
        industry: 'Insurance', address: 'Surprise, AZ', website: 'desertskyins.com', tags: [],
        convertedCustomerId: '', convertedAt: '', createdAt: now() },
      { id: 'l_7', name: 'Ironvale Fitness', contactName: 'Marcus Boone', contactTitle: 'Owner',
        email: 'marcus@ironvale.fit', phone: '(602) 555-0154', leadStatus: 'converted', rating: 'hot',
        source: 'Website Form', ownerId: 'u_sam', estValue: 4100, nextFollowUp: '', lastContactedAt: shift(-20),
        industry: 'Fitness', address: 'Tempe, AZ', website: 'ironvale.fit', tags: [],
        convertedCustomerId: 'c_6', convertedAt: now(), createdAt: now() }
    ];

    /* Cadence matters more than it looks: most Facebook groups have a
       posting limit and will remove you for ignoring it, so each group
       carries the minimum gap between posts and the board refuses to
       suggest one that is still cooling off. */
    var outreachGroups = [
      { id: 'og_1', name: 'Mesa / Gilbert Neighbors', channel: 'nextdoor', url: 'nextdoor.com',
        area: 'Mesa, AZ', memberCount: 4200, cadenceDays: 3, active: true, ownerId: 'u_alex',
        rules: 'Business posts only in the Business section. Recommendation replies are fine anywhere.',
        notes: 'Best source of "who do you recommend" threads.', createdAt: now() },
      { id: 'og_2', name: 'Phoenix Small Business Owners', channel: 'facebook', url: 'facebook.com/groups/phxsmallbiz',
        area: 'Phoenix, AZ', memberCount: 18400, cadenceDays: 7, active: true, ownerId: 'u_alex',
        rules: 'Promo posts Fridays ONLY. One per week. Instant ban for more.',
        notes: '', createdAt: now() },
      { id: 'og_3', name: 'East Valley Contractors & Trades', channel: 'facebook', url: 'facebook.com/groups/evtrades',
        area: 'Gilbert, AZ', memberCount: 6100, cadenceDays: 5, active: true, ownerId: 'u_sam',
        rules: 'No direct selling. Answer questions and let people come to you.',
        notes: 'Roofers and HVAC — our best-fitting audience.', createdAt: now() },
      { id: 'og_4', name: 'Scottsdale Neighborhood', channel: 'nextdoor', url: 'nextdoor.com',
        area: 'Scottsdale, AZ', memberCount: 3300, cadenceDays: 3, active: true, ownerId: 'u_sam',
        rules: '', notes: '', createdAt: now() },
      { id: 'og_5', name: 'AZ Restaurant & Cafe Owners', channel: 'facebook', url: 'facebook.com/groups/azrestaurants',
        area: 'Statewide', memberCount: 9700, cadenceDays: 7, active: true, ownerId: 'u_jordan',
        rules: 'Introduce yourself before posting anything promotional.',
        notes: 'Never posted here yet.', createdAt: now() }
    ];

    /* Four days running, today included — enough to show a live streak. */
    var outreach = [
      { id: 'or_1', date: today(), channel: 'nextdoor', groupId: 'og_1', kind: 'recommendation',
        summary: 'Replied to "need a website for my landscaping business" — sent the portfolio link.',
        url: '', responses: 2, userId: 'u_alex', createdAt: now() },
      { id: 'or_2', date: today(), channel: 'facebook', groupId: 'og_3', kind: 'comment',
        summary: 'Answered a question about Google Business Profile verification.',
        url: '', responses: 1, userId: 'u_alex', createdAt: now() },
      { id: 'or_3', date: shift(-1), channel: 'nextdoor', groupId: 'og_1', kind: 'recommendation',
        summary: 'Recommendation thread for "web designer near Mesa".',
        url: '', responses: 3, userId: 'u_alex', createdAt: now() },
      { id: 'or_4', date: shift(-1), channel: 'facebook', groupId: 'og_2', kind: 'post',
        summary: 'Friday promo slot — before/after of the Copperline site.',
        url: '', responses: 5, userId: 'u_alex', createdAt: now() },
      { id: 'or_5', date: shift(-1), channel: 'nextdoor', groupId: 'og_4', kind: 'comment',
        summary: 'Helped someone troubleshoot their Squarespace domain.',
        url: '', responses: 0, userId: 'u_sam', createdAt: now() },
      { id: 'or_6', date: shift(-2), channel: 'facebook', groupId: 'og_3', kind: 'recommendation',
        summary: 'Roofer asked who builds sites for contractors.',
        url: '', responses: 4, userId: 'u_alex', createdAt: now() },
      { id: 'or_7', date: shift(-2), channel: 'nextdoor', groupId: 'og_1', kind: 'dm',
        summary: 'Followed up with the auto spa owner from last week.',
        url: '', responses: 1, userId: 'u_alex', createdAt: now() },
      { id: 'or_8', date: shift(-3), channel: 'facebook', groupId: 'og_3', kind: 'comment',
        summary: 'Explained why their site was slow — offered a free audit.',
        url: '', responses: 2, userId: 'u_alex', createdAt: now() },
      { id: 'or_9', date: shift(-3), channel: 'nextdoor', groupId: 'og_4', kind: 'recommendation',
        summary: 'Dentist looking for a rebrand.',
        url: '', responses: 1, userId: 'u_alex', createdAt: now() }
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
      { id: uid('n'), entityType: 'vendor',   entityId: 'v_3', authorId: 'u_alex',   body: 'Ravi hasn\'t signed the updated MSA yet. Do not assign new work until that\'s back.', pinned: true, createdAt: now() },
      { id: uid('n'), entityType: 'lead',     entityId: 'l_1', authorId: 'u_sam',    body: 'Luis wants a full rebrand plus a booking page. Said to call back after the 15th — his slow season starts then.', pinned: true, createdAt: now() },
      { id: uid('n'), entityType: 'lead',     entityId: 'l_2', authorId: 'u_jordan', body: 'Dana has budget approved for Q4 and asked for a proposal. This one is ready to convert.', pinned: true, createdAt: now() },
      { id: uid('n'), entityType: 'lead',     entityId: 'l_5', authorId: 'u_jordan', body: 'Not ready this year — revisit after the holiday season.', pinned: false, createdAt: now() }
    ];

    var db = emptyDb();
    db.users = users;
    db.services = services;
    db.customers = customers;
    db.contacts = contacts;
    db.opportunities = opportunities;
    db.tasks = tasks;
    db.vendors = vendors;
    db.leads = leads;
    db.outreachGroups = outreachGroups;
    db.outreach = outreach;
    db.settings.outreachDailyGoal = 2;
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

  /* Make a loaded database safe to read from.

     Data can arrive missing a whole collection: a browser holding a blob
     saved before a feature existed, a backup restored from an older
     export, a Supabase project where the newest table has not been
     created yet. Without this, the first `db.leads.filter(...)` throws
     and takes the entire screen down — so every collection the app
     expects is guaranteed to exist, even if empty. */
  function normalize(loaded) {
    var out = loaded || {};
    EMPTY_COLLS.forEach(function (c) { if (!Array.isArray(out[c])) out[c] = []; });
    if (!out.settings || typeof out.settings !== 'object') {
      out.settings = { id: 'org', orgName: 'ThinkFirst Studios', currency: 'USD' };
    }
    /* a brand-new project may have no reference rows yet */
    if (!out.statuses.length) out.statuses = DEFAULT_STATUSES.slice();
    if (!out.vendorTypes.length) out.vendorTypes = DEFAULT_VENDOR_TYPES.slice();

    /* Accounts saved before the object split carry no accountType, and
       an unclassified account with no opportunities reads as a Prospect
       — which would drop every paying client out of MRR the moment this
       version loads. Derive it from the old status field here, using the
       same rule as the SQL migration, so the figures stay right even if
       that migration has not been run yet. */
    out.customers.forEach(function (c) {
      if (c.accountType) return;
      c.accountType = c.status === 'active' ? 'customer'
        : c.status === 'lost' ? 'former' : 'prospect';
    });
    return out;
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
          db = normalize(loaded);
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

  /* Bulk create — one write and one activity entry for the whole batch.
     Importing 200 leads one at a time would fire 200 requests and bury
     the activity feed under 200 identical lines. */
  function insertMany(coll, rows, prefix, label) {
    if (!rows.length) return [];
    rows.forEach(function (r) {
      r.id = r.id || uid(prefix || 'x');
      r.createdAt = r.createdAt || now();
      db[coll].push(r);
    });
    log('imported', coll, '', label || (rows.length + ' records'));
    if (B.mode === 'local') B.persist(db);
    else B.writeMany(coll, rows);
    notify();
    return rows;
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

  /* ── what hangs off a record ─────────────────────────────────────
     A contact or an opportunity has no meaning without its account, so
     deleting the account has to take them with it. Leaving them behind
     produced rows reading "Unknown account" that still counted toward
     open pipeline and win rate — a deleted company quietly inflating
     the forecast. */
  function childrenOf(coll, id) {
    var out = [];
    function add(label, collection, list) {
      if (list.length) out.push({ label: label, coll: collection, rows: list });
    }
    if (coll === 'customers') {
      add('contacts', 'contacts', db.contacts.filter(function (c) { return c.accountId === id; }));
      add('opportunities', 'opportunities', db.opportunities.filter(function (o) { return o.accountId === id; }));
    }
    if (coll === 'customers' || coll === 'vendors' || coll === 'opportunities') {
      var type = coll === 'customers' ? 'customer' : coll === 'vendors' ? 'vendor' : 'opportunity';
      add('work orders', 'workOrders', db.workOrders.filter(function (w) {
        return w.entityType === type && w.entityId === id;
      }));
      add('activities', 'tasks', db.tasks.filter(function (t) {
        return t.entityType === type && t.entityId === id;
      }));
      add('notes', 'notes', db.notes.filter(function (n) {
        return n.entityType === type && n.entityId === id;
      }));
    }
    /* An opportunity's children go too, but its contacts do not — those
       belong to the account and outlive any single deal. */
    if (coll === 'customers') {
      db.opportunities.filter(function (o) { return o.accountId === id; }).forEach(function (o) {
        childrenOf('opportunities', o.id).forEach(function (grp) {
          var existing = out.filter(function (x) { return x.coll === grp.coll; })[0];
          if (existing) {
            grp.rows.forEach(function (r) {
              if (existing.rows.indexOf(r) < 0) existing.rows.push(r);
            });
          } else out.push(grp);
        });
      });
    }
    return out;
  }

  /* Delete a record and everything that only exists because of it. */
  function removeCascade(coll, id) {
    var groups = childrenOf(coll, id);
    var counts = {};
    groups.forEach(function (g) {
      counts[g.label] = g.rows.length;
      g.rows.forEach(function (r) {
        db[g.coll] = db[g.coll].filter(function (x) { return x.id !== r.id; });
        push(g.coll, 'delete', { id: r.id });
      });
    });
    remove(coll, id);
    return counts;
  }

  /* ── public API ──────────────────────────────────────────────── */
  var API = {
    /* lifecycle */
    boot: boot,
    isBooted: function () { return booted; },
    mode: function () { return B.mode; },
    /* Tables this database does not have yet. The features that use them
       are unavailable; everything else works. */
    missingTables: function () { return B.missing || []; },
    db: function () { return db; },
    save: save,
    onChange: function (fn) { listeners.push(fn); },

    uid: uid, today: today, shift: shift, dateKey: dateKey, nowISO: now,
    initials: initials, splitName: splitName,
    all: all, find: find, insert: insert, insertMany: insertMany, update: update, remove: remove,
    childrenOf: childrenOf, removeCascade: removeCascade,

    /* ── orphans ────────────────────────────────────────────────────
       Records whose parent no longer exists. Before deletes cascaded,
       removing an account left its deals behind, and an orphaned deal
       still counted toward open pipeline and win rate while showing
       "Unknown account". Found rather than hidden: a wrong number you
       cannot see is worse than one you can delete. */
    orphans: function () {
      var has = {};
      ['customers', 'vendors', 'leads', 'opportunities', 'contacts', 'workOrders'].forEach(function (c) {
        has[c] = {};
        db[c].forEach(function (r) { has[c][r.id] = 1; });
      });
      function parentColl(type) {
        return type === 'vendor' ? 'vendors' : type === 'lead' ? 'leads'
          : type === 'opportunity' ? 'opportunities' : type === 'contact' ? 'contacts'
          : type === 'workorder' ? 'workOrders' : 'customers';
      }
      function lost(rec) {
        var pc = parentColl(rec.entityType);
        /* An unset entity is not an orphan — it was never attached. */
        return !!rec.entityId && !has[pc][rec.entityId];
      }

      var groups = [
        { coll: 'contacts', label: 'Contacts', why: 'their account no longer exists',
          rows: db.contacts.filter(function (c) { return c.accountId && !has.customers[c.accountId]; }) },
        { coll: 'opportunities', label: 'Opportunities', why: 'their account no longer exists',
          rows: db.opportunities.filter(function (o) { return o.accountId && !has.customers[o.accountId]; }) },
        { coll: 'workOrders', label: 'Work orders', why: 'the record they were for no longer exists',
          rows: db.workOrders.filter(lost) },
        { coll: 'tasks', label: 'Activities', why: 'the record they were about no longer exists',
          rows: db.tasks.filter(lost) },
        { coll: 'notes', label: 'Notes', why: 'the record they were on no longer exists',
          rows: db.notes.filter(lost) }
      ].filter(function (g) { return g.rows.length; });

      return { groups: groups, total: groups.reduce(function (s, g) { return s + g.rows.length; }, 0) };
    },

    /* Opportunities the schema migration invented so that pre-split
       accounts kept a deal history. Untouched ones are noise: they carry
       the migration's own name, no money and no activity. Identified so
       they can be cleared out deliberately — never automatically, since
       a real deal could legitimately look like this. */
    migrationPlaceholders: function () {
      return db.opportunities.filter(function (o) {
        if (String(o.name || '').indexOf('— Initial Engagement') < 0) return false;
        if (Number(o.amount) > 0) return false;
        if (o.nextStep || o.description || o.lostReason) return false;
        if (API.tasksFor('opportunity', o.id).length) return false;
        if (API.notesFor('opportunity', o.id).length) return false;
        if (API.workOrdersFor('opportunity', o.id).length) return false;
        return true;
      });
    },
    removeMany: function (coll, ids) {
      if (!ids.length) return 0;
      var set = {};
      ids.forEach(function (id) { set[id] = 1; });
      db[coll] = db[coll].filter(function (r) { return !set[r.id]; });
      ids.forEach(function (id) { push(coll, 'delete', { id: id }); });
      log('deleted', coll, '', ids.length + ' records removed in bulk');
      notify();
      return ids.length;
    },

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

    /* ── accounts ───────────────────────────────────────────────────
       The Account object lives in the `customers` collection; see the
       note by ACCOUNT_TYPES. Use these rather than hard-coding the
       older word, so the seam stays in one place. */
    ACCOUNTS: 'customers',
    ACCOUNT_TYPE: 'customer',
    ACCOUNT_TYPES: ACCOUNT_TYPES,
    accountType: function (id) {
      for (var i = 0; i < ACCOUNT_TYPES.length; i++) if (ACCOUNT_TYPES[i].id === id) return ACCOUNT_TYPES[i];
      return ACCOUNT_TYPES[0];                 // unset means Prospect
    },
    accounts: function () { return db.customers; },
    account: function (id) { return find('customers', id); },
    accountName: function (id) {
      var a = find('customers', id);
      return a ? a.name : 'Unknown account';
    },
    /* An account is a customer once it has won a deal. Derived rather
       than typed in, so it cannot disagree with the pipeline. */
    deriveAccountType: function (a) {
      if (!a) return 'prospect';
      /* A stored classification wins. Partner and Former are judgements
         somebody made deliberately, and Customer has to be settable by
         hand too: plenty of accounts bill every month without anyone
         having logged the deal that started it. Winning a deal only
         ever promotes an account that is still an unclassified
         prospect. */
      if (a.accountType === 'partner' || a.accountType === 'former' || a.accountType === 'customer') {
        return a.accountType;
      }
      var won = API.opportunitiesFor(a.id).some(function (o) { return API.oppStage(o.stage).won; });
      return won ? 'customer' : 'prospect';
    },
    isCustomerAccount: function (a) { return API.deriveAccountType(a) === 'customer'; },

    /* ── contacts ───────────────────────────────────────────────── */
    CONTACT_ROLES: CONTACT_ROLES,
    contactName: function (c) {
      if (!c) return 'Unknown';
      var n = ((c.firstName || '') + ' ' + (c.lastName || '')).trim();
      return n || c.email || 'Unnamed contact';
    },
    contact: function (id) { return find('contacts', id); },
    contactsFor: function (accountId) {
      return db.contacts.filter(function (c) { return c.accountId === accountId; })
        .sort(function (a, b) {
          if (!!a.isPrimary !== !!b.isPrimary) return a.isPrimary ? -1 : 1;
          return API.contactName(a).localeCompare(API.contactName(b));
        });
    },
    primaryContact: function (accountId) {
      var list = API.contactsFor(accountId);
      return list.filter(function (c) { return c.isPrimary; })[0] || list[0] || null;
    },
    /* Exactly one primary per account, enforced on write — two "primary"
       contacts is the same as none when you are deciding who to call. */
    setPrimaryContact: function (id) {
      var c = find('contacts', id);
      if (!c) return;
      db.contacts.forEach(function (o) {
        if (o.accountId !== c.accountId) return;
        var want = o.id === id;
        if (!!o.isPrimary === want) return;
        o.isPrimary = want;
        push('contacts', 'update', o);
      });
      log('updated', 'contacts', id, API.contactName(c) + ' set as primary contact');
      notify();
    },

    /* ── opportunities ──────────────────────────────────────────── */
    OPP_STAGES: OPP_STAGES,
    OPP_TYPES: OPP_TYPES,
    oppStage: function (id) {
      for (var i = 0; i < OPP_STAGES.length; i++) if (OPP_STAGES[i].id === id) return OPP_STAGES[i];
      return OPP_STAGES[0];
    },
    opportunitiesFor: function (accountId) {
      return db.opportunities.filter(function (o) { return o.accountId === accountId; })
        .sort(function (a, b) {
          var ao = API.oppStage(a.stage).open, bo = API.oppStage(b.stage).open;
          if (ao !== bo) return ao ? -1 : 1;                 // live deals first
          return String(a.closeDate || '').localeCompare(String(b.closeDate || ''));
        });
    },
    openOpportunities: function () {
      return db.opportunities.filter(function (o) { return API.oppStage(o.stage).open; });
    },
    /* Amount weighted by the stage's probability — what you can
       reasonably expect to land, rather than the sum of every hope. */
    weightedPipeline: function (list) {
      return (list || API.openOpportunities()).reduce(function (s, o) {
        return s + (Number(o.amount) || 0) * (API.oppStage(o.stage).probability / 100);
      }, 0);
    },
    oppStats: function () {
      var open = API.openOpportunities();
      var won = db.opportunities.filter(function (o) { return API.oppStage(o.stage).won; });
      var lost = db.opportunities.filter(function (o) {
        return !API.oppStage(o.stage).open && !API.oppStage(o.stage).won;
      });
      var decided = won.length + lost.length;
      var today_ = today();
      return {
        open: open.length,
        openValue: open.reduce(function (s, o) { return s + (Number(o.amount) || 0); }, 0),
        weighted: API.weightedPipeline(open),
        won: won.length,
        wonValue: won.reduce(function (s, o) { return s + (Number(o.amount) || 0); }, 0),
        lost: lost.length,
        winRate: decided ? Math.round((won.length / decided) * 100) : 0,
        /* A deal whose close date has passed but which is still open is
           not forecast — it is a date nobody updated. */
        slipping: open.filter(function (o) { return o.closeDate && o.closeDate < today_; }).length
      };
    },
    setOppStage: function (id, stage) {
      var o = find('opportunities', id);
      if (!o) return null;
      var st = API.oppStage(stage);
      var patch = { stage: stage, closedAt: st.open ? '' : now() };
      update('opportunities', id, patch, o.name + ' → ' + st.label);
      return find('opportunities', id);
    },

    /* ── activities (task / call / event) ───────────────────────── */
    TASK_KINDS: TASK_KINDS,
    taskKind: function (id) {
      for (var i = 0; i < TASK_KINDS.length; i++) if (TASK_KINDS[i].id === id) return TASK_KINDS[i];
      return TASK_KINDS[0];
    },
    isTaskDone: function (t) { return t && t.status === 'completed'; },
    taskState: function (t) {
      if (API.isTaskDone(t)) return { key: 'done', label: 'Completed', tone: 'b-grey', rank: 4 };
      if (!t.dueDate) return { key: 'undated', label: 'No date', tone: 'b-grey', rank: 3 };
      var d = API.daysUntil(t.dueDate);
      if (d < 0) return { key: 'overdue', label: Math.abs(d) + 'd overdue', tone: 'b-red', rank: 0, days: d };
      if (d === 0) return { key: 'today', label: 'Today', tone: 'b-orange', rank: 1, days: 0 };
      return { key: 'upcoming', label: 'in ' + d + ' day' + (d === 1 ? '' : 's'), tone: 'b-blue', rank: 2, days: d };
    },
    tasksFor: function (type, id) {
      return db.tasks.filter(function (t) { return t.entityType === type && t.entityId === id; })
        .sort(function (a, b) {
          if (API.isTaskDone(a) !== API.isTaskDone(b)) return API.isTaskDone(a) ? 1 : -1;
          return String(a.dueDate || '9999').localeCompare(String(b.dueDate || '9999'));
        });
    },
    /* Salesforce's "Upcoming & Overdue" — everything still to do,
       most urgent first. */
    openTasks: function (opts) {
      opts = opts || {};
      return db.tasks.filter(function (t) {
        if (API.isTaskDone(t)) return false;
        if (opts.assigneeId && t.assigneeId !== opts.assigneeId) return false;
        if (opts.entityType && (t.entityType !== opts.entityType || t.entityId !== opts.entityId)) return false;
        return true;
      }).sort(function (a, b) {
        var ra = API.taskState(a).rank, rb = API.taskState(b).rank;
        return ra - rb || String(a.dueDate || '9999').localeCompare(String(b.dueDate || '9999'));
      });
    },
    completedTasksFor: function (type, id) {
      return db.tasks.filter(function (t) {
        return t.entityType === type && t.entityId === id && API.isTaskDone(t);
      }).sort(function (a, b) { return String(b.completedAt || '').localeCompare(String(a.completedAt || '')); });
    },
    addTask: function (rec) {
      var t = {
        id: uid('tk'),
        kind: rec.kind || 'task',
        subject: rec.subject || '',
        description: rec.description || '',
        /* A logged call describes something that already happened, so it
           is created complete. A task or event is work still to come. */
        status: rec.kind === 'call' ? 'completed' : (rec.status || 'open'),
        priority: rec.priority || 'normal',
        dueDate: rec.dueDate || today(),
        startTime: rec.startTime || '',
        endTime: rec.endTime || '',
        entityType: rec.entityType || '',
        entityId: rec.entityId || '',
        assigneeId: rec.assigneeId || meId || '',
        createdById: meId || '',
        completedAt: rec.kind === 'call' ? now() : '',
        createdAt: now()
      };
      db.tasks.push(t);
      log(t.kind === 'call' ? 'logged a call' : 'scheduled', t.entityType, t.entityId, t.subject);
      push('tasks', 'insert', t);
      notify();
      return t;
    },
    completeTask: function (id, done) {
      var t = find('tasks', id);
      if (!t) return null;
      var want = done === undefined ? true : !!done;
      update('tasks', id, {
        status: want ? 'completed' : 'open',
        completedAt: want ? now() : ''
      }, (want ? 'completed ' : 'reopened ') + t.subject);
      return find('tasks', id);
    },
    /* Every route that can own an activity, so one panel serves them all. */
    entityHref: function (type, id) {
      var seg = type === 'vendor' ? 'vendors'
        : type === 'lead' ? 'leads'
        : type === 'opportunity' ? 'opportunities'
        : type === 'contact' ? 'contacts'
        : type === 'workorder' ? 'workorders'
        : 'accounts';
      return '#/' + seg + '/' + id;
    },
    entityLabel: function (type, id) {
      if (type === 'lead') { var l = find('leads', id); return l ? l.name : 'Unknown lead'; }
      if (type === 'opportunity') { var o = find('opportunities', id); return o ? o.name : 'Unknown deal'; }
      if (type === 'contact') { var c = find('contacts', id); return c ? API.contactName(c) : 'Unknown contact'; }
      if (type === 'vendor') { var v = find('vendors', id); return v ? v.name : 'Unknown vendor'; }
      if (type === 'workorder') { var w = find('workOrders', id); return w ? w.title : 'Unknown work order'; }
      var a = find('customers', id);
      return a ? a.name : 'Unknown account';
    },

    /* ── daily outreach ─────────────────────────────────────────── */
    OUTREACH_CHANNELS: OUTREACH_CHANNELS,
    OUTREACH_KINDS: OUTREACH_KINDS,
    outreachChannel: function (id) {
      for (var i = 0; i < OUTREACH_CHANNELS.length; i++) if (OUTREACH_CHANNELS[i].id === id) return OUTREACH_CHANNELS[i];
      return OUTREACH_CHANNELS[OUTREACH_CHANNELS.length - 1];
    },
    outreachKind: function (id) {
      for (var i = 0; i < OUTREACH_KINDS.length; i++) if (OUTREACH_KINDS[i].id === id) return OUTREACH_KINDS[i];
      return OUTREACH_KINDS[0];
    },
    outreachGroup: function (id) {
      return find('outreachGroups', id) || { id: id, name: 'Unassigned', channel: 'other', cadenceDays: 7 };
    },
    activeGroups: function () {
      return db.outreachGroups.filter(function (g) { return g.active !== false; });
    },

    /* Daily target. 0 means no target, and the tracker then counts any
       day with at least one touch as a day you showed up. */
    outreachGoal: function () { return Number(db.settings.outreachDailyGoal) || 0; },
    setOutreachGoal: function (n) {
      API.saveSettings({ outreachDailyGoal: Math.max(0, Math.round(Number(n) || 0)) });
    },

    outreachOn: function (date, userId) {
      return db.outreach.filter(function (o) {
        if (o.date !== date) return false;
        return !userId || o.userId === userId;
      });
    },
    outreachFor: function (groupId) {
      return db.outreach.filter(function (o) { return o.groupId === groupId; })
        .sort(function (a, b) { return String(b.date).localeCompare(String(a.date)); });
    },
    lastOutreachDate: function (groupId) {
      var list = API.outreachFor(groupId);
      return list.length ? list[0].date : '';
    },

    /* Consecutive days the target was met.

       Counting starts at yesterday when today is not done yet — a streak
       that resets to zero every morning until the first post of the day
       tells you nothing and punishes you for waking up. */
    outreachStreak: function (userId) {
      var goal = API.outreachGoal();
      var need = goal > 0 ? goal : 1;
      var counts = {};
      db.outreach.forEach(function (o) {
        if (userId && o.userId !== userId) return;
        if (!o.date) return;
        counts[o.date] = (counts[o.date] || 0) + 1;
      });

      var todayKey = today();
      var todayCount = counts[todayKey] || 0;
      var todayMet = todayCount >= need;

      var d = new Date(todayKey + 'T00:00:00');
      if (!todayMet) d.setDate(d.getDate() - 1);

      var days = 0;
      /* Bounded so a corrupt date can never spin here forever. */
      for (var guard = 0; guard < 3650; guard++) {
        var key = dateKey(d);
        if ((counts[key] || 0) >= need) { days++; d.setDate(d.getDate() - 1); }
        else break;
      }
      return {
        days: days, todayCount: todayCount, todayMet: todayMet,
        goal: need, hasGoal: goal > 0,
        remaining: Math.max(0, need - todayCount)
      };
    },

    /* Where to post next. A group you have never touched ranks above one
       that is merely overdue; a group inside its cooldown is not offered
       at all, because most groups remove you for posting too often. */
    groupState: function (g) {
      var cadence = Number(g.cadenceDays) || 7;
      var last = API.lastOutreachDate(g.id);
      if (!last) {
        return { key: 'never', label: 'Never posted', tone: 'b-yellow', rank: 0, daysSince: null, wait: 0 };
      }
      var daysSince = -API.daysUntil(last);
      if (daysSince >= cadence) {
        return { key: 'due', label: daysSince + 'd since last', tone: 'b-orange', rank: 1, daysSince: daysSince, wait: 0 };
      }
      return {
        key: 'cooling', label: 'Wait ' + (cadence - daysSince) + 'd', tone: 'b-grey',
        rank: 2, daysSince: daysSince, wait: cadence - daysSince
      };
    },
    groupsDue: function () {
      return API.activeGroups().filter(function (g) {
        return API.groupState(g).key !== 'cooling';
      }).sort(function (a, b) {
        var sa = API.groupState(a), sb = API.groupState(b);
        return sa.rank - sb.rank || (sb.daysSince || 9999) - (sa.daysSince || 9999);
      });
    },

    /* The attribution chain: touch → lead → account → won deal. Without
       this the tracker is just a chore list. */
    leadsFromOutreach: function (outreachId) {
      return db.leads.filter(function (l) { return l.outreachId === outreachId; });
    },
    leadsFromGroup: function (groupId) {
      var ids = {};
      API.outreachFor(groupId).forEach(function (o) { ids[o.id] = 1; });
      return db.leads.filter(function (l) { return l.outreachId && ids[l.outreachId]; });
    },
    /* Rolled up per group or per channel over a window of days. */
    outreachStats: function (opts) {
      opts = opts || {};
      var since = opts.days ? shift(-opts.days) : '';
      var list = db.outreach.filter(function (o) {
        if (since && o.date < since) return false;
        if (opts.userId && o.userId !== opts.userId) return false;
        if (opts.groupId && o.groupId !== opts.groupId) return false;
        if (opts.channel && o.channel !== opts.channel) return false;
        return true;
      });

      var leadIds = {};
      list.forEach(function (o) {
        API.leadsFromOutreach(o.id).forEach(function (l) { leadIds[l.id] = l; });
      });
      var leads = Object.keys(leadIds).map(function (k) { return leadIds[k]; });
      var converted = leads.filter(function (l) { return !!l.convertedCustomerId; });

      /* What the work actually earned: won deals on the accounts those
         leads became. */
      var wonValue = 0;
      converted.forEach(function (l) {
        API.opportunitiesFor(l.convertedCustomerId).forEach(function (o) {
          if (API.oppStage(o.stage).won) wonValue += Number(o.amount) || 0;
        });
      });

      return {
        touches: list.length,
        responses: list.reduce(function (s, o) { return s + (Number(o.responses) || 0); }, 0),
        leads: leads.length,
        converted: converted.length,
        wonValue: wonValue,
        /* Leads per touch — the number that says whether a group is
           worth the time it costs. */
        yield: list.length ? Math.round((leads.length / list.length) * 100) : 0
      };
    },

    logOutreach: function (rec) {
      var g = rec.groupId ? find('outreachGroups', rec.groupId) : null;
      var o = {
        id: uid('or'),
        date: rec.date || today(),
        /* Channel follows the group so the two can never disagree. */
        channel: (g && g.channel) || rec.channel || 'other',
        groupId: rec.groupId || '',
        kind: rec.kind || 'comment',
        summary: rec.summary || '',
        url: rec.url || '',
        responses: Number(rec.responses) || 0,
        userId: meId || '',
        createdAt: now()
      };
      db.outreach.push(o);
      log('reached out', 'outreach', o.id,
        (g ? g.name : API.outreachChannel(o.channel).label) + ' — ' + API.outreachKind(o.kind).label);
      push('outreach', 'insert', o);
      notify();
      return o;
    },

    /* ── leads ──────────────────────────────────────────────────── */
    LEAD_STATUSES: LEAD_STATUSES,
    LEAD_RATINGS: LEAD_RATINGS,
    LEAD_SOURCES: LEAD_SOURCES,
    FOLLOW_UP: FOLLOW_UP,
    leadStatus: function (id) {
      for (var i = 0; i < LEAD_STATUSES.length; i++) if (LEAD_STATUSES[i].id === id) return LEAD_STATUSES[i];
      return LEAD_STATUSES[0];
    },
    leadRating: function (id) {
      for (var i = 0; i < LEAD_RATINGS.length; i++) if (LEAD_RATINGS[i].id === id) return LEAD_RATINGS[i];
      return LEAD_RATINGS[1];                 // warm
    },
    /* Still in play — not converted, not written off. */
    isLeadOpen: function (l) { return API.leadStatus(l && l.leadStatus).open; },
    isConverted: function (l) { return !!(l && l.convertedCustomerId); },

    /* Where a lead sits against its next touch. */
    followUpState: function (l) {
      if (!API.isLeadOpen(l)) return fuState(FOLLOW_UP.closed, null);
      if (!l.nextFollowUp) return fuState(FOLLOW_UP.unscheduled, null);
      var d = API.daysUntil(l.nextFollowUp);
      if (d < 0) return fuState(FOLLOW_UP.overdue, d);
      if (d === 0) return fuState(FOLLOW_UP.today, 0);
      if (d <= 7) return fuState(FOLLOW_UP.soon, d);
      return fuState(FOLLOW_UP.scheduled, d);
    },
    openLeads: function () { return db.leads.filter(API.isLeadOpen); },
    /* Overdue, due today, or never scheduled — sorted most urgent first. */
    leadsNeedingAttention: function (userId) {
      return db.leads.filter(function (l) {
        if (userId && l.ownerId !== userId) return false;
        var k = API.followUpState(l).key;
        return k === 'overdue' || k === 'today' || k === 'unscheduled';
      }).sort(function (a, b) {
        var fa = API.followUpState(a), fb = API.followUpState(b);
        return fa.rank - fb.rank || String(a.nextFollowUp || '').localeCompare(String(b.nextFollowUp || ''));
      });
    },
    leadStats: function () {
      var byStatus = function (id) {
        return db.leads.filter(function (l) { return l.leadStatus === id; });
      };
      var converted = byStatus('converted');
      var unqualified = byStatus('unqualified');
      var dead = byStatus('dead');
      var open = API.openLeads();

      /* Rate over decided leads only. Counting leads still in play as
         failures would make the number fall every time you add one.
         Dead counts as decided — it is a loss, not an open question. */
      var decided = converted.length + unqualified.length + dead.length;

      /* Of the leads that were a real fit, how many did we actually
         land? Unqualified leads are excluded from both halves: they were
         never winnable, and leaving them in flatters the number when
         targeting is loose and punishes it when targeting is tight. */
      var winnable = converted.length + dead.length;

      return {
        total: db.leads.length,
        open: open.length,
        qualified: byStatus('qualified').length,
        converted: converted.length,
        unqualified: unqualified.length,
        dead: dead.length,
        lost: unqualified.length + dead.length,
        convRate: decided ? Math.round((converted.length / decided) * 100) : 0,
        winRate: winnable ? Math.round((converted.length / winnable) * 100) : 0,
        attention: API.leadsNeedingAttention().length,
        value: open.reduce(function (s, l) { return s + (Number(l.estValue) || 0); }, 0)
      };
    },

    /* Put a closed lead back in play. The reason it was closed is kept
       as history rather than wiped — why it died the first time is the
       most useful thing to know when picking it back up. */
    reviveLead: function (id, nextFollowUp) {
      var l = find('leads', id);
      if (!l) return null;
      update('leads', id, {
        leadStatus: 'working',
        nextFollowUp: nextFollowUp || shift(1)
      }, l.name + ' back in play');
      if (l.lostReason) {
        API.addNote('lead', id, 'Reopened. Previously closed because: ' + l.lostReason);
      }
      return find('leads', id);
    },

    /* Record a touch and book the next one in a single step, so nobody
       logs a call and leaves the lead with no next action. */
    logContact: function (id, opts) {
      var l = find('leads', id);
      if (!l) return null;
      opts = opts || {};
      var patch = {
        lastContactedAt: opts.date || today(),
        nextFollowUp: opts.nextFollowUp || ''
      };
      if (opts.leadStatus) patch.leadStatus = opts.leadStatus;
      /* Only carried when the lead is actually being closed, so moving a
         lead back into play cannot leave a stale reason attached to an
         open lead. */
      if (opts.lostReason !== undefined && opts.leadStatus &&
          !API.leadStatus(opts.leadStatus).open) {
        patch.lostReason = opts.lostReason;
      }
      update('leads', id, patch, 'contacted ' + l.name);
      if (opts.note) API.addNote('lead', id, opts.note);
      return find('leads', id);
    },

    /* Lead → Account + Contact + Opportunity, the way Salesforce
       converts. One direction, once. The opportunity is optional: not
       every lead you decide to keep is a live deal today. */
    convertLead: function (id, overrides) {
      var lead = find('leads', id);
      if (!lead) throw new Error('That lead no longer exists.');
      if (lead.convertedCustomerId) {
        var already = find('customers', lead.convertedCustomerId);
        throw new Error(lead.name + ' was already converted' +
          (already ? ' to ' + already.name + '.' : '.'));
      }
      var o = overrides || {};

      /* 1. The Account — or an existing one, when this lead turned out
         to be a second contact at a company already on the books. */
      var account = o.accountId ? find('customers', o.accountId) : null;
      if (!account) {
        account = insert('customers', {
          name: o.accountName || lead.name,
          contactName: lead.contactName || '',
          email: lead.email || '',
          phone: lead.phone || '',
          status: 'new',
          accountType: 'prospect',
          ownerId: o.ownerId || lead.ownerId || (meId || ''),
          services: [],
          billingDate: '',
          billingCycle: o.billingCycle || 'Monthly',
          value: 0,
          billingType: o.billingType || 'paid',
          tags: (lead.tags || []).slice(),
          industry: lead.industry || '',
          source: lead.source || '',
          address: lead.address || '',
          website: lead.website || '',
          stripeCustomerId: '',
          convertedFromLeadId: lead.id
        }, 'c', o.accountName || lead.name);
      }

      /* 2. The Contact — the person, split off the company. */
      var contact = null;
      var person = (o.contactName !== undefined ? o.contactName : lead.contactName) || '';
      if (person || lead.email) {
        var parts = splitName(person || lead.email);
        contact = insert('contacts', {
          accountId: account.id,
          firstName: parts.first,
          lastName: parts.last,
          title: lead.contactTitle || '',
          email: lead.email || '',
          phone: lead.phone || '',
          role: o.contactRole || '',
          isPrimary: !API.primaryContact(account.id),
          ownerId: account.ownerId,
          tags: [],
          convertedFromLeadId: lead.id
        }, 'ct', API.contactName({ firstName: parts.first, lastName: parts.last }));
      }

      /* 3. The Opportunity. */
      var opp = null;
      if (o.createOpportunity !== false) {
        opp = insert('opportunities', {
          name: o.oppName || (account.name + ' — ' + (o.oppType || 'New Business')),
          accountId: account.id,
          contactId: contact ? contact.id : '',
          stage: o.stage || 'qualification',
          amount: Number(o.amount != null && o.amount !== '' ? o.amount : lead.estValue) || 0,
          closeDate: o.closeDate || shift(30),
          ownerId: account.ownerId,
          type: o.oppType || 'New Business',
          leadSource: lead.source || '',
          services: o.services || [],
          nextStep: '',
          description: '',
          closedAt: ''
        }, 'op', o.oppName || account.name);
      }

      /* Move the notes rather than copy them. The sales conversation now
         belongs to the account, and two editable copies would drift. */
      var moved = 0;
      db.notes.forEach(function (n) {
        if (n.entityType !== 'lead' || n.entityId !== lead.id) return;
        n.entityType = 'customer';
        n.entityId = account.id;
        push('notes', 'update', n);
        moved++;
      });

      /* Open activities follow the lead's owner to the new account so
         nothing scheduled quietly falls off the board. */
      db.tasks.forEach(function (t) {
        if (t.entityType !== 'lead' || t.entityId !== lead.id) return;
        t.entityType = opp ? 'opportunity' : 'customer';
        t.entityId = opp ? opp.id : account.id;
        push('tasks', 'update', t);
      });

      update('leads', id, {
        leadStatus: 'converted',
        convertedCustomerId: account.id,
        convertedContactId: contact ? contact.id : '',
        convertedOpportunityId: opp ? opp.id : '',
        convertedAt: now(),
        nextFollowUp: ''
      }, lead.name + ' converted');

      API.addNote('customer', account.id,
        'Converted from lead “' + lead.name + '”' +
        (lead.source ? ' (source: ' + lead.source + ')' : '') + '.' +
        (moved ? ' ' + moved + ' lead note' + (moved === 1 ? '' : 's') + ' moved across.' : ''));

      log('converted', 'leads', lead.id, lead.name + ' → account' +
        (contact ? ' + contact' : '') + (opp ? ' + opportunity' : ''));
      notify();
      return { account: account, contact: contact, opportunity: opp };
    },

    /* Same key the importer dedupes on: email, then domain, then name. */
    leadKey: function (rec) {
      if (!rec) return '';
      if (rec.email) return 'e:' + String(rec.email).trim().toLowerCase();
      if (rec.website) {
        var d = String(rec.website).trim().toLowerCase()
          .replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '');
        if (d) return 'd:' + d;
      }
      return 'n:' + String(rec.name || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
    },
    /* Existing leads AND customers — re-importing a list must not create a
       second lead for somebody you already sold to. */
    knownKeys: function () {
      var keys = {};
      db.leads.forEach(function (l) { keys[API.leadKey(l)] = l; });
      db.customers.forEach(function (c) { keys[API.leadKey(c)] = c; });
      delete keys['n:'];
      return keys;
    },

    /* ── tags ───────────────────────────────────────────────────── */
    tagsOf: function (rec) { return (rec && rec.tags) || []; },
    /* Every tag in use, for filters and autocomplete. */
    allTags: function () {
      var seen = {};
      db.customers.concat(db.vendors, db.leads).forEach(function (r) {
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

    /* records — work orders and activities can hang off any object, so
       these resolve by entityType rather than assuming account/vendor. */
    record: function (type, id) {
      var coll = type === 'vendor' ? 'vendors'
        : type === 'lead' ? 'leads'
        : type === 'opportunity' ? 'opportunities'
        : type === 'contact' ? 'contacts'
        : type === 'workorder' ? 'workOrders'
        : 'customers';
      return find(coll, id);
    },
    recordName: function (type, id) { return API.entityLabel(type, id); },

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
    /* Recurring revenue comes from the ACCOUNT's contract, not from
       opportunity amounts. A deal is a one-off event with a close date;
       what the account pays every month is a separate, ongoing fact.
       Conflating them would count a $13k signing as $13k a month. */
    mrr: function () {
      return db.customers.reduce(function (s, c) {
        if (!API.isCustomerAccount(c)) return s;
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
      /* An older backup will be missing whatever collections did not exist
         when it was taken. Fill them in rather than restoring a database
         with holes in it. */
      db = normalize(incoming);
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
