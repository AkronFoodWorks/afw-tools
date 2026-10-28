/* Smoke test for afw-catering-proposal-builder.html
 *
 * Needs jsdom, which this repo doesn't install. From any scratch folder:
 *   npm i jsdom
 *   NODE_PATH=$PWD/node_modules node --test /path/to/afw-tools/tests/
 *
 * Loads the page the way a browser would (without afw-config.js /
 * afw-cloud.js, so it also proves the tool works with cloud save absent),
 * then checks the lesson's worked example number by number and the
 * generated text character by character.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const FILE = path.join(__dirname, '..', 'afw-catering-proposal-builder.html');
const HTML = fs.readFileSync(FILE, 'utf8');

function load(opts = {}){
  const dom = new JSDOM(HTML, {
    runScripts: 'dangerously',
    url: 'http://localhost:8000/afw-catering-proposal-builder.html',
    beforeParse(win){
      win.scrollTo = () => {};
      win.confirm = () => true;
      if (opts.cloud) win.AFWCloud = opts.cloud;
    }
  });
  return dom.window;
}

/* The lesson's worked example, plus the Dietary options block AFW added
   (2026-10: members declare every dish they tag V/VG/GF/DF). */
const WORKED_EXAMPLE = `Towpath Catering Co.
Classic option — 40 guests

Beef lasagna, full pan — serves 10 — $75
3 pans = $225 · Contains: wheat, milk, eggs

Vegetarian lasagna, full pan — serves 10 — $70
1 pan = $70 · V · Contains: wheat, milk, eggs

Garden salad, full pan — serves 15 — $45
3 pans = $135 · VG, GF · Contains: sesame

Garlic bread, tray — serves 12 — $24
4 trays = $96 · V · Contains: wheat, milk

Dietary options:
Vegetarian: Vegetarian lasagna, Garden salad, Garlic bread
Vegan: Garden salad
Gluten-free: Garden salad

Total: $526 ($13.15 per guest)

Service style: Pickup at AFW, Friday by 11:30
Notice needed: 3 days
Setup and supplies: Serving utensils included
Payment terms: 50% deposit to book (non-refundable), balance due at pickup
Prices good for: 14 days`;

function sampleIn(win){
  win.document.querySelector('[data-act="sample"]').click();
  return win.CPB.state;
}
// values made inside the jsdom window have that window's prototypes
const plain = v => JSON.parse(JSON.stringify(v));
const classicOnly = st => Object.assign(JSON.parse(JSON.stringify(st)), { options:[st.options[0]] });

test('Load sample reproduces the worked example line totals', () => {
  const win = load();
  const st = sampleIn(win);
  const oc = win.CPB.optionCalc(st, st.options[0]);
  assert.deepEqual(plain(oc.rows.map(r => r.c.line)), [22500, 7000, 13500, 9600]);
  assert.deepEqual(plain(oc.rows.map(r => r.c.pans)), [3, 1, 3, 4]);
  assert.equal(oc.total, 52600);
  assert.equal(oc.perGuest, 1315);
  assert.equal(win.CPB.money(oc.total), '$526');
  assert.equal(win.CPB.money2(oc.perGuest), '$13.15');
});

test('Plus option is $626 and $15.65 per guest', () => {
  const win = load();
  const st = sampleIn(win);
  const oc = win.CPB.optionCalc(st, st.options[1]);
  assert.equal(oc.rows[4].c.pans, 2);           // brownies: 40 / 20
  assert.equal(oc.total, 62600);
  assert.equal(win.CPB.money2(oc.perGuest), '$15.65');
});

