/* orders.js — the shop floor's own record: what was ordered, in what
 * dimensions and finish, and how far it has got.
 *
 * A quotation says what was promised; this says what is actually
 * being made. The two share one number — the MR (Manufacturing
 * Record) number a quotation is accepted under — but a production
 * line item outlives the quotation that started it, and an order
 * that predates Kontour's own history has no quotation behind it at
 * all. So this is its own store, grouped by MR number the same way
 * quotations group by revision, rather than a field bolted onto the
 * quote.
 *
 * One line item per physical piece — a sofa, a mirror, a railing —
 * because that is the unit that actually moves through drawings,
 * production, and shipping at its own pace even when three other
 * pieces under the same MR number are already delivered.
 */

import { uid as makeId } from './store.js';
import { todayISO } from './format.js';

const KEY = 'kontour.orders.v1';

/* The six stages a piece moves through, in order. "Pending" is the
   zeroth stage — ordered, nothing done yet — and is never shown as a
   button of its own; it is just what a line item starts at. */
export const STAGES = [
  { key: 'drawings', label: 'Drawings' },
  { key: 'commission', label: 'Commission' },
  { key: 'production', label: 'Production' },
  { key: 'assembly', label: 'Assembly' },
  { key: 'shipped', label: 'Shipped' },
  { key: 'delivered', label: 'Delivered' },
];
const STAGE_KEYS = STAGES.map((s) => s.key);

function blank() { return { orders: [], orgId: '' }; }

let state = blank();
const listeners = new Set();
function emit() { listeners.forEach((fn) => fn()); }
export function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

function read() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return blank();
    const s = JSON.parse(raw);
    return {
      orders: Array.isArray(s.orders) ? s.orders : [],
      orgId: typeof s.orgId === 'string' ? s.orgId : '',
    };
  } catch (e) {
    console.error('[kontour] could not read orders', e);
    return blank();
  }
}

function write() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); }
  catch (e) { console.error('[kontour] could not save orders', e); }
}

export function load() { state = read(); return state; }

/* ── Line items ────────────────────────────────────────────────── */

export function lines() {
  return state.orders.filter((o) => !o.deletedAt);
}

export function getLine(id) {
  return state.orders.find((o) => o.id === id && !o.deletedAt) || null;
}

export function linesByMr(mrNo) {
  return lines().filter((o) => o.mrNo === mrNo);
}

export function addLine(input = {}) {
  const line = {
    // Callers normally let the id be made here. The seed passes its
    // own, derived from the piece itself, so two devices seeding the
    // same history land on the same row rather than two copies of it.
    id: input.id || makeId('ord'),
    mrNo: String(input.mrNo || '').trim().toUpperCase(),
    client: input.client || '',
    orderReceived: input.orderReceived || todayISO(),
    deliveryDate: input.deliveryDate || '',
    name: input.name || '',
    specs: input.specs || '',
    dims: input.dims || '',
    qty: Number(input.qty) || 1,
    image: input.image || '',
    upholstery: input.upholstery || null,   // { name, length }
    metal: input.metal || null,             // { type, finish }
    wood: input.wood || null,               // { type, finish }
    others: input.others || null,           // { type, finish }
    stage: STAGE_KEYS.includes(input.stage) ? input.stage : 'pending',
    vendors: input.vendors || {},           // { drawings, metal, wood, upholstery, marble, hardware, package }
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  state.orders.push(line);
  write(); emit();
  return line;
}

export function updateLine(id, changes) {
  const i = state.orders.findIndex((o) => o.id === id);
  if (i === -1) return null;
  state.orders[i] = { ...state.orders[i], ...changes, updatedAt: Date.now() };
  write(); emit();
  return state.orders[i];
}

export function deleteLine(id) {
  const i = state.orders.findIndex((o) => o.id === id);
  if (i === -1) return;
  state.orders[i] = { ...state.orders[i], deletedAt: Date.now() };
  write(); emit();
}

/* ── Grouping by MR number ─────────────────────────────────────── */

export function orderGroups({ q = '' } = {}) {
  const needle = q.trim().toLowerCase();
  const byMr = new Map();
  for (const l of lines()) {
    if (!byMr.has(l.mrNo)) byMr.set(l.mrNo, []);
    byMr.get(l.mrNo).push(l);
  }
  const out = [];
  for (const [mrNo, group] of byMr) {
    const head = group[0];
    if (needle && !(
      mrNo.toLowerCase().includes(needle)
      || (head.client || '').toLowerCase().includes(needle)
      || group.some((l) => (l.name || '').toLowerCase().includes(needle))
    )) continue;
    out.push({
      mrNo,
      client: head.client,
      orderReceived: head.orderReceived,
      deliveryDate: group.reduce((max, l) => (l.deliveryDate > max ? l.deliveryDate : max), head.deliveryDate || ''),
      lines: group.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0)),
      stage: overallStage(group),
    });
  }
  return out.sort((a, b) => (b.deliveryDate || '').localeCompare(a.deliveryDate || ''));
}

