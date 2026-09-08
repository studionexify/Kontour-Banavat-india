/* views/nextstep.js — what to do with this piece next.
 *
 * The stage of a piece used to be a dropdown: seven options, six of
 * them wrong, and no indication of which one the floor was actually
 * waiting for. Nobody reads a job sheet that way. They look at a
 * piece and ask one question — what happens to this now — and the
 * answer is always exactly one thing.
 *
 * So every card carries one button, bottom right, naming that one
 * thing. Where the step has a form behind it the button opens that
 * form, so the record gets made rather than the stage quietly
 * jumping: a piece reaching QC opens the check, a piece leaving
 * opens the despatch sheet. Where there is nothing to fill in, the
 * button advances the piece and says so.
 *
 * The sheets it opens are the screens' own — qc.openCheck,
 * shipping.openDespatch — imported when tapped rather than at the
 * top of the file, because those screens import the order sheet
 * this button lives on, and a cycle at load time is a blank app.
 *
 * One rule decides the whole table below: the button names what a
 * person does, not what a database field becomes. "Send to QC", not
 * "Set stage = assembly".
 */

import { icon } from '../icons.js';
import { esc, toast, haptic } from '../ui.js';
import { updateLine, getLine, stageLabel } from '../orders.js';
import { openQuickAssign } from './quickassign.js';
import * as quotes from '../quotes.js';
import * as subs from '../subs.js';

/* stage → the one thing that happens next.
 *
 *   label  what the button says
 *   to     the stage it moves the piece to, where it simply moves it
 *   run    the form it opens instead, where there is one
 *   done   the end of the line: no button, just a mark
 */
const STEPS = {
  pending: {
    label: 'Start drawings', icon: 'edit', to: 'drawings',
    said: 'On the drawing board',
  },
  drawings: {
    label: 'Assign a maker', icon: 'hands',
    run: (line, refresh) => openQuickAssign(line, refresh),
  },
  commission: {
    label: 'Start production', icon: 'anvil', to: 'production',
    said: 'In production',
  },
  production: {
    label: 'Send to QC', icon: 'clipboard', to: 'assembly',
    said: 'At assembly, waiting to be checked',
  },
  assembly: {
    label: 'Run QC check', icon: 'check',
    run: async (line, refresh) => {
      const { openCheck } = await import('./qc.js');
      openCheck(line.id, 'pass', refresh);
    },
  },
  shipped: {
    label: 'Record despatch', icon: 'truck',
    run: async (line, refresh) => {
      const { openDespatch } = await import('./shipping.js');
      openDespatch(line.id, refresh);
    },
  },
  delivered: { done: true },
};

/* A piece that is already out but has its despatch recorded wants
   the other half of that step — the client actually has it — and
   there is nothing left to fill in, so it moves. */
function stepFor(line) {
  if (!line) return null;
  if (line.stage === 'shipped' && line.despatch) {
    return { label: 'Mark delivered', icon: 'check', to: 'delivered', said: 'Delivered' };
  }
  const step = STEPS[line.stage] || STEPS.pending;
  return step.done ? null : step;
}

/** What the button would say, for a caller that wants the words. */
export function nextLabel(line) {
  const s = stepFor(line);
  return s ? s.label : '';
}

/**
 * The button itself. `size` is 'sm' on a board card, '' on a piece.
 * A piece at the end of the line gets the mark instead, so the
 * corner never reads as a missing control.
 */
export function nextButton(line, size = '') {
  const step = stepFor(line);
  if (!step) {
    return `<span class="nextbtn done ${esc(size)}">${icon('check', 13)} ${esc(stageLabel(line.stage))}</span>`;
  }
  return `
    <button class="nextbtn ${esc(size)}" data-next="${esc(line.id)}"
            aria-label="${esc(step.label)}">
      ${esc(step.label)} ${icon('chevR', 14)}
    </button>`;
}