test('Pans round UP (40 guests, salad serves 15 → 3; bread serves 12 → 4)', () => {
  const win = load();
  const c = win.CPB.itemCalc;
  assert.equal(c({ serves:15, pricePerPan:45, forWho:'all' }, 40).pans, 3);
  assert.equal(c({ serves:12, pricePerPan:24, forWho:'all' }, 40).pans, 4);
  assert.equal(c({ serves:10, pricePerPan:75, forWho:'all' }, 40).pans, 4);
  assert.equal(c({ serves:10, pricePerPan:75, forWho:'all' }, 30).pans, 3);   // exact division stays exact
  assert.equal(c({ serves:10, pricePerPan:75, forWho:'some', forGuests:30 }, 40).pans, 3);
  const ov = c({ serves:10, pricePerPan:75, forWho:'all', pansOverride:2 }, 40);
  assert.equal(ov.pans, 2);
  assert.equal(ov.short, true);                  // override below the guest count is flagged
  assert.equal(c({ serves:10, pricePerPan:75, forWho:'all' }, 40).perPerson, 750);
});

test('Generated text matches the worked example exactly', () => {
  const win = load();
  const st = sampleIn(win);
  assert.equal(win.CPB.buildText(classicOnly(st)), WORKED_EXAMPLE);
  // and the on-screen preview / print copy carry the same text
  const full = win.CPB.buildText(st);
  assert.equal(win.document.getElementById('preview').textContent, full);
  // print uses light styling, but carries every line of the same words
  const printed = win.document.getElementById('printOut').textContent;
  full.split('\n').filter(Boolean).forEach(l => assert.ok(printed.includes(l.replace(/^Dietary options:$/, 'Dietary options')), l));
});

test('Two options: one business line, options separated, terms once', () => {
  const win = load();
  const st = sampleIn(win);
  const t = win.CPB.buildText(st);
  assert.equal((t.match(/Towpath Catering Co\./g) || []).length, 1);
  assert.equal((t.match(/^Payment terms:/gm) || []).length, 1);
  assert.ok(t.includes('Total: $526 ($13.15 per guest)\n\nPlus option — 40 guests\n\n'));
  assert.ok(t.includes('Brownies, tray — serves 20 — $50\n2 trays = $100 · V · Contains: wheat, milk, eggs\n\nDietary options:\nVegetarian: Vegetarian lasagna, Garden salad, Garlic bread, Brownies\nVegan: Garden salad\nGluten-free: Garden salad\n\nTotal: $626 ($15.65 per guest)\n\nService style:'));
});

test('Extras: flat, per guest, per hour with minimum, per mile', () => {
  const win = load();
  const x = (charge) => win.CPB.extraCalc({ charge }, 40);
  assert.equal(x({ type:'flat', amount:35 }).cents, 3500);
  assert.equal(x({ type:'perGuest', rate:1.25 }).cents, 5000);
  assert.equal(x({ type:'perGuest', rate:1.25 }).detail, '($1.25 per guest × 40)');
  // 2 staff × max(2 hrs, 3-hr min) × $25 = $150
  const h = x({ type:'perHour', rate:25, hours:2, staff:2, minHours:3 });
  assert.equal(h.cents, 15000);
  assert.equal(h.detail, '(2 staff × 3 hrs × $25/hr, 3-hr minimum)');
  // above the minimum, real hours are used
  assert.equal(x({ type:'perHour', rate:25, hours:4, staff:2, minHours:3 }).cents, 20000);
  assert.equal(x({ type:'perHour', rate:25, hours:3 }).detail, '(3 hrs × $25/hr)');
  assert.equal(x({ type:'perMile', rate:1.5, miles:12 }).cents, 1800);
});