/* A group is only as far along as its least-finished piece — the
   client does not care that four of five pieces shipped if the fifth
   is still on the drawing board. */
export function overallStage(group) {
  let min = STAGE_KEYS.length;
  for (const l of group) {
    const idx = STAGE_KEYS.indexOf(l.stage);
    const at = idx === -1 ? -1 : idx;
    if (at < min) min = at;
  }
  return min === -1 ? 'pending' : (min === STAGE_KEYS.length ? 'delivered' : STAGE_KEYS[min]);
}

export function stageLabel(key) {
  if (key === 'pending') return 'Pending';
  const s = STAGES.find((x) => x.key === key);
  return s ? s.label : key;
}

export function isOverdue(group) {
  if (group.stage === 'delivered') return false;
  return Boolean(group.deliveryDate) && group.deliveryDate < todayISO();
}

/* ── The stations on the line ──────────────────────────────────
   Which screen a piece shows up on is decided by one thing — how
   far along it is — so the mapping lives here rather than being
   re-derived, differently, on five different screens. A piece is
   only ever at one station, and every stage belongs to exactly
   one, so nothing can fall between them or appear on two. */

export const STATION = {
  inproduction: ['pending', 'drawings', 'commission', 'production'],
  qc:           ['assembly'],
  shipping:     ['shipped'],
  archive:      ['delivered'],
};

export const STATION_LABEL = {
  inproduction: 'In production',
  qc: 'QC',
  shipping: 'Shipping',
  archive: 'Archive',
};

export function stationOf(stage) {
  for (const [name, stages] of Object.entries(STATION)) {
    if (stages.includes(stage)) return name;
  }
  return 'inproduction';
}

/** Every MR group standing at one station, newest delivery first. */
export function groupsAt(station, { q = '' } = {}) {
  const stages = STATION[station] || [];
  return orderGroups({ q }).filter((g) => stages.includes(g.stage));
}

/** Every individual piece at one station — the pieces themselves,
    not their orders, for the screens that work at that grain. */
export function linesAt(station) {
  const stages = STATION[station] || [];
  return lines().filter((l) => stages.includes(l.stage));
}

/* ── The sub-contractor book ───────────────────────────────────
   Nobody types a supplier list: it is read back out of the work
   itself, the same way the client book is read out of past
   quotations. Whoever is named against a piece is a
   sub-contractor, and the trades they are named for are the
   trades they do. */

const TRADES = ['drawings', 'metal', 'wood', 'upholstery', 'marble', 'hardware', 'package'];

export function vendorBook() {
  const book = new Map();
  for (const l of lines()) {
    for (const trade of TRADES) {
      const name = (l.vendors && l.vendors[trade] || '').trim();
      if (!name || name.toUpperCase() === 'NA') continue;
      if (!book.has(name)) book.set(name, { name, trades: new Set(), lines: [] });
      const v = book.get(name);
      v.trades.add(trade);
      if (!v.lines.includes(l)) v.lines.push(l);
    }
  }
  return [...book.values()]
    .map((v) => ({
      ...v,
      trades: [...v.trades],
      open: v.lines.filter((l) => l.stage !== 'delivered').length,
    }))
    .sort((a, b) => b.open - a.open || a.name.localeCompare(b.name));
}

export function vendorNamed(name) {
  return vendorBook().find((v) => v.name === name) || null;
}

/* ── Dashboard / topbar figures ───────────────────────────────── */

/** How many orders are standing at each station right now. */
export function stationCounts() {
  const groups = orderGroups({});
  const out = { inproduction: 0, qc: 0, shipping: 0, archive: 0, overdue: 0 };
  for (const g of groups) {
    out[stationOf(g.stage)] += 1;
    if (isOverdue(g)) out.overdue += 1;
  }
  return out;
}

export function orderStats() {
  const groups = orderGroups({});
  const open = groups.filter((g) => g.stage !== 'delivered').length;
  const overdue = groups.filter(isOverdue).length;
  const thisMonth = todayISO().slice(0, 7);
  const deliveredThisMonth = groups.filter((g) => g.stage === 'delivered'
    && (g.deliveryDate || '').slice(0, 7) === thisMonth).length;
  return { open, overdue, deliveredThisMonth };
}

/* ── One-time import from the Banavat India order sheet ────────── */

function row(mrNo, orderReceived, deliveryDate, client, name, specs, dims, qty, extra = {}) {
  return {
    mrNo, orderReceived, deliveryDate, client, name, specs, dims,
    qty: Number(qty) || 1,
    upholstery: extra.upholstery || null,
    metal: extra.metal || null,
    wood: extra.wood || null,
    others: extra.others || null,
    stage: extra.stage || 'pending',
    vendors: extra.vendors || {},
  };
}

