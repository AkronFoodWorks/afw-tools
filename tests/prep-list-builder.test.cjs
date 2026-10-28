/* Smoke test for afw-prep-list-builder.html
 *
 * Needs jsdom, which this repo doesn't install. From any scratch folder:
 *   npm i jsdom
 *   NODE_PATH=$PWD/node_modules node --test /path/to/afw-tools/tests/
 *
 * Loads the page the way a browser would (without afw-config.js /
 * afw-cloud.js, so it also proves the tool works with cloud save absent),
 * then checks the batch math the whole tool rests on: the free-text amount
 * parser, scaling against a recipe yield, the pull-list combine, and the
 * committed-orders-only rule the Roadmap depends on.
 *
 * window.PLB is the page's test surface — state plus the pure functions.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const FILE = path.join(__dirname, '..', 'afw-prep-list-builder.html');
const HTML = fs.readFileSync(FILE, 'utf8');

function load(){
  const dom = new JSDOM(HTML, {
    runScripts: 'dangerously',
    url: 'http://localhost:8000/afw-prep-list-builder.html',
    beforeParse(win){
      win.scrollTo = () => {};
      win.confirm = () => true;
    }
  });
  return dom.window;
}

/* ---------- amount parser ---------- */

test('parseAmount reads whole, decimal, fraction and mixed numbers', () => {
  const w = load();
  assert.equal(w.PLB.parseAmount('2').value, 2);
  assert.equal(w.PLB.parseAmount('2.5').value, 2.5);
  assert.equal(w.PLB.parseAmount('1/2').value, 0.5);
  assert.equal(w.PLB.parseAmount('2 1/2').value, 2.5);
});

test('parseAmount keeps the words trailing a number', () => {
  const w = load();
  /* SOP yields are free text: "24 pieces", "3 gallons".
     Compared field by field — objects from the jsdom realm don't
     satisfy deepStrictEqual against ones built out here. */
  const pieces = w.PLB.parseAmount('24 pieces');
  assert.equal(pieces.value, 24);
  assert.equal(pieces.suffix, 'pieces');
  const mixed = w.PLB.parseAmount('2 1/2 lb');
  assert.equal(mixed.value, 2.5);
  assert.equal(mixed.suffix, 'lb');
});

test('parseAmount refuses what it cannot scale rather than guessing', () => {
  const w = load();
  assert.equal(w.PLB.parseAmount('a pinch'), null);
  assert.equal(w.PLB.parseAmount('to taste'), null);
  assert.equal(w.PLB.parseAmount(''), null);
  assert.equal(w.PLB.parseAmount(null), null);
  assert.equal(w.PLB.parseAmount('1/0'), null);   // no Infinity into the math
});

test('fmtAmount shows kitchen fractions, not decimals', () => {
  const w = load();
  assert.equal(w.PLB.fmtAmount(9), '9');
  assert.equal(w.PLB.fmtAmount(4.5), '4 1/2');
  assert.equal(w.PLB.fmtAmount(0.75), '3/4');
  assert.equal(w.PLB.fmtAmount(0.375), '3/8');
});

/* ---------- scaling ---------- */

let dishNo = 0;
function itemWith(w, qty, yieldQty, ings){
  const it = w.PLB.blankItem();
  it.name = 'Test dish ' + (++dishNo);   /* distinct, so the pull list's "for" list is real */
  it.qty = qty;
  it.yieldQty = yieldQty;
  it.ings = ings.map(g => w.PLB.blankIng(g[0], g[1], g[2]));
  return it;
}

test('batchesFor divides what you need by what one batch makes', () => {
  const w = load();
  assert.equal(w.PLB.batchesFor(itemWith(w, 36, 12, [])), 3);
  assert.equal(w.PLB.batchesFor(itemWith(w, 3, 12, [])), 0.25);
  /* missing either half means no multiplier — not a divide by zero */
  assert.equal(w.PLB.batchesFor(itemWith(w, 36, null, [])), null);
  assert.equal(w.PLB.batchesFor(itemWith(w, null, 12, [])), null);
  assert.equal(w.PLB.batchesFor(itemWith(w, 36, 0, [])), null);
});

test('scaledIngredients multiplies every amount by the batch count', () => {
  const w = load();
  const rows = w.PLB.scaledIngredients(itemWith(w, 36, 12, [
    ['Chicken thigh', 3, 'lb'],
    ['Rice', 4, 'cup'],
    ['Tomato paste', 1.5, 'cup']
  ]));
  assert.deepEqual(rows.map(r => `${r.name} ${r.needText} ${r.unit}`), [
    'Chicken thigh 9 lb',
    'Rice 12 cup',
    'Tomato paste 4 1/2 cup'
  ]);
});