test('Paid extras change the total block; no paid extras keeps the lesson format', () => {
  const win = load();
  const st = sampleIn(win);
  const one = classicOnly(st);
  one.extras.find(e => e.id === 'delivery').status = 'extra';
  Object.assign(one.extras.find(e => e.id === 'delivery').charge, { type:'perMile', rate:1.5, miles:12 });
  one.extras.find(e => e.id === 'staff').status = 'extra';
  Object.assign(one.extras.find(e => e.id === 'staff').charge, { type:'perHour', rate:25, hours:3, staff:2, minHours:3 });
  one.extras.find(e => e.id === 'warmers').status = 'extra';
  Object.assign(one.extras.find(e => e.id === 'warmers').charge, { type:'flat', amount:20 });
  const t = win.CPB.buildText(one);
  assert.ok(t.includes(
    'Food subtotal: $526\n' +
    'Warmers, racks, and sternos: $20\n' +
    'Delivery (12 miles × $1.50/mile): $18\n' +
    'On-site service staff (2 staff × 3 hrs × $25/hr, 3-hr minimum): $150\n' +
    'Total: $714 ($17.85 per guest, all in)'), t);
  assert.ok(t.includes('Setup and supplies: Serving utensils included; warmers (racks and sternos) and on-site service staff extra (listed above)'));
  // "included" and "not offered" rows never add a line
  const two = classicOnly(st);
  two.extras.find(e => e.id === 'linens').status = 'none';
  assert.ok(!win.CPB.buildText(two).includes('Food subtotal'));
});

test('Sales tax: off by default, a line when chosen, a note when chosen', () => {
  const win = load();
  const st = classicOnly(sampleIn(win));
  assert.ok(!/tax/i.test(win.CPB.buildText(st)));
  st.tax = { mode:'line', type:'rate', rate:7.25, amount:null, includeExtras:true };
  const t = win.CPB.buildText(st);
  // 526 × 7.25% = 38.135 → $38.14; 564.14 / 40 = 14.1035 → $14.10
  assert.ok(t.includes('Food subtotal: $526\nSales tax (7.25%): $38.14\nTotal: $564.14 ($14.10 per guest, all in)'), t);
  st.tax.mode = 'note';
  assert.ok(win.CPB.buildText(st).endsWith('Prices good for: 14 days\nSales tax: not included in the prices above'));
});

test('Allergens are never assumed', () => {
  const win = load();
  const st = classicOnly(sampleIn(win));
  st.options[0].items[0].allergens = [];
  assert.ok(win.CPB.buildText(st).includes('3 pans = $225 · Contains: [fill in]'));
  st.options[0].items[0].allergenNone = true;
  assert.ok(win.CPB.buildText(st).includes('3 pans = $225 · Contains: none of the major allergens'));
  // a fresh dish is unset, not "none"
  const blank = win.CPB.blankState().options[0].items[0];
  assert.equal(blank.allergenNone, false);
  assert.deepEqual(plain(blank.allergens), []);
});

