/* export.js — getting the numbers back out.
   Two shapes: a CSV your CA can open in Excel, and a full JSON backup
   that restores the whole ledger on another device. */

import {
  entries, accountName, categoryName, getJob, exportAll, totals,
  monthTotals, byCategory,
} from './store.js';
import { dmy, monthLabel, monthShort, num, fyRange } from './format.js';

function csvCell(v) {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function csvOf(rows) {
  return rows.map((r) => r.map(csvCell).join(',')).join('\r\n');
}

/** A BOM so Excel opens ₹ and Indian names correctly on Windows. */
function download(name, text, mime = 'text/csv;charset=utf-8') {
  const blob = new Blob(['﻿' + text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function rowsFor(list) {
  const head = [
    'Date', 'Type', 'Category', 'Job / MR No.', 'Party', 'Particulars',
    'Account', 'To account', 'Base', 'GST rate %', 'GST amount', 'Total',
    'Photo', 'Edited', 'Logged at',
  ];
  const body = list.map((e) => [
    dmy(e.date),
    e.type === 'in' ? 'Money in' : e.type === 'out' ? 'Money out' : 'Transfer',
    e.type === 'transfer' ? '' : categoryName(e.categoryId),
    e.jobCode || '',
    e.party || '',
    e.note || '',
    accountName(e.accountId),
    e.toAccountId ? accountName(e.toAccountId) : '',
    e.base ?? e.total,
    e.gst && e.gst.on ? e.gst.rate : '',
    e.gstAmount || '',
    e.total,
    (e.photoIds && e.photoIds.length) ? 'Yes' : '',
    e.edited ? 'Yes' : '',
    new Date(e.createdAt).toLocaleString('en-IN'),
  ]);
  return [head, ...body];
}

function sorted(list) {
  return list.slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : (a.createdAt || 0) - (b.createdAt || 0)));
}

/** One month, ledger order, with a totals block at the bottom. */
export function exportMonthCSV(monthKey) {
  const list = sorted(entries().filter((e) => e.date.slice(0, 7) === monthKey));
  const t = totals(list);
  const rows = rowsFor(list);
  rows.push([]);
  rows.push(['', '', '', '', '', '', '', '', '', '', 'Money in', t.in]);
  rows.push(['', '', '', '', '', '', '', '', '', '', 'Money out', t.out]);
  rows.push(['', '', '', '', '', '', '', '', '', '', 'Net', t.net]);
  rows.push(['', '', '', '', '', '', '', '', '', '', 'GST collected', t.gstIn]);
  rows.push(['', '', '', '', '', '', '', '', '', '', 'GST paid', t.gstOut]);
  rows.push(['', '', '', '', '', '', '', '', '', '', 'GST net', t.gstNet]);
  download(`Phynance ${monthShort(monthKey).replace(' ', '-')}.csv`, csvOf(rows));
  return list.length;
}

/** Everything, for the CA at year end. */
export function exportAllCSV() {
  const list = sorted(entries());
  download(`Phynance all entries ${new Date().toISOString().slice(0, 10)}.csv`, csvOf(rowsFor(list)));
  return list.length;
}

export function exportFYCSV(anyDateInFY) {
  const { from, to, label } = fyRange(anyDateInFY);
  const list = sorted(entries().filter((e) => e.date >= from && e.date <= to));
  download(`Phynance ${label.replace(' ', '-')}.csv`, csvOf(rowsFor(list)));
  return list.length;
}

/** A one-page month summary, the shape a CA usually wants first. */
export function exportMonthSummaryCSV(monthKey) {
  const t = monthTotals(monthKey);
  const list = entries().filter((e) => e.date.slice(0, 7) === monthKey);
  const rows = [
    [`Phynance summary — ${monthLabel(monthKey)}`],
    [],
    ['Money in', t.in],
    ['Money out', t.out],
    ['Net', t.net],
    ['Entries', t.count],
    [],
    ['GST collected on sales', t.gstIn],
    ['GST paid on purchases', t.gstOut],
    ['Net GST', t.gstNet],
    [],
    ['Money out by category', 'Amount'],
    ...byCategory(list, 'out').map((c) => [c.name, c.amount]),
    [],
    ['Money in by category', 'Amount'],
    ...byCategory(list, 'in').map((c) => [c.name, c.amount]),
    [],
    ['By job', 'Received', 'Spent', 'Order value', 'Outstanding'],
  ];

  const jobCodes = Array.from(new Set(list.map((e) => e.jobCode).filter(Boolean)));
  for (const code of jobCodes) {
    const rec = list.filter((e) => e.jobCode === code);
    const rIn = rec.filter((e) => e.type === 'in').reduce((s, e) => s + e.total, 0);
    const rOut = rec.filter((e) => e.type === 'out').reduce((s, e) => s + e.total, 0);
    const j = getJob(code);
    rows.push([code, rIn, rOut, j && j.orderValue ? j.orderValue : '', '']);
  }

  download(`Phynance summary ${monthShort(monthKey).replace(' ', '-')}.csv`, csvOf(rows));
  return t.count;
}

/** Full backup — restores the ledger exactly, minus photos and secrets. */
export function exportBackup() {
  const payload = exportAll();
  download(
    `Phynance backup ${new Date().toISOString().slice(0, 10)}.json`,
    JSON.stringify(payload, null, 2),
    'application/json'
  );
  return payload.data.entries.length;
}

/** Reads a backup file the user picked. */
export function readBackupFile() {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.style.position = 'fixed';
    input.style.left = '-9999px';
    document.body.appendChild(input);
    input.addEventListener('change', () => {
      const f = (input.files || [])[0];
      input.remove();
      if (!f) { resolve(null); return; }
      const r = new FileReader();
      r.onload = () => {
        try { resolve(JSON.parse(String(r.result))); }
        catch { reject(new Error('That file could not be read as a backup.')); }
      };
      r.onerror = () => reject(new Error('That file could not be read.'));
      r.readAsText(f);
    });
    input.click();
  });
}

/** A WhatsApp-ready day summary — the one thing that gets shared by hand. */
export function dayTextSummary(iso, list) {
  const t = totals(list);
  const lines = [`Phynance — ${dmy(iso)}`, ''];
  for (const e of list) {
    const sign = e.type === 'in' ? '+' : e.type === 'out' ? '-' : '↔';
    const what = e.type === 'transfer'
      ? `${accountName(e.accountId)} → ${accountName(e.toAccountId)}`
      : `${categoryName(e.categoryId)}${e.party ? ' · ' + e.party : ''}`;
    lines.push(`${sign} ₹${num(e.total)}  ${what}${e.jobCode ? ' [' + e.jobCode + ']' : ''}`);
  }
  lines.push('', `In ₹${num(t.in)} · Out ₹${num(t.out)} · Net ₹${num(t.net)}`);
  return lines.join('\n');
}