test('an amount that will not parse travels through verbatim', () => {
  const w = load();
  const rows = w.PLB.scaledIngredients(itemWith(w, 48, 24, [
    ['Flour', '2 1/2', 'lb'],
    ['Yeast', 'a pinch', '']
  ]));
  assert.equal(rows[0].needText, '5');        // scaled
  assert.equal(rows[0].verbatim, false);
  assert.equal(rows[1].needText, 'a pinch');  // untouched, and flagged
  assert.equal(rows[1].verbatim, true);
});

test('a unit typed into the amount box is still a unit', () => {
  const w = load();
  const rows = w.PLB.scaledIngredients(itemWith(w, 24, 12, [['Butter', '8 oz', '']]));
  assert.equal(rows[0].needText, '16');
  assert.equal(rows[0].unit, 'oz');
});

/* ---------- prep actions ---------- */

test('splitPrep peels a real action off the ingredient name', () => {
  const w = load();
  const garlic = w.PLB.splitPrep('Garlic, minced');
  assert.equal(garlic.name, 'Garlic');
  assert.equal(garlic.prep, 'minced');
  const onion = w.PLB.splitPrep('Yellow onion, small dice');
  assert.equal(onion.name, 'Yellow onion');
  assert.equal(onion.prep, 'small dice');
  const parsley = w.PLB.splitPrep('Parsley, finely chopped');
  assert.equal(parsley.prep, 'finely chopped');
});

test('splitPrep leaves a description that is not an action alone', () => {
  const w = load();
  /* a trailing clause that names a kind, not a knife cut, stays in the name */
  assert.equal(w.PLB.splitPrep('Chicken thigh, boneless').name, 'Chicken thigh, boneless');
  assert.equal(w.PLB.splitPrep('Chicken thigh, boneless').prep, '');
  assert.equal(w.PLB.splitPrep('Olive oil').prep, '');
  assert.equal(w.PLB.splitPrep('').name, '');
});

test('a prep action survives scaling untouched', () => {
  const w = load();
  const it = itemWith(w, 36, 12, [['Garlic', 2, 'tbsp']]);
  it.ings[0].prep = 'minced';
  const row = w.PLB.scaledIngredients(it)[0];
  assert.equal(row.needText, '6');      // six times the garlic...
  assert.equal(row.prep, 'minced');     // ...is still minced
});

test('buildActionList gathers the same action across different items', () => {
  const w = load();
  const a = itemWith(w, 12, 12, [['Garlic', 2, 'tbsp'], ['Carrot', 1, 'lb']]);
  a.ings[0].prep = 'minced';
  a.ings[1].prep = 'small dice';
  const b = itemWith(w, 24, 12, [['Garlic', 2, 'tbsp']]);
  b.ings[0].prep = 'minced';
  w.PLB.items = [a, b];

  const groups = w.PLB.buildActionList();
  assert.equal(groups.length, 2, 'one group per distinct action');
  const minced = groups.find(g => g.action === 'minced');
  assert.equal(minced.rows.length, 1, 'the same ingredient combines inside the group');
  assert.equal(minced.rows[0].total, 6, '2 tbsp ×1 batch + 2 tbsp ×2 batches');
  assert.equal(minced.rows[0].from.length, 2, 'and names both dishes it is for');
});

test('ingredients with no action stay off the action list', () => {
  const w = load();
  const it = itemWith(w, 12, 12, [['Garlic', 2, 'tbsp'], ['Olive oil', 1, 'cup']]);
  it.ings[0].prep = 'minced';
  w.PLB.items = [it];
  const groups = w.PLB.buildActionList();
  assert.equal(groups.length, 1);
  assert.equal(groups[0].rows.length, 1);
});

test('the pull list combines across actions — you pull the garlic once', () => {
  const w = load();
  const a = itemWith(w, 12, 12, [['Garlic', 2, 'tbsp']]);
  a.ings[0].prep = 'minced';
  const b = itemWith(w, 12, 12, [['Garlic', 1, 'tbsp']]);
  b.ings[0].prep = 'sliced';
  w.PLB.items = [a, b];

  const garlic = w.PLB.buildPullList().filter(r => r.name === 'Garlic');
  assert.equal(garlic.length, 1, 'one shopping line, not one per cut');
  assert.equal(garlic[0].total, 3);
  assert.deepEqual([...garlic[0].preps].sort(), ['minced', 'sliced'], 'but it still names both cuts');
});

test('an action typed into an imported name becomes a real action', () => {
  const w = load();
  const recipe = w.PLB.costCardToRecipe({
    productName: 'Jollof chicken', yieldQty: 12,
    ingredients: [
      { name: 'Garlic, minced', uqty: 2, uunit: 'tbsp' },
      { name: 'Chicken thigh, boneless', uqty: 3, uunit: 'lb' }
    ]
  });
  assert.equal(recipe.ings[0].name, 'Garlic');
  assert.equal(recipe.ings[0].prep, 'minced');
  assert.equal(recipe.ings[1].name, 'Chicken thigh, boneless');
  assert.equal(recipe.ings[1].prep, '');
});