test('Deposit and date math', () => {
  const win = load();
  const st = sampleIn(win);
  st.event.eventDate = '2026-11-13';
  const today = new win.Date(2026, 9, 27);           // Oct 27, 2026
  const iso = d => d && `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;

  // Simple: 50% of Classic $526 = $263, balance $263 due at the event
  let f = win.CPB.termFacts(st, today);
  assert.equal(f.deposit, 26300);
  assert.equal(f.balance, 26300);
  assert.equal(f.depositDueText, 'when the client says yes');
  assert.equal(iso(f.balanceDue), '2026-11-13');
  assert.equal(iso(f.pricesGoodUntil), '2026-11-10');  // 14 days from Oct 27
  assert.equal(f.refundCutoff, null);                  // non-refundable

  // Flexible: 25% = $131.50, refundable until 7 days before → Nov 6
  Object.assign(st.terms, { deposit:{ type:'percent', value:25, due:'toBook', dueDays:null },
    refund:{ type:'refundable', cutoffDays:7, percent:null } });
  f = win.CPB.termFacts(st, today);
  assert.equal(f.deposit, 13150);
  assert.equal(iso(f.refundCutoff), '2026-11-06');
  assert.equal(win.CPB.autoPaymentLine(st), '25% deposit to book (refundable until 7 days before the event), balance due at pickup');

  // deposit on the Plus option, due 14 days before; balance 3 days before
  st.terms.depositOptionId = st.options[1].id;
  st.terms.deposit = { type:'percent', value:50, due:'daysBefore', dueDays:14 };
  st.terms.balance = { due:'daysBefore', days:3 };
  f = win.CPB.termFacts(st, today);
  assert.equal(f.deposit, 31300);
  assert.equal(iso(f.depositDue), '2026-10-30');
  assert.equal(iso(f.balanceDue), '2026-11-10');
  assert.equal(win.CPB.autoPaymentLine(st), '50% deposit due 14 days before the event (refundable until 7 days before the event), balance due 3 days before the event');

  // across a month boundary
  st.event.eventDate = '2026-12-02';
  assert.equal(iso(win.CPB.termFacts(st, today).depositDue), '2026-11-18');
});

test('Pan pricing panel matches the workbook cost and price columns', () => {
  const win = load();
  const pc = win.CPB.panCalc;
  const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} vs ${b}`);
  // Beef Lasagna (9×13) row of the Pan Pricing Calculator tab: 20 servings
  const l = pc({ ingredients:22, labor:15, packaging:5, marginPct:45 }, 20);
  assert.equal(l.totalCost, 42);
  close(l.costPerServing, 2.1);
  close(l.pricePerServing, 3.81818181818182);
  close(l.pricePerPan, 76.3636363636364);
  assert.deepEqual(plain(win.CPB.panCalcToItem(l)), { pricePerPan:76.36 });
  // Jollof row's costs and margin, with the member's own serves number
  const j = pc({ ingredients:34, labor:18, packaging:6, marginPct:40 }, 34);
  close(j.costPerServing, 58 / 34);
  close(j.pricePerPan, 58 / 0.6);                    // = cost ÷ (1 − margin) for the pan
  assert.deepEqual(plain(win.CPB.panCalcToItem(j)), { pricePerPan:96.67 });
  // blank rules: no serves → blank; margin ≥ 100% → blank; no costs → blank
  assert.equal(pc({ ingredients:22, marginPct:45 }, null).pricePerPan, null);
  assert.equal(pc({ ingredients:22, marginPct:100 }, 20).pricePerServing, null);
  assert.equal(pc({ marginPct:45 }, 20).totalCost, null);
  // portion size never enters the math
  assert.equal(pc({ ingredients:22, labor:15, packaging:5, marginPct:45, servingOz:3 }, 20).pricePerPan, l.pricePerPan);
  // the Serving Size Guide ranges
  assert.equal(win.CPB.SERVING_GUIDE.length, 8);
  assert.deepEqual([win.CPB.SERVING_GUIDE[4].lo, win.CPB.SERVING_GUIDE[4].hi], [8, 10]);
});

test('Use this price fills the price only; Other portion size takes its own oz', () => {
  const win = load();
  sampleIn(win);
  const doc = win.document;
  doc.querySelector('#stepnav [data-val="1"]').click();
  const it = () => win.CPB.state.options[0].items[0];
  Object.assign(it().panCalc, { ingredients:22, labor:15, packaging:5, marginPct:45 });
  win.CPB.renderAll();
  doc.querySelector(`[data-act="usePan"][data-val="${it().id}"]`).click();
  assert.equal(it().serves, 10);                     // unchanged
  assert.equal(it().pricePerPan, 76.36);             // 42 ÷ 0.55, to the cent
  // "Other" shows a fill-in for the member's own portion size
  const sel = doc.getElementById('f_options_0_items_0_panCalc_guide');
  sel.value = 'other';
  sel.dispatchEvent(new win.Event('change', { bubbles:true }));
  const oz = doc.getElementById('f_options_0_items_0_panCalc_servingOz');
  assert.ok(oz, 'Other portion-size field shown');
  oz.value = '7.5';
  oz.dispatchEvent(new win.Event('input', { bubbles:true }));
  assert.equal(it().panCalc.servingOz, 7.5);
  assert.match(doc.getElementById('pcServ_' + it().id).textContent, /Portion: 7\.5 oz/);
  // no weigh-the-pan fields anywhere
  assert.equal(doc.querySelector('[data-bind$=".emptyOz"], [data-bind$=".fullOz"]'), null);
});

