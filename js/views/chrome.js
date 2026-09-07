/* views/chrome.js — the furniture every station on the line shares.
 *
 * Seven screens that all answer the same shape of question — what is
 * here, how much of it, and what needs me — should not each invent
 * their own heading, their own figure row and their own card. They
 * are built from these four pieces instead, so the line reads as one
 * floor rather than seven rooms, and a change to the shape of a
 * card is one edit.
 *
 * The dark hero band belongs to Phynance, whose screens are about
 * money and want the weight. The production floor is paperwork: it
 * sits on cream, under a plain heading, the way the job sheet on the
 * bench does.
 */

import { icon } from '../icons.js';
import { esc } from '../ui.js';
import { num } from '../format.js';

/** The screen's own name, what it is counting, and its one action. */
export function pageHead({ title, sub = '', actions = '' }) {
  return `
    <header class="pagehead">
      <div class="pagehead-txt">
        <h1>${esc(title)}</h1>
        ${sub ? `<p>${esc(sub)}</p>` : ''}
      </div>
      ${actions ? `<div class="pagehead-acts">${actions}</div>` : ''}
    </header>`;
}

/** A search field, in the one shape every station uses. */
export function searchBar(value, placeholder) {
  return `
    <div class="searchbar">
      <span class="searchbar-ico">${icon('search', 17)}</span>
      <input class="control" type="search" data-q value="${esc(value || '')}"
             placeholder="${esc(placeholder)}" aria-label="${esc(placeholder)}">
    </div>`;
}

/* The figures across the top. Never more than four: a row that has
   to scroll is a row nobody reads the end of.

   `tone` tints the card with the station's own colour, so the same
   figure means the same thing wherever it appears — an amber card
   is production on the Dashboard and on the Production screen
   alike. `go` makes it a door to the screen that owns it. */
export function statCards(items) {
  return `
    <div class="statcards">
      ${items.map((s) => {
        const tag = s.go ? 'button' : 'div';
        const val = s.money ? `<span class="cur">₹</span>${esc(num(s.value))}`
          : esc(s.value === '' || s.value == null ? '—' : String(s.value));
        return `
          <${tag} class="statcard${s.tone ? ` t-${s.tone}` : ''}${s.go ? ' go' : ''}"
                  ${s.go ? `data-go="${esc(s.go)}"` : ''}>
            <span class="statcard-l">${esc(s.label)}</span>
            <span class="statcard-v num">${val}</span>
            ${s.hint ? `<span class="statcard-h">${esc(s.hint)}</span>` : ''}
            ${s.go ? `<span class="statcard-go">${icon('chevR', 15)}</span>` : ''}
          </${tag}>`;
      }).join('')}
    </div>`;
}

/** A heading inside the page, with an optional way through. */
export function sectionHead(title, rightHTML = '') {
  return `
    <div class="secthead">
      <h2>${esc(title)}</h2>
      ${rightHTML}
    </div>`;
}

/* One order, as it appears at whichever station it is standing in.
   The stripe down the left is the station's colour — the only thing
   that changes between screens, so a card is recognisable as the
   same order all the way down the line. */
export function orderCard({ mrNo, client, meta, pill, pillTone, tint, id, flag = '' }) {
  return `
    <article class="ocard${tint ? ` t-${tint}` : ''}" data-open="${esc(id)}" tabindex="0" role="button">
      <div class="ocard-main">
        <div class="ocard-t">${esc(client || mrNo)}</div>
        <div class="ocard-m">
          <span class="ocard-mr">${esc(mrNo)}</span>
          ${meta.map((m) => `<span class="ocard-dot"></span>${esc(m)}`).join('')}
        </div>
        ${flag ? `<div class="ocard-flag">${flag}</div>` : ''}
      </div>
      <div class="ocard-side">
        ${pill ? `<span class="pill ${pillTone || 'mut'}">${esc(pill)}</span>` : ''}
        <span class="ocard-go">${icon('chevR', 16)}</span>
      </div>
    </article>`;
}

/** What a screen with nothing on it says, in the house shape. */
export function nothingHere(ico, text, sub = '') {
  return `
    <div class="empty">
      <div class="empty-ico">${icon(ico, 32, 1.4)}</div>
      <p>${esc(text)}</p>
      ${sub ? `<small>${esc(sub)}</small>` : ''}
    </div>`;
}

/* A station that has not been specified yet still has to say
   something true: what it is for, what it will hold, and what it is
   already holding on its behalf. A blank screen reads as broken;
   this reads as unfinished, which is what it is. */
export function comingUp(lines) {
  return `
    <div class="comingup">
      ${lines.map((l) => `<p>${esc(l)}</p>`).join('')}
    </div>`;
}
