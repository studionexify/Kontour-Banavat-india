/* icons.js — thin line icons, matching the reference UI's weight.
   Every icon is a 24-box path set; size and stroke are set at call time. */

const P = {
  home:      '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M9.5 21v-6h5v6"/>',
  ledger:    '<rect x="4" y="3" width="16" height="18" rx="2.5"/><path d="M8 8h8M8 12h8M8 16h5"/>',
  jobs:      '<path d="M3 8.5h18v11a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 19.5z"/><path d="M9 8.5V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5v3"/><path d="M3 13h18"/>',
  reports:   '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  plus:      '<path d="M12 5v14M5 12h14"/>',
  gear:      '<circle cx="12" cy="12" r="3.2"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.56V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.11-1.56 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.56-1H3a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 4.6 8.9a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.6h.08A1.7 1.7 0 0 0 10 3.04V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.56 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9v.08a1.7 1.7 0 0 0 1.56 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  back:      '<path d="M19 12H5"/><path d="M12 19l-7-7 7-7"/>',
  close:     '<path d="M18 6 6 18M6 6l12 12"/>',
  chevR:     '<path d="M9 18l6-6-6-6"/>',
  chevD:     '<path d="M6 9l6 6 6-6"/>',
  chevU:     '<path d="M6 15l6-6 6 6"/>',
  arrowIn:   '<path d="M12 5v14"/><path d="m5 12 7 7 7-7"/>',
  arrowOut:  '<path d="M12 19V5"/><path d="m5 12 7-7 7 7"/>',
  swap:      '<path d="M7 4v13"/><path d="m4 14 3 3 3-3"/><path d="M17 20V7"/><path d="m14 10 3-3 3 3"/>',
  wallet:    '<path d="M3 8.5A2.5 2.5 0 0 1 5.5 6H19a2 2 0 0 1 2 2v9a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17z"/><path d="M3 8.5V7a2 2 0 0 1 2-2h11"/><circle cx="17" cy="12.5" r="1.2"/>',
  bank:      '<path d="M3 10h18"/><path d="m12 3 9 5H3z"/><path d="M6 10v7M10 10v7M14 10v7M18 10v7"/><path d="M3 20h18"/>',
  phone:     '<rect x="6" y="2.5" width="12" height="19" rx="2.5"/><path d="M10.5 18.5h3"/>',
  camera:    '<path d="M4 8.5h3l1.5-2.2h7L17 8.5h3a1.5 1.5 0 0 1 1.5 1.5v8A1.5 1.5 0 0 1 20 19.5H4A1.5 1.5 0 0 1 2.5 18v-8A1.5 1.5 0 0 1 4 8.5z"/><circle cx="12" cy="13.5" r="3.4"/>',
  cloud:     '<path d="M17.5 18.5H7a4.5 4.5 0 0 1-.6-8.96 6 6 0 0 1 11.5 1.7 3.63 3.63 0 0 1-.4 7.26z"/>',
  cloudOff:  '<path d="M17.5 18.5H7a4.5 4.5 0 0 1-.6-8.96 6 6 0 0 1 8.4-2.9"/><path d="m3 3 18 18"/>',
  clock:     '<circle cx="12" cy="12" r="9"/><path d="M12 7v5.2l3.2 2"/>',
  repeat:    '<path d="M17 2.5 20.5 6 17 9.5"/><path d="M3.5 12V9.5A3.5 3.5 0 0 1 7 6h13.5"/><path d="M7 21.5 3.5 18 7 14.5"/><path d="M20.5 12v2.5a3.5 3.5 0 0 1-3.5 3.5H3.5"/>',
  tag:       '<path d="M20.6 12.6 12.6 20.6a2 2 0 0 1-2.83 0l-6.4-6.4A2 2 0 0 1 2.8 12.8V4.8A2 2 0 0 1 4.8 2.8h8a2 2 0 0 1 1.4.58l6.4 6.4a2 2 0 0 1 0 2.83z"/><circle cx="7.8" cy="7.8" r="1.3"/>',
  user:      '<circle cx="12" cy="8" r="3.7"/><path d="M4.5 20.5a7.5 7.5 0 0 1 15 0"/>',
  mail:      '<rect x="2.5" y="5" width="19" height="14" rx="2.5"/><path d="m3.5 7 8.5 6 8.5-6"/>',
  fingerprint: '<path d="M12 2.5a9.5 9.5 0 0 0-9.5 9.5c0 2.6.6 4.2 1.3 5.7"/><path d="M12 2.5A9.5 9.5 0 0 1 21.5 12c0 1.2-.1 2.1-.3 3"/><path d="M6.5 21a14 14 0 0 1-1.7-5.7"/><path d="M12 6a6 6 0 0 0-6 6c0 2.4.5 3.9 1.1 5.2"/><path d="M12 6a6 6 0 0 1 6 6c0 .9-.05 1.6-.15 2.3"/><path d="M9 21a11 11 0 0 1-1.4-4"/><path d="M12 10a2 2 0 0 0-2 2c0 3.5 1 6.4 2.2 8.4"/><path d="M12 10a2 2 0 0 1 2 2c0 1.7-.2 3-.5 4.1"/>',
  note:      '<path d="M5 3.5h14v17l-3-2-2 2-2-2-2 2-2-2-3 2z"/><path d="M9 8h6M9 12h6"/>',
  download:  '<path d="M12 3v12"/><path d="m7 11 5 5 5-5"/><path d="M4 20h16"/>',
  upload:    '<path d="M12 20V8"/><path d="m7 12 5-5 5 5"/><path d="M4 4h16"/>',
  lock:      '<rect x="4.5" y="10" width="15" height="10.5" rx="2.2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
  trash:     '<path d="M4 7h16"/><path d="M9.5 7V5.2A1.2 1.2 0 0 1 10.7 4h2.6a1.2 1.2 0 0 1 1.2 1.2V7"/><path d="M6.5 7 7.6 20a1.4 1.4 0 0 0 1.4 1.3h6a1.4 1.4 0 0 0 1.4-1.3L17.5 7"/>',
  edit:      '<path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4z"/>',
  check:     '<path d="m4.5 12.5 5 5 10-11"/>',
  alert:     '<path d="M12 3.5 22 20H2z"/><path d="M12 10v4.5M12 17.4v.1"/>',
  search:    '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
  filter:    '<path d="M3 6h18M6.5 12h11M10 18h4"/>',
  sparkle:   '<path d="M12 3.5 13.9 9l5.6 1.9-5.6 1.9L12 18.4l-1.9-5.6L4.5 11 10.1 9z"/><path d="M18.5 3v3M20 4.5h-3"/>',
  drive:     '<path d="m8.4 3.5 7.2 12.5"/><path d="M15.6 3.5H8.4L1.5 16h7.2z"/><path d="M22.5 16H8.7l3.6-6.2"/>',
  chart:     '<path d="M21 21H3V3"/><path d="m7 15 4-4 3 3 5-6"/>',
  box:       '<path d="m12 2.5 8.5 4.7v9.6L12 21.5 3.5 16.8V7.2z"/><path d="M3.5 7.2 12 12l8.5-4.8M12 12v9.5"/>',
  inbox:     '<path d="M3.5 13.5h4l1.5 3h6l1.5-3h4"/><path d="M5.4 4.5h13.2l3.4 9V18a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-4.5z"/>',
  percent:   '<circle cx="7" cy="7" r="2.6"/><circle cx="17" cy="17" r="2.6"/><path d="M19 5 5 19"/>',
  /* The production line, left to right: a bench to make it on, the
     hands it is farmed out to, the clipboard it is checked against,
     the lorry it leaves on, and the crate it ends up in. */
  anvil:     '<path d="M3.5 8.5h11l3 3h3"/><path d="M3.5 8.5v3a4 4 0 0 0 4 4h3l-1.5 3.5h7L14.5 15.5"/><path d="M6 19h12"/>',
  hands:     '<circle cx="9" cy="7.5" r="3"/><path d="M2.5 20v-1.2A5.3 5.3 0 0 1 7.8 13.5h2.4"/><circle cx="17" cy="10.5" r="2.4"/><path d="M12.5 20v-.8a4.5 4.5 0 0 1 4.5-4.5 4.5 4.5 0 0 1 4.5 4.5v.8"/>',
  clipboard: '<path d="M9 4.5H7A1.5 1.5 0 0 0 5.5 6v13A1.5 1.5 0 0 0 7 20.5h10a1.5 1.5 0 0 0 1.5-1.5V6A1.5 1.5 0 0 0 17 4.5h-2"/><rect x="9" y="2.5" width="6" height="4" rx="1.3"/><path d="m9.5 13 2 2 3.5-4"/>',
  truck:     '<path d="M2.5 6.5h11v10h-11z"/><path d="M13.5 10h4l4 3.5v3h-8z"/><circle cx="7" cy="18.5" r="1.8"/><circle cx="17" cy="18.5" r="1.8"/>',
  archive:   '<rect x="2.5" y="3.5" width="19" height="4.5" rx="1.3"/><path d="M4.5 8v11a1.5 1.5 0 0 0 1.5 1.5h12a1.5 1.5 0 0 0 1.5-1.5V8"/><path d="M9.5 12h5"/>',
  menu:      '<path d="M3.5 6.5h17M3.5 12h17M3.5 17.5h17"/>',
};

/** icon('home', 22) -> svg string */
export function icon(name, size = 22, stroke = 1.6) {
  const d = P[name] || P.box;
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none"
    stroke="currentColor" stroke-width="${stroke}" stroke-linecap="round"
    stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
}

export const ICON_NAMES = Object.keys(P);