test('JSON save → load round trip, and old/partial files still load', () => {
  const win = load();
  sampleIn(win);
  const saved = JSON.parse(JSON.stringify(win.CPB.collectState()));
  assert.equal(saved.fileVersion, 1);
  assert.equal(saved._tool, 'catering-proposal-builder');
  const text = win.CPB.buildText(win.CPB.state);

  const win2 = load();
  win2.CPB.applyState(saved);
  assert.equal(win2.CPB.buildText(win2.CPB.state), text);
  const again = JSON.parse(JSON.stringify(win2.CPB.collectState()));
  delete again.savedAt; delete saved.savedAt;
  assert.deepEqual(again, saved);

  // a minimal / older-shaped file fills in defaults instead of breaking
  const win3 = load();
  win3.CPB.applyState({ event:{ businessName:'Old File Co.', guests:20 },
    options:[{ name:'Basic', items:[{ name:'Rice', size:'half', serves:10, pricePerPan:30 }] }] });
  const st3 = win3.CPB.state;
  assert.equal(st3.extras.length, 8);
  assert.equal(st3.options[0].items[0].allergenNone, false);
  assert.ok(win3.CPB.buildText(st3).startsWith('Old File Co.\nBasic option — 20 guests\n\nRice, half pan — serves 10 — $30\n2 pans = $60 · Contains: [fill in]'));
});

test('Checks flag what is missing and never block', () => {
  const win = load();
  const st = win.CPB.blankState();
  const ck = win.CPB.checks(st, win.CPB.buildText(st));
  assert.equal(ck.length, 8);
  const blankBy = t => ck.find(c => c.title.startsWith(t)).ok;
  ['Eligible','Every line','Quantities','A per-person','Service style','Plain text','Sent to'].forEach(t => assert.equal(blankBy(t), false, t));
  const filled = sampleIn(win);
  const ck2 = win.CPB.checks(filled, win.CPB.buildText(filled));
  const by = t => ck2.find(c => c.title.startsWith(t)).ok;
  assert.equal(by('Every line'), true);
  assert.equal(by('Quantities'), true);
  assert.equal(by('A per-person'), true);
  assert.equal(by('Dietary tags'), true);
  assert.equal(by('Service style'), true);
  assert.equal(by('Plain text'), true);
  assert.equal(by('Eligible'), false);   // member has to tick it themselves
  assert.equal(by('Sent to'), false);
  // a too-low override is caught
  filled.options[0].items[2].pansOverride = 1;
  const ck3 = win.CPB.checks(filled, win.CPB.buildText(filled));
  assert.equal(ck3.find(c => c.title.startsWith('Quantities')).ok, false);
});

test('No AFW fee anywhere', () => {
  assert.ok(!/AFW (service )?fee/i.test(HTML.replace(/<!--[\s\S]*?-->/g, '')));
});

test('Cloud bar mounts with the permanent tool key and the same state pair', () => {
  let cfg = null;
  const win = load({ cloud:{ mountToolBar:(sel, c) => { cfg = c; } } });
  assert.ok(cfg, 'mountToolBar was not called');
  assert.equal(cfg.tool, 'catering-proposal');
  sampleIn(win);
  const data = cfg.serialize();
  assert.equal(data.event.businessName, 'Towpath Catering Co.');
  win.CPB.applyState(win.CPB.blankState());
  cfg.deserialize(data);
  assert.equal(win.CPB.state.options.length, 2);
});

test('Special-meal check needs one dish that covers the request', () => {
  const win = load();
  const st = sampleIn(win);
  const veg = win.CPB.dietaryCheck(st).filter(x => x.label === 'Vegetarian');
  assert.equal(veg.length, 2);                          // one per option
  assert.equal(veg[0].ok, true);                        // vegetarian lasagna: 10 servings ≥ 2
  st.event.dietary.vegetarian = 12;                     // no single V dish serves 12? salad does (45)
  assert.equal(win.CPB.dietaryCheck(st)[0].ok, true);
  st.options[0].items.forEach(it => { it.tags = []; });
  assert.equal(win.CPB.dietaryCheck(st)[0].ok, false);
});