const SEED = [
  // ── C-series: still on the books, nothing marked complete yet ──
  row('C119', '2026-06-24', '2026-07-24', 'Rahi Construction', 'Exterior metal fascade',
    'Material: Mildsteel. Metal structure (unfinished): 25 x 25mm square pipe section (1.5mm), 3mm MS CNC laser cut jali and design, designer end knob as per design, MS stud between pipe and metal sheet. Services included: installation, carting.',
    '3546 x 25 x 6478 mm (139 x 1 x 255")', 1),
  row('C119', '2026-06-24', '2026-07-24', 'Rahi Construction', 'Door lintel wall design',
    'Material: Mildsteel. Metal structure (unfinished): 25 x 25mm square pipe section (1.5mm), 3mm MS CNC laser cut jali and design, designer end knob as per design, MS stud between pipe and metal sheet. Services included: installation, carting.',
    '3625 x 150 x 250mm (142.5 x 6 x 10")', 1),

  row('C125', '2026-06-22', '2026-08-17', 'Rahi Construction', 'Jayanti bhai bunglow - Automatic door',
    'MS sliding gate, border 122 x 61 x 3mm. Vertical/horizontal support 60 x 40 x 2mm. 50 x 50 x 5mm MS guide, 120mm dia bottom wheel, 50mm guide roller. Bottom track 100 x 50 ISMB on top 25mm round bar. Gate holding post 100 x 100mm. Motor: CAME sliding gate automation (Italy) with remote, photo cell, push button. Aluminium door fascade, powder coat (1.6mm).',
    '29 x 6 ft', 1),
  row('C125', '2026-06-22', '2026-08-17', 'Rahi Construction', 'Jayanti bhai bunglow - Wicket door auto close mechanism',
    'Wicket gate, border 122 x 61 x 3mm. Aluminium door fascade, powder coat (1.6mm).', '4ft width x 6ft ht', 2),
  row('C125', '2026-06-22', '2026-08-17', 'Rahi Construction', 'Darshan bhai bunglow - Automatic door',
    'MS sliding gate, border 122 x 61 x 3mm. Vertical/horizontal support 60 x 40 x 2mm. 50 x 50 x 5mm MS guide, 120mm dia bottom wheel, 50mm guide roller. Bottom track 100 x 50 ISMB on top 25mm round bar. Motor: CAME sliding gate automation (Italy) with remote, photo cell, push button. Aluminium door fascade, powder coat (1.6mm).',
    '22 x 6 ft', 1),
  row('C125', '2026-06-22', '2026-08-17', 'Rahi Construction', 'Darshan bhai bunglow - Wicket door auto close mechanism',
    'Wicket gate, border 122 x 61 x 3mm. Aluminium door fascade, powder coat (1.6mm).', '5ft width x 6ft ht', 1),

  row('C126', '2026-08-10', '2026-08-22', 'Jayanti - Shade', 'Compound wall shade - Metal fabrication',
    'Material: MS 4x4", 2x2", 2x1", 1x1". Finish: red oxide washed. Installation included.', 'As per site measurements', 1),
  row('C126', '2026-08-10', '2026-08-22', 'Jayanti - Shade', 'Compound wall shade - Puff panel',
    '30mm thick puff panel. Installation included. Carting included.', 'As per site measurements', 1),

  row('C131', '2026-08-22', '2026-09-10', 'Shapemaker', 'Mirror 1',
    'MS pipe structure in black powder coat finish and mirror.', '38 x 1 x 58"', 1),
  row('C131', '2026-08-22', '2026-09-10', 'Shapemaker', 'Mirror 2',
    'SS pipe structure in PVD coating finish and mirror.', '25 x 1 x 68"', 1),

  row('C134', '2026-08-22', '2026-09-10', 'Shapemaker', 'Sofa - Fabric change',
    'Fabric, foaming, carting and installation. Fabric not included.', 'As per measurements', 1),

  row('C132', '2026-08-27', '2026-09-18', 'Jayanti Kaka', 'Compound wall - Grill',
    'MS bright bar and MS patti. Outside patti 40 x 8mm, inside rod 16mm round section. Gap 3" bottom, 1" around. Finish: red oxide. Weight: 320kg.',
    'As per site measurements', 1),

  row('C130', '2026-08-17', '2026-09-08', 'Shamnu Flat', 'Staircase railing',
    '16mm MS pipe unfinished with installation. Includes 2 railings — ground and first floor.', 'As per dimensions', 1),
  row('C130', '2026-08-17', '2026-09-08', 'Shamnu Flat', 'Bathroom support pipe', 'SS pipe.', '3 feet long', 1),
  row('C130', '2026-08-17', '2026-09-08', 'Shamnu Flat', 'Cloth hanger pipes',
    'SS pipes and hanger holders — kitchen, bedrooms. 5 pieces.', 'As per dimensions', 1),

  row('C129-1', '2026-09-05', '2026-09-19', 'Niraj Chandrani', 'Book Shelf - Living room',
    'MS steel frame with HDHMR', '40 x 12 x 58"', 1),
  row('C129-1', '2026-09-05', '2026-09-19', 'Niraj Chandrani', 'Shelf - Bar unit',
    'MS steel frame with HDHMR', '31 x 12 x 48"', 1),
  row('C129-1', '2026-09-05', '2026-09-19', 'Niraj Chandrani', 'Bench',
    'Metal structure and MS plate in powder coating', '96 x 18 x 18"', 1),
  row('C129-1', '2026-09-05', '2026-09-19', 'Niraj Chandrani', 'Study table - Bedroom',
    'MS structure and HDHMR and metal legs', '48 x 20 x 1"', 1),
  row('C129-1', '2026-09-05', '2026-09-19', 'Niraj Chandrani', 'Shelf above study table',
    'MS structure and HDHMR', '32 x 9 x 1"', 1),
  row('C129-1', '2026-09-05', '2026-09-19', 'Niraj Chandrani', 'Shelf - Master bedroom',
    'MS sheet metal', 'As per dimensions', 3),
  row('C129-1', '2026-09-05', '2026-09-19', 'Niraj Chandrani', 'Mirror - Parents room',
    'MS structure and mirror.', 'As per dimensions', 1),

  row('C137-1', '2026-09-05', '2026-09-19', 'Shivalin', 'Mannequin jaali',
    '4mm MS jaali, 2 x 1" MS rectangle pipe frame structure. Finish: raw.', 'As per dimensions', 1),
  row('C137-1', '2026-09-05', '2026-09-19', 'Shivalin', 'Staircase railing',
    'Top patti 40 x 4mm, standing post x10, cable rows x7 (3mm SS rope). Finish: raw. Installation included.',
    'As per dimensions', 1),

  row('C107', '2026-05-22', '2026-05-30', 'Pranav Doshi', 'Nightstand metal leg frame', 'Mildsteel metal frame',
    'As per dimensions', 2, { metal: { type: 'Mildsteel', finish: 'Raw' }, stage: 'delivered',
      vendors: { metal: 'Dinesh bhai' } }),

  row('C109', '2026-05-20', '2026-06-03', 'Fiscal Ox', 'Custom metal signboard', 'MS plate 3mm', 'As per dimensions', 1),

  row('C108', '2026-05-20', '2026-06-03', 'Siddharth Saraiya', 'Basin metal structure and SS legs',
    'Mildsteel metal frame and SS leg', 'As per dimensions', 1,
    { metal: { type: 'Mildsteel', finish: '' }, stage: 'assembly', vendors: { metal: 'Dinesh bhai' } }),

  row('C104', '2026-06-15', '2026-06-17', 'Pranav Doshi', 'Sofa Cum Bed - Custom (upholstery only, fabric not included)',
    'Fabric upholstery', '96 x 46 x 30"', 1),
  row('C117', '2026-06-15', '2026-06-17', 'Pranav Doshi', 'Headboard and foot board upholstery',
    'Upholstery', 'As per dimensions', 1),

  row('C114', '2026-06-15', '2026-06-25', 'C202 Samasta', 'Main safety door Grill',
    '3mm sheet metal laser cutting and powder coating finish', 'As per dimensions', 1),
  row('C114', '2026-06-15', '2026-06-25', 'C202 Samasta', 'Parents room leg', '12mm metal patta', 'As per dimensions', 1),
  row('C114', '2026-06-15', '2026-06-25', 'C202 Samasta', 'Parents room leg', '12mm metal patta', 'As per dimensions', 2),
  row('C114', '2026-06-15', '2026-06-25', 'C202 Samasta', 'Kids room leg',
    '25 x 25mm MS pipe and powder coating finish', 'As per dimensions', 1),

  row('C113', '2026-06-22', '2026-06-29', 'Shamnu Flats', 'Entrance Door Grill',
    '3mm MS powder coated grill with shutter opening down inside and stopper to close', 'As per dimensions', 2),

  row('C115', '2026-06-18', '2026-07-08', 'Gulabchand Jewellers', 'Stair railing',
    '16mm MS pipe unfinished with installation. Includes 4 railings — ground and first floor.', 'As per dimensions', 1),
  row('C115', '2026-06-18', '2026-07-08', 'Gulabchand Jewellers', 'Metal railing', 'MS pipe structure', 'As per dimensions', 1),
  row('C115', '2026-06-18', '2026-07-08', 'Gulabchand Jewellers', 'Window grill',
    '16 x 16mm bright bar window grill, unfinished with installation.', 'As per dimensions', 6),

  row('C106-1', '2026-06-10', '2026-06-23', 'Mr. Vaibhav Suthar', 'Custom Entry Room Sofa with attached side table',
    'Mildsteel metal frame structure with powder coating finish and fabric upholstery', '66 x 26 x 32"', 1),

  row('C122-1', '2026-07-09', '2026-07-30', 'Yash Agrawal', 'Naavo - Custom Bench',
    'Fabric upholstery and solid teak wood base.', '55 x 16 x 20"', 1),

  // ── B-series (BOQ) — the older, mostly finished, orders ──
  row('B105', '2025-11-18', '2025-11-28', 'NH48', 'Cork Barstool', 'Metal structure', '-', 1,
    { metal: { type: 'MS', finish: 'NA' }, stage: 'delivered', vendors: { metal: 'Dinesh bhai' } }),

  row('B102', '2025-11-05', '2025-12-06', 'Ar. Krishna Shah Project @ Ahmedabad', 'Sofa',
    'Solid teak wood structure, metal element on armrest sides, fabric upholstery and 8 loose cushions (total)',
    '86 x 36 x 35"', 1, {
      upholstery: { name: 'V&J Persia 109', length: '10 mtr' },
      metal: { type: 'Brass', finish: 'NA' }, wood: { type: 'Teak', finish: 'Soft brown' },
      stage: 'assembly',
      vendors: { drawings: 'Bansari Panchal', metal: 'Dinesh bhai', wood: 'Vikas Bhai', upholstery: 'Arif bhai' },
    }),

  ...[
    ['Console 01 - Veer Bedroom', 'Solid teak wood and powder coated metal structure.', '70 x 14 x 36"', 1,
      { metal: { type: 'Stainless steel', finish: 'PVD brass' }, wood: { type: 'Teakwood', finish: 'Walnut brown' },
        vendors: { drawings: 'Bansari Panchal', metal: 'Dinesh bhai', wood: 'Vikas Bhai' } }],
    ['Side table 01 - Veer bedroom', 'Solid ash wood', '29 x 18 x 28"', 2,
      { wood: { type: 'Ashwood', finish: 'Soft Brown' }, vendors: { drawings: 'Bansari Panchal', wood: 'Vikas Bhai' } }],
    ['Bed 01 - Veer Bedroom', 'Solid ash wood and fabric upholstered headboard with updated design.', '84 x 78 x 84"', 1,
      { upholstery: { name: 'V&J Danish Covina 202', length: '2.5 mtr' },
        metal: { type: 'Stainless steel', finish: 'Brass' }, wood: { type: 'Ashwood', finish: 'Soft Brown' },
        vendors: { drawings: 'Bansari Panchal', metal: 'Dinesh bhai', wood: 'Vikas Bhai' } }],
    ['Sofa 01 - Veer bedroom', 'Fabric upholstery', '72 x 40 x 33.5"', 1,
      { upholstery: { name: 'V&J Danish Covina 202', length: '10 mtr' }, metal: { type: 'Mildsteel', finish: 'Chrome' },
        vendors: { drawings: 'Bansari Panchal' } }],
    ['Center table 01 - Veer Bedroom', 'Solid teak wood', '28 x 28 x 15"', 1,
      { wood: { type: 'Teakwood', finish: 'Walnut brown' }, vendors: { drawings: 'Bansari Panchal', wood: 'Vikas Bhai' } }],
    ['Armchair + Foot stool 01 - Veer Bedroom', 'Fabric upholstery and solid teak wood structure', '30 x 34 x 34"', 1,
      { upholstery: { name: 'V&J Port Leather Sr. 4', length: '5.5 mtr' }, wood: { type: 'Teakwood', finish: 'Soft brown' },
        vendors: { drawings: 'Bansari Panchal', wood: 'Vikas Bhai' } }],
    ['Sofa 02 - Party Room', 'Fabric upholstery and powdered coated metal structure.', '72 x 42 x 32"', 1,
      { upholstery: { name: 'DeTela Ellinor 4002 Ivory', length: '9 mtr' }, wood: { type: 'Teakwood', finish: 'Soft brown' },
        vendors: { drawings: 'Bansari Panchal', wood: 'Vikas Bhai' } }],
    ['Center Table 02 - Party Room', 'Powdered coated metal.', '28 x 28 x15"', 1,
      { metal: { type: 'Mildsteel', finish: 'Green' }, vendors: { drawings: 'Bansari Panchal', metal: 'Dinesh bhai' } }],
    ['Armchair 02 - Party Room', 'Fabric upholstery and solid teak wood structure.', '27.5 x 33.5 x 31"', 1,
      { upholstery: { name: 'DeTela Pierro Sade 2', length: '4 mtr' }, wood: { type: 'Teakwood', finish: 'Black wirebrush' },
        vendors: { drawings: 'Bansari Panchal', wood: 'Vikas Bhai' } }],
    ['TV Console 01 - Party Room', 'Veneer, laminate, HDHMR and powder coated metal base', '60 x 16 x 35"', 1,
      { metal: { type: 'Mildsteel', finish: 'Black' }, wood: { type: 'Ply-Veneer-Lam', finish: '' },
        vendors: { drawings: 'Bansari Panchal', metal: 'Dinesh bhai' } }],
    ['Study Table 01 - Parents room', 'Solid teak wood', '48 x 20 x 30"', 1,
      { wood: { type: 'Teakwood', finish: 'Soft brown' }, vendors: { drawings: 'Bansari Panchal', wood: 'Vikas Bhai' } }],
    ['Study Chair 01 - Parents room', 'Faux leather upholstery and solid teak wood', '21.5 x 18.5 x 28"', 1,
      { upholstery: { name: 'V&J Port leather 36', length: '1 mtr' }, wood: { type: 'Teakwood', finish: 'Soft brown' },
        vendors: { drawings: 'Bansari Panchal', wood: 'Vikas Bhai' } }],
    ['Console 03 - Living Room Entry', 'Solid teak wood.', '40 x 10 x 35"', 1,
      { wood: { type: 'Teakwood', finish: 'Soft brown' }, vendors: { drawings: 'Bansari Panchal', wood: 'Vikas Bhai' } }],
    ['Console 04 - Room Lobby', 'Solid teak wood.', '34 x 7 x 35"', 1,
      { wood: { type: 'Teakwood', finish: 'Black wirebrush' }, vendors: { drawings: 'Bansari Panchal', wood: 'Vikas Bhai' } }],
  ].map(([name, specs, dims, qty, extra]) => row('B109', '2025-12-30', '2026-01-31', 'Veer Chaudhary', name, specs, dims, qty,
    { ...extra, stage: 'delivered' })),

  row('B123', '2026-04-10', '2026-04-17', 'Harshil Shah', 'Side Table', 'Solid sheesham wood - Without Polish',
    '400 x 400 x 512 mm', 2, { wood: { type: 'Teakwood', finish: 'Raw' }, stage: 'delivered' }),

  row('B116', '2026-03-14', '2026-04-03', 'Ar. Krishna Shah', 'Acrylic Side Table',
    'Acrylic top, 3d printed base (raw, unfinished)', 'As per actual design', 1, { stage: 'delivered' }),

  row('B129', '2026-03-10', '2026-04-04', 'Alap Patel', 'Wooden Candle', 'Acacia wood, soy wax, wick, soy flowers',
    'As per dimensions', 79, { stage: 'delivered' }),

  ...[
    ['Galant Sofa - Custom', 'Solid teak wood structure brass element and fabric upholstery', '86 x 31 x 32"', 2,
      { vendors: { drawings: 'Bansari Panchal', metal: 'Dinesh bhai', wood: 'Vikas Bhai', upholstery: 'Arif bhai' } }],
    ['Center Table - Small', 'Solid ash wood structure Ply + veneer top with solid wood edge', '16 x 16 x 19"', 2,
      { vendors: { drawings: 'Bansari Panchal', wood: 'Parth' } }],
    ['Center Table - Small', 'Solid ash wood structure and glass top', '16 x 16 x 19"', 1,
      { vendors: { drawings: 'Bansari Panchal', wood: 'Parth' } }],
    ['Center table - Medium', 'Solid ash wood structure and glass top', '29 x 29 x 13"', 1,
      { vendors: { drawings: 'Bansari Panchal', wood: 'Parth' } }],
    ['Center table - Large', 'Solid ash wood structure Ply + veneer top with solid wood edge', '37 x 37 x 16"', 1,
      { vendors: { drawings: 'Bansari Panchal', wood: 'Parth' } }],
    ['Armchair', 'Solid teak wood structure and fabric upholstery', '27 x 33 x 30"', 2,
      { vendors: { drawings: 'Bansari Panchal', wood: 'Parth', upholstery: 'Arif bhai' } }],
    ['Side Table', 'Solid teak wood structure, ply + veneer and metal handle', '27 x 23 x 22"', 2,
      { vendors: { drawings: 'Bansari Panchal', metal: 'Dinesh bhai', wood: 'Parth', hardware: 'Knobs' } }],
  ].map(([name, specs, dims, qty, extra]) => row('B111', '2026-01-16', '2026-03-16', 'Ar. Krishna Shah', name, specs, dims, qty,
    { ...extra, stage: 'delivered' })),

  row('B131', '2026-04-22', '2026-04-27', 'Siddharth Saraiya', 'Mirror 1',
    'Mildsteel structure and mirror, 5mm mirror with MDF support. Without powder coating.', '24 x 3 x 32"', 1,
    { metal: { type: 'Mildsteel', finish: 'Unfinished' }, stage: 'delivered', vendors: { metal: 'Dinesh bhai' } }),
  row('B131', '2026-04-22', '2026-04-27', 'Siddharth Saraiya', 'Mirror 2',
    'Mildsteel frame structure and mirror, 5mm mirror with MDF support. Without powder coating.',
    '27" diameter mirror, height as per dimensions', 1,
    { metal: { type: 'Mildsteel', finish: 'Unfinished' }, stage: 'delivered', vendors: { metal: 'Dinesh bhai' } }),

  row('B121', '2026-04-13', '2026-04-20', 'SMK Modular LLP', 'Dining chair 03 - Meeting & Add',
    'Fabric upholstery (stain resistant, backed by acrylic, latex or knit). Metal legs structure.',
    '550 x 560 x 800mm', 1, { upholstery: { name: 'VnJ Compass 118', length: '1.5 mtr' },
      metal: { type: 'Mildsteel', finish: 'Black Powder coating' }, stage: 'delivered',
      vendors: { drawings: 'Dinesh bhai', upholstery: 'Arif bhai' } }),
  row('B121', '2026-04-13', '2026-04-20', 'SMK Modular LLP', 'Armchair 2 - Reception Lobby',
    'Metal structure: charcoal grey, brushed finish. Fabric commercially treated for soil and stain repellency.',
    '770 x 760 x 750mm', 1, { upholstery: { name: 'VnJ Vol 1 Sr 152 & VnJ Vol II Sr. 421 (throw pillow)', length: '3 + 1 mtr' },
      metal: { type: 'Mildsteel', finish: 'Black Powder coating' }, stage: 'delivered',
      vendors: { upholstery: 'Arif bhai' } }),
  row('B121', '2026-04-13', '2026-04-20', 'SMK Modular LLP', 'Barstool 01 - Bar',
    'Metal structure: charcoal grey, brushed finish. Fabric commercially treated for soil and stain repellency.',
    '570 x 505 x 1000mm', 1, { upholstery: { name: 'VnJ Compass Shade 122 (seat) & 107 (backrest)', length: '0.5 + 0.5 mtr' },
      metal: { type: 'Mildsteel', finish: 'Black Powder coating' }, stage: 'delivered',
      vendors: { drawings: 'Dinesh bhai', upholstery: 'Arif bhai' } }),
  row('B121', '2026-04-13', '2026-04-20', 'SMK Modular LLP', 'Dining chair 01 - Meeting & Add',
    'Fabric treated commercially for soil and stain repellency.', '570 x 580 x 800mm', 1,
    { upholstery: { name: 'VnJ Compass Shade 122', length: '1.5 mtr' }, wood: { type: 'Teakwood', finish: 'Natural Oak Stain Finish' },
      stage: 'production', vendors: { wood: 'Keyur Chotaliya', upholstery: 'Keyur bhai' } }),
  row('B121', '2026-04-13', '2026-04-20', 'SMK Modular LLP', 'Dining chair 02 - Meeting & Add',
    'Fabric upholstery and solid teak wood structure with required specifications', '610 x 580 x 800mm', 1,
    { upholstery: { name: 'VnJ Compass 127', length: '2.5 mtr' }, wood: { type: 'Teakwood', finish: 'Black Finish' },
      stage: 'production', vendors: { wood: 'Keyur Chotaliya', upholstery: 'Keyur bhai' } }),
  row('B121', '2026-04-13', '2026-04-20', 'SMK Modular LLP', 'Study Chair', 'Faux leather upholstery as selected, solid teak wood legs',
    '600 x 630 x 850mm', 1, { upholstery: { name: 'VnJ Compass Shade 122', length: '2.5 mtr' },
      wood: { type: 'Teakwood', finish: 'Soft Brown' }, stage: 'production',
      vendors: { wood: 'Keyur Chotaliya', upholstery: 'Keyur bhai' } }),
  row('B121', '2026-04-13', '2026-04-20', 'SMK Modular LLP', 'Armchair 1 - Reception Lobby',
    'Fabric upholstery and solid teak wood structure with required specifications', '780 x 800 x 930mm', 1,
    { upholstery: { name: 'VnJ Compass Shade 122 & Urbanic 0175392', length: '2.5 mtr' },
      metal: { type: 'Mildsteel', finish: 'Red powder coating' }, stage: 'production',
      vendors: { metal: 'Dinesh bhai', wood: 'Vikas Bhai', upholstery: 'Arif bhai' } }),

  row('B127', '2026-04-11', '2026-05-12', 'Pranav Doshi', 'Sofa - Custom',
    'Solid teak wood polished structure and fabric upholstery. Fabric not included.', '90 x 40 x 32"', 1,
    { upholstery: { name: 'Client', length: 'Client' }, wood: { type: 'Teakwood', finish: 'Black Finish' },
      stage: 'production', vendors: { wood: 'Vikas Bhai', upholstery: 'Arif bhai' } }),

  row('B128', '2026-04-14', '2026-04-28', 'Siddharth Saraiya', 'Metal shelf', 'Metal structure', 'As per dimensions', 1,
    { metal: { type: 'Mildsteel', finish: '' }, stage: 'shipped', vendors: { metal: 'Dinesh bhai' } }),

  row('B130', '2026-04-30', '2026-06-14', 'Pranav Doshi', 'Center table - platform sofa', 'HDHMR & PU finish',
    '44 x 44 x 12"', 1),
  row('B130', '2026-04-30', '2026-06-14', 'Pranav Doshi', 'Center table - Glass',
    '8mm toughened glass top, metal structure, leather plywood drawers, veneer plywood base', '54 x 27 x 15"', 1),
];