test('prep survives an export and reimport', () => {
  const w = load();
  const it = itemWith(w, 36, 12, [['Garlic', 2, 'tbsp']]);
  it.ings[0].prep = 'minced';
  w.PLB.items = [it];
  w.PLB.applyState(JSON.parse(JSON.stringify(w.PLB.collectState())));
  assert.equal(w.PLB.items[0].ings[0].prep, 'minced');
  assert.equal(w.PLB.buildActionList()[0].action, 'minced');
});

/* ---------- pull list ---------- */

test('buildPullList adds up the same ingredient across items', () => {
  const w = load();
  w.PLB.items = [
    itemWith(w, 24, 12, [['Flour', 2, 'lb'], ['Sugar', 1, 'cup']]),
    itemWith(w, 36, 12, [['Flour', 1, 'lb']])
  ];
  const pull = w.PLB.buildPullList();
  const flour = pull.find(r => r.name === 'Flour');
  assert.equal(flour.total, 7);               // 2×2 + 1×3
  assert.equal(flour.from.length, 2);         // and says which items it's for
});

test('pull list matches units loosely but never converts between them', () => {
  const w = load();
  w.PLB.items = [
    itemWith(w, 12, 12, [['Flour', 2, 'lbs']]),
    itemWith(w, 12, 12, [['flour', 3, 'lb']]),   // same thing, spelled two ways
    itemWith(w, 12, 12, [['Flour', 4, 'cup']])   // genuinely different measure
  ];
  const flour = w.PLB.buildPullList().filter(r => r.name.toLowerCase() === 'flour');
  assert.equal(flour.length, 2, 'lb and cup stay on separate lines');
  assert.equal(flour.find(r => r.unit === 'lbs').total, 5);
  assert.equal(flour.find(r => r.unit === 'cup').total, 4);
});

test('packaging stays its own group on the pull list', () => {
  const w = load();
  const it = itemWith(w, 24, 12, [['Rice', 2, 'lb'], ['Clamshell', 12, 'ea']]);
  it.ings[1].group = 'packaging';
  w.PLB.items = [it];
  const pull = w.PLB.buildPullList();
  assert.equal(pull.find(r => r.name === 'Clamshell').group, 'packaging');
  assert.equal(pull.find(r => r.name === 'Rice').group, 'ingredient');
});

/* ---------- imports ---------- */

test('order import counts committed orders and leaves maybes out', () => {
  const w = load();
  w.PLB.items = [];
  w.PLB.importOrders({
    _tool: 'pre-sell-order-form',
    settings: { offerName: 'Jollof chicken', pickupDay: 'Friday 4–6 PM' },
    orders: [
      { paid: 'full',    items: [{ name: 'Jollof chicken', qty: 2 }] },
      { paid: 'deposit', items: [{ name: 'jollof chicken', qty: 1 }] },  // same item, different case
      { paid: 'unpaid',  items: [{ name: 'Jollof chicken', qty: 5 }] }   // a "maybe" is not an order
    ]
  });
  assert.equal(w.PLB.items.length, 1);
  assert.equal(w.PLB.items[0].qty, 3);
  assert.equal(w.PLB.items[0].ordered, 3);
  assert.equal(w.document.getElementById('pickupDay').value, 'Friday 4–6 PM');
});

test('order import falls back to every order when none are marked paid yet', () => {
  const w = load();
  w.PLB.items = [];
  w.PLB.importOrders({
    _tool: 'pre-sell-order-form',
    orders: [
      { paid: 'unpaid', items: [{ name: 'Puff puff', qty: 3 }] },
      { paid: 'unpaid', items: [{ name: 'Puff puff', qty: 2 }] }
    ]
  });
  assert.equal(w.PLB.items[0].qty, 5);
});

test('detectImport tells our four file shapes apart', () => {
  const w = load();
  assert.equal(w.PLB.detectImport({ _tool: 'pre-sell-order-form', orders: [] }), 'orders');
  assert.equal(w.PLB.detectImport({ schema: 'afw-sop-v1' }), 'sop');
  assert.equal(w.PLB.detectImport({ schema: 'afw-binder-v1', items: [] }), 'binder');
  assert.equal(w.PLB.detectImport({ fileVersion: 2, productName: 'X', ingredients: [] }), 'cost-card');
  assert.equal(w.PLB.detectImport({ schema: 'afw-prep-list-v1' }), 'prep-list');
  assert.equal(w.PLB.detectImport({ hello: 'world' }), null);
  assert.equal(w.PLB.detectImport(null), null);
});