test('Reheating and holding line is optional and sits after Setup and supplies', () => {
  const win = load();
  const st = classicOnly(sampleIn(win));
  assert.ok(!win.CPB.buildText(st).includes('Reheating'));
  st.reheating = 'Arrives hot — keep covered until serving';
  assert.ok(win.CPB.buildText(st).includes(
    'Setup and supplies: Serving utensils included\nReheating and holding: Arrives hot — keep covered until serving\nPayment terms:'));
  // files saved before this field existed still load with it blank
  const old = JSON.parse(JSON.stringify(win.CPB.collectState()));
  delete old.reheating;
  const win2 = load();
  win2.CPB.applyState(old);
  assert.equal(win2.CPB.state.reheating, '');
});

test('Diet tags must be declared; the proposal lists every tagged dish', () => {
  const win = load();
  const st = classicOnly(sampleIn(win));
  const tagCheck = () => win.CPB.checks(st, win.CPB.buildText(st)).find(c => c.title.startsWith('Dietary tags'));
  assert.equal(tagCheck().ok, true);                 // sample dishes are declared
  st.options[0].items[2].tagsConfirmed = false;      // garden salad
  assert.equal(tagCheck().ok, false);
  assert.match(tagCheck().detail, /Diet tags not yet declared: Garden salad/);
  // the proposal still lists it (a warning, never a block)
  assert.ok(win.CPB.buildText(st).includes('Gluten-free: Garden salad'));
  // an option with no tagged dishes gets no Dietary options block
  st.options[0].items.forEach(it => { it.tags = []; });
  assert.ok(!win.CPB.buildText(st).includes('Dietary options'));
  // old files: tags without a declaration load as undeclared
  const win2 = load();
  win2.CPB.applyState({ event:{ guests:10 }, options:[{ name:'A', items:[{ name:'Salad', size:'full', serves:10, pricePerPan:40, tags:['GF'] }] }] });
  assert.equal(win2.CPB.state.options[0].items[0].tagsConfirmed, false);
});

test('Changing a tag in the page clears the declaration', () => {
  const win = load();
  sampleIn(win);
  win.document.querySelector('#stepnav [data-val="1"]').click();
  const salad = () => win.CPB.state.options[0].items[2];
  assert.equal(salad().tagsConfirmed, true);
  win.document.querySelector('[data-act="tag"][data-path="options.0.items.2.tags"][data-val="DF"]').click();
  assert.equal(salad().tagsConfirmed, false);
  win.document.querySelector('[data-act="toggle"][data-path="options.0.items.2.tagsConfirmed"]').click();
  assert.equal(salad().tagsConfirmed, true);
});

test('Print layout: headings, bold dish lines, total and terms blocks', () => {
  const win = load();
  const st = sampleIn(win);
  const html = win.CPB.printHtml(st);
  assert.match(html, /^<h1>Towpath Catering Co\.<\/h1><h2>Classic option — 40 guests<\/h2>/);
  assert.ok(html.includes('<div class="p-dish"><b>Beef lasagna, full pan — serves 10 — $75</b><br>3 pans = $225 · Contains: wheat, milk, eggs</div>'));
  assert.ok(html.includes('<p class="p-grand"><b>Total:</b> $526 ($13.15 per guest)</p>'));
  assert.ok(html.includes('<div class="p-terms"><p><b>Service style:</b> Pickup at AFW, Friday by 11:30</p>'));
  assert.equal((html.match(/<h2>/g) || []).length, 2);
  assert.ok(!/<table|<img/.test(html));
});