/* Guarded the same way the Commission module seeds its two known
   partners: only when there is nothing on file yet, so a real edit
   or delete is never quietly reintroduced by re-opening the tab. */
/* A stable id for a seeded row: the same piece seeded on the office
   laptop and on the workshop phone has to be one row on the shared
   books, not two. Derived from what identifies the piece rather than
   from its position in the list, so adding a row to SEED later does
   not rename the others. */
function seedId(row) {
  const slug = `${row.mrNo || ''} ${row.name || ''} ${row.dims || ''}`
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
  return `ord_seed_${slug}`;
}

export function seedOrders() {
  // Any row at all, tombstones included: a device that has synced and
  // holds only deletions must not seed them back and push the lot
  // straight to every other device.
  if (state.orders.length) return { added: 0 };

  // Two pieces on one order can be identical down to the dimensions —
  // a pair of matching brackets is two rows, not one — so a repeated
  // id is numbered rather than allowed to collapse the two into one
  // row. SEED's order is fixed in the source, so the numbering is the
  // same on every device.
  const seen = new Map();
  for (const s of SEED) {
    const base = seedId(s);
    const n = (seen.get(base) || 0) + 1;
    seen.set(base, n);
    addLine({ ...s, id: n === 1 ? base : `${base}-${n}` });
  }
  return { added: SEED.length };
}