test('a cost card scales by units per batch, packaging included', () => {
  const w = load();
  const recipe = w.PLB.costCardToRecipe({
    productName: 'Jollof chicken', yieldQty: 12, yieldUnit: 'servings',
    ingredients: [{ name: 'Chicken thigh', uqty: 3, uunit: 'lb' }],
    packaging:   [{ name: 'Clamshell', used: 12 }]
  });
  assert.equal(recipe.yieldQty, 12);
  assert.equal(recipe.ings.length, 2);
  assert.equal(recipe.ings[1].group, 'packaging');
});

test('an SOP yield of "24 pieces" is a number and a unit', () => {
  const w = load();
  const recipe = w.PLB.sopToRecipe({
    schema: 'afw-sop-v1', type: 'production', name: 'Puff puff', yield: '24 pieces',
    ingredients: [{ name: 'Flour', amount: '2 1/2', unit: 'lb' }]
  });
  assert.equal(recipe.yieldQty, 24);
  assert.equal(recipe.yieldUnit, 'pieces');
});

test('a yield with no number in it still loads, just without scaling', () => {
  const w = load();
  const recipe = w.PLB.sopToRecipe({ yield: 'one sheet pan', ingredients: [] });
  assert.equal(recipe.yieldQty, null);
  assert.equal(recipe.yieldUnit, 'one sheet pan');
});

/* ---------- saved files ---------- */

test('a hand-edited file lands well-typed instead of breaking the page', () => {
  const w = load();
  w.PLB.applyState({
    schema: 'afw-prep-list-v1',
    session: { sessionName: 'Edited by hand' },
    items: [{
      id: 'i9', name: 'Jollof', qty: '24', minutes: '90', yieldQty: 12,
      stage: 'bogus', done: 'yes',
      ings: [{ id: 'g9', name: 'Rice', amount: 4, unit: 'cup' }]
    }]
  });
  const it = w.PLB.items[0];
  assert.equal(it.qty, 24, 'numbers arrive as numbers');
  assert.equal(it.stage, 'prep', 'an unknown stage falls back');
  assert.equal(it.done, true);
  assert.equal(it.ings[0].amount, '4', 'amounts arrive as text the parser can read');
  assert.equal(w.PLB.scaledIngredients(it)[0].needText, '8');
});

test('ids from a saved file never collide with ones minted after it', () => {
  const w = load();
  /* a file whose owner deleted rows before exporting carries high ids */
  w.PLB.applyState({ items: [{ id: 'i9', ings: [{ id: 'g9' }] }] });
  w.PLB.addItem();
  w.PLB.items[0].ings.push(w.PLB.blankIng());
  const ids = w.PLB.items.map(i => i.id).concat(...w.PLB.items.map(i => i.ings.map(g => g.id)));
  assert.equal(new Set(ids).size, ids.length, 'every id is unique');
});

test('export and reimport comes back the same', () => {
  const w = load();
  w.PLB.items = [itemWith(w, 36, 12, [['Chicken thigh', 3, 'lb']])];
  w.document.getElementById('hoursBooked').value = '4';
  const saved = JSON.parse(JSON.stringify(w.PLB.collectState()));
  w.PLB.applyState(saved);
  assert.equal(w.PLB.items.length, 1);
  assert.equal(w.PLB.items[0].qty, 36);
  assert.equal(w.PLB.scaledIngredients(w.PLB.items[0])[0].needText, '9');
  assert.equal(w.document.getElementById('hoursBooked').value, '4');
});

/* ---------- time check ---------- */

test('estimated time sums the items plus setup and cleanup', () => {
  const w = load();
  w.PLB.items = [itemWith(w, 12, 12, []), itemWith(w, 12, 12, [])];
  w.PLB.items[0].minutes = 120;
  w.PLB.items[1].minutes = 60;
  w.document.getElementById('setupMin').value = '30';
  assert.equal(w.PLB.totalMinutes(), 210);
  assert.equal(w.PLB.fmtMinutes(210), '3h 30m');
});

test('a list longer than the booked session says so', () => {
  const w = load();
  w.PLB.items = [itemWith(w, 12, 12, [])];
  w.PLB.items[0].minutes = 300;
  w.document.getElementById('hoursBooked').value = '4';
  w.document.getElementById('setupMin').value = '30';
  w.PLB.renderSummary();
  const readout = w.document.getElementById('timeReadout');
  assert.ok(readout.className.includes('is-over'), 'the over-booked state shows');
  assert.match(w.document.getElementById('timeSub').textContent, /over by 1h 30m/);
});

test('the page works with cloud save absent', () => {
  const w = load();   // loaded without afw-config.js / afw-cloud.js
  assert.equal(typeof w.AFWCloud, 'undefined');
  assert.equal(w.document.getElementById('afw-toolbar').innerHTML, '');
  w.PLB.addItem();        // and the tool itself still runs
  assert.ok(w.document.querySelectorAll('.item-card').length > 0);
});