test('Checks: red for must-fix, softer for reminders', () => {
  const win = load();
  const st = sampleIn(win);
  const lv = () => Object.fromEntries(win.CPB.checks(st, win.CPB.buildText(st)).map(c => [c.title.split(' ')[0].replace(':', ''), c.level]));
  // the finished sample: only the two reminders are left
  let l = lv();
  assert.equal(l.Eligible, 'light');
  assert.equal(l.Sent, 'light');
  assert.equal(Object.values(l).filter(x => x === 'strong').length, 0);
  // delivery charged on a pickup → must fix
  const del = st.extras.find(x => x.id === 'delivery');
  del.status = 'extra'; Object.assign(del.charge, { type:'flat', amount:20 });
  assert.equal(lv().Service, 'strong');
  del.status = '';
  // missing pan price → must fix, and points at that price field
  st.options[0].items[1].pricePerPan = null;
  const c2 = win.CPB.checks(st, win.CPB.buildText(st)).find(c => c.title.startsWith('Every line'));
  assert.equal(c2.level, 'strong');
  assert.equal(c2.issues[0].sel, '[data-bind="options.0.items.1.pricePerPan"]');
  // special meals not covered is only worth a look
  st.options[0].items[1].pricePerPan = 70;
  st.event.dietary.vegan = 50;
  assert.equal(lv().Dietary, 'light');
});

test('Go to… outlines the field in red, and the call-out clears when fixed', () => {
  const win = load();
  sampleIn(win);
  const doc = win.document;
  win.CPB.state.options[0].items[1].pricePerPan = null;
  win.CPB.renderAll();
  assert.equal(doc.querySelectorAll('.needs-fix').length, 0);      // nothing red until asked
  const k = win.CPB.checks(win.CPB.state, win.CPB.buildText(win.CPB.state)).findIndex(c => c.title.startsWith('Every line'));
  doc.querySelector(`[data-act="goFix"][data-val="${k}"]`).click();
  const price = doc.querySelector('[data-bind="options.0.items.1.pricePerPan"]');
  const box = price.closest('.field');
  assert.ok(box.classList.contains('needs-fix'));
  assert.match(box.querySelector('.fix-msg').textContent, /Add a price/);
  assert.equal(doc.getElementById('step2').hidden, false);
  price.value = '70';
  price.dispatchEvent(new win.Event('input', { bubbles:true }));
  assert.ok(!box.classList.contains('needs-fix'));
  assert.equal(box.querySelector('.fix-msg'), null);
});

test('A problem in another package marks its tab', () => {
  const win = load();
  sampleIn(win);
  const doc = win.document;
  win.CPB.state.options[1].items[4].pricePerPan = null;           // Plus brownies
  win.CPB.renderAll();
  const k = win.CPB.checks(win.CPB.state, win.CPB.buildText(win.CPB.state)).findIndex(c => c.title.startsWith('Every line'));
  doc.querySelector(`[data-act="goFix"][data-val="${k}"]`).click();
  assert.ok(doc.querySelector('[data-bind="options.1.items.4.pricePerPan"]').closest('.field').classList.contains('needs-fix'));
  doc.querySelector('.opt-tabs [data-val="0"]').click();          // switch to Classic
  assert.ok(doc.querySelector('.opt-tabs [data-val="1"]').classList.contains('has-fix'));
});

test('Event title is required and leads the email subject', () => {
  const win = load();
  const st = sampleIn(win);
  assert.equal(win.CPB.subjectLine(st), 'Office lunch for 40 — catering proposal from Towpath Catering Co.');
  const doc = win.document;
  assert.match(decodeURIComponent(doc.getElementById('mail_Erica').href), /subject=Office lunch for 40 — catering proposal from Towpath Catering Co\./);
  assert.equal(doc.getElementById('subjectOut').textContent, 'Office lunch for 40 — catering proposal from Towpath Catering Co.');
  // the proposal text itself doesn't change
  assert.ok(!win.CPB.buildText(st).includes('Office lunch'));
  // missing → a must-fix on the "Sent to" check, pointing at the field
  st.event.eventTitle = '';
  const c8 = win.CPB.checks(st, win.CPB.buildText(st)).find(c => c.title.startsWith('Sent to'));
  assert.equal(c8.level, 'strong');
  assert.equal(c8.issues[0].sel, '[data-bind="event.eventTitle"]');
  assert.equal(win.CPB.subjectLine(st), '[Event title] — catering proposal from Towpath Catering Co.');
});