/* ── The shared books ──────────────────────────────────────────
   The shop floor is not one person's screen: a piece moved to
   Assembly on the workshop phone has to be at Assembly on the
   office laptop. So orders ride the same records table the ledger
   and the quotations do — one kind, keyed by the line item's own
   id, last write wins per row. See js/shopsync.js for the pump.

   Every mutation above already stamps updatedAt and deletes softly
   (deletedAt rather than a splice), which is exactly what a
   tombstone needs, so nothing here has to be tracked by hand. */

export const SYNC_KINDS = [
  { kind: 'order', arr: 'orders', key: 'id' },
];

/** Every line item, tombstones included, as the server wants them. */
export function syncRecords() {
  const out = [];
  for (const rec of state.orders || []) {
    if (!rec.id) continue;
    out.push({
      kind: 'order',
      id: String(rec.id),
      data: rec,
      updatedAt: rec.updatedAt || rec.createdAt || Date.now(),
      deletedAt: rec.deletedAt || null,
    });
  }
  return out;
}

/**
 * Rows the server sent, folded in newest-write-wins per record.
 * Returns how many actually moved, so a sync that found nothing does
 * not repaint a screen someone is reading.
 */
export function applyRemote(rows) {
  let changed = 0;

  for (const row of rows || []) {
    if (row.kind !== 'order') continue;
    const at = Date.parse(row.updated_at) || 0;
    const i = state.orders.findIndex((o) => String(o.id) === String(row.id));
    const mine = i >= 0 ? state.orders[i] : null;
    const mineAt = mine ? (mine.updatedAt || mine.createdAt || 0) : -1;

    // A tie goes to the device, which is what stops a pull from
    // undoing an edit made in the same second it arrived.
    if (mine && mineAt >= at) continue;

    const next = { ...(row.data || {}), id: String(row.id), updatedAt: at };
    if (row.deleted_at) next.deletedAt = Date.parse(row.deleted_at) || at;
    else delete next.deletedAt;

    if (mine) state.orders[i] = next; else state.orders.push(next);
    changed += 1;
  }

  if (changed) { write(); emit(); }
  return changed;
}

/* Whose books these are. Local work done before there was an account
   is claimed by the first org that signs in; work belonging to a
   different org is cleared rather than pushed into somebody else's
   books. Returns true when it had to clear, so the caller resets its
   cursor and pulls the new org from the beginning. */
export function claimFor(orgId) {
  const want = String(orgId || '');
  if (!want) return false;
  if (!state.orgId) { state.orgId = want; write(); return false; }
  if (state.orgId === want) return false;

  state.orders = [];
  state.orgId = want;
  write(); emit();
  return true;
}

export function ownerOrg() { return state.orgId; }

/** Everything this device holds, cleared of its org claim — used when
    signing out, so the next account starts from the server's copy. */
export function wipe() {
  state = blank();
  write(); emit();
}