/** One handler per screen: runs whatever the tapped piece's step is. */
export function wireNext(root, refresh = () => {}) {
  root.addEventListener('click', (e) => {
    const b = e.target.closest('[data-next]');
    if (!b || !root.contains(b)) return;
    // A board card is itself a button that opens the order, so the
    // step must not open it as well.
    e.preventDefault();
    e.stopPropagation();
    runNext(b.dataset.next, refresh);
  });
}

export function runNext(lineId, refresh = () => {}) {
  const line = getLine(lineId);
  const step = stepFor(line);
  if (!step) return;
  haptic(10);
  if (step.run) { step.run(line, refresh); return; }
  updateLine(line.id, { stage: step.to });
  toast(`${line.name || 'Piece'} · ${step.said}`);
  refresh();
}


/* ── The same idea, one step earlier ───────────────────────────
   A quotation is the piece before it is a piece, and it moves the
   same way: it is written, it goes out, and the client says yes or
   no. Three states, and at each of them exactly one thing is
   waiting to happen — so the card carries the same button.
 *
 * Accepting is the one step that reaches into the rest of the app
 * (it books the job and opens the pieces in production), so the
 * button opens the approval form rather than doing it silently.
 * Declining is the other answer, not the expected one, and stays
 * under the row's "⋯" where it was. */
const QUOTE_STEPS = {
  draft: { label: 'Mark as sent', said: 'With the client' },
  sent:  { label: 'Client approved', form: true },
};

export function quoteNextButton(q, size = '') {
  const step = q && QUOTE_STEPS[q.status];
  if (!step) {
    const st = (quotes.STATUS[q && q.status] || quotes.STATUS.draft);
    return `<span class="nextbtn done ${esc(size)}">${icon('check', 13)} ${esc(st.label)}</span>`;
  }
  return `
    <button class="nextbtn ${esc(size)}" data-qnext="${esc(q.id)}" aria-label="${esc(step.label)}">
      ${esc(step.label)} ${icon('chevR', 14)}
    </button>`;
}

/* ── And one level down ────────────────────────────────────────
   A commissioned piece with a sub-contractor is waiting on one
   verdict: their part is done, or it is not. Approving is the step
   — it is what releases the piece to QC once everyone
   commissioned on it has said the same — so it is the button.
   Sending work back has to be said in words and photographs, so it
   stays inside the piece board where those live. */
export function itemNextButton(it, size = '') {
  if (!it) return '';
  if ((it.state || 'working') === 'approved') {
    return `<span class="nextbtn done ${esc(size)}">${icon('check', 13)} Approved</span>`;
  }
  return `
    <button class="nextbtn ${esc(size)}" data-inext="${esc(it.id)}" aria-label="Approve their part">
      Approve part ${icon('chevR', 14)}
    </button>`;
}

/* One handler for the two of them, alongside the pieces', so a
   screen wires "what happens next" once however many kinds of card
   it is showing. `ctx` is only needed where a form has to be able
   to send you somewhere afterwards. */
export function wireNextAll(root, refresh = () => {}, ctx = null) {
  wireNext(root, refresh);

  root.addEventListener('click', async (e) => {
    const q = e.target.closest('[data-qnext]');
    if (q && root.contains(q)) {
      e.preventDefault(); e.stopPropagation();
      haptic(10);
      const quote = quotes.getQuote(q.dataset.qnext);
      if (!quote) return;
      if (quote.status === 'draft') {
        quotes.setStatus(quote.id, 'sent');
        toast(`${quotes.quoteName(quote)} · with the client`);
        refresh();
        return;
      }
      const { openAccept } = await import('./quotelist.js');
      openAccept(quote.id, ctx || { refresh });
      return;
    }

    const i = e.target.closest('[data-inext]');
    if (i && root.contains(i)) {
      e.preventDefault(); e.stopPropagation();
      haptic(10);
      const item = subs.getItem(i.dataset.inext);
      if (!item) return;
      subs.setItemState(item.id, 'approved', { text: 'Approved from the board' });
      // syncLineStage has just decided whether the piece can move on:
      // it goes to QC only once every commissioning on it is approved.
      toast(`${item.name || 'Piece'} · their part is approved`);
      refresh();
    }
  });
}