test('Packages: no name needed; auto-numbered when there are several', () => {
  const win = load();
  const st = win.CPB.blankState();
  Object.assign(st.event, { businessName:'Test Co.', guests:20 });
  Object.assign(st.options[0].items[0], { name:'Rice', size:'half', serves:10, pricePerPan:30 });
  assert.ok(win.CPB.buildText(st).startsWith('Test Co.\nMenu — 20 guests\n'));
  // one package: no name box on screen
  win.CPB.applyState(st);
  win.document.querySelector('#stepnav [data-val="1"]').click();
  assert.equal(win.document.querySelector('[data-bind="options.0.name"]'), null);
  // copy it: two unnamed packages print as Option 1 / Option 2; tabs say Package 1 / 2
  win.document.querySelector('[data-act="dupOpt"]').click();
  const t = win.CPB.buildText(win.CPB.state);
  assert.ok(t.includes('Option 1 — 20 guests') && t.includes('Option 2 — 20 guests'), t);
  assert.ok(!/\[Package name\]/.test(t));
  assert.deepEqual([...win.document.querySelectorAll('.opt-tabs .chip')].map(b => b.textContent), ['Package 1', 'Package 2']);
  assert.ok(win.document.querySelector('[data-bind="options.1.name"]'), 'name box shows once there are two');
  // naming is optional, and a name reads as "<name> option"
  win.CPB.state.options[1].name = 'Plus';
  assert.ok(win.CPB.buildText(win.CPB.state).includes('Plus option — 20 guests'));
  const c2 = win.CPB.checks(win.CPB.state, win.CPB.buildText(win.CPB.state)).find(c => c.title.startsWith('Every line'));
  assert.equal(c2.level, 'ok');
});

test('Kitchen time: daytime rates, 2-hour minimum, never in the proposal', () => {
  const win = load();
  const st = sampleIn(win);
  const text = win.CPB.buildText(st);
  st.kitchen = { hours:4, space:'elevate', customRate:null };
  let k = win.CPB.kitchenCalc(st);
  assert.equal(k.rate, 1925);
  assert.equal(k.cost, 7700);                       // 4 × $19.25
  st.kitchen = { hours:1, space:'create_full', customRate:null };
  k = win.CPB.kitchenCalc(st);
  assert.equal(k.billed, 2);                        // 2-hour minimum
  assert.equal(k.minApplied, true);
  assert.equal(k.cost, 5000);
  st.kitchen = { hours:3, space:'custom', customRate:22.5 };
  assert.equal(win.CPB.kitchenCalc(st).cost, 6750);
  st.kitchen = { hours:3, space:'', customRate:null };
  assert.equal(win.CPB.kitchenCalc(st).cost, null);
  assert.equal(win.CPB.buildText(st), text);        // member's cost only
  // on screen: what's left per package
  st.kitchen = { hours:4, space:'elevate', customRate:null };
  win.CPB.applyState(JSON.parse(JSON.stringify(st)));
  const out = win.document.getElementById('kitchenOut').textContent.replace(/\s+/g, ' ');
  assert.match(out, /4 hrs × \$19\.25\/hr = \$77\.00/);
  assert.match(out, /Classic: \$526 − \$77\.00 kitchen = \$449\.00 left/);
  assert.match(out, /Plus: \$626 − \$77\.00 kitchen = \$549\.00 left/);
  // saved and reloaded
  assert.deepEqual(JSON.parse(JSON.stringify(win.CPB.collectState().kitchen)), { hours:4, space:'elevate', customRate:null });
});
