// Einheitliche Liniensymbole (SF-Symbols-ähnlich) statt Emojis
const svg = (body, extra = '') => `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"${extra}>${body}</svg>`;
export const ICON = {
  train: svg('<rect x="5.5" y="3" width="13" height="14" rx="4"/><path d="M5.5 10.5h13M9 21l1.4-3.5M15 21l-1.4-3.5"/><circle cx="9" cy="13.8" r="1" fill="currentColor" stroke="none"/><circle cx="15" cy="13.8" r="1" fill="currentColor" stroke="none"/>'),
  station: svg('<path d="M6 21V4h10l-1.8 3.6L16 11H6"/>'),
  me: svg('<circle cx="12" cy="12" r="3.6" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="8"/>'),
  home: svg('<path d="M4 11.2 12 4l8 7.2V20h-5.5v-5.5h-5V20H4z"/>'),
  car: svg('<path d="M4.5 16.5V12l2-5.2c.2-.5.7-.8 1.2-.8h8.6c.5 0 1 .3 1.2.8l2 5.2v4.5z"/><path d="M4.5 12h15"/><circle cx="8" cy="16.5" r="1.7"/><circle cx="16" cy="16.5" r="1.7"/>'),
  bike: svg('<circle cx="6" cy="16" r="3.6"/><circle cx="18" cy="16" r="3.6"/><path d="M6 16l4-7h5l3 7M10 9l3 7h-7M14 5h3"/>'),
  foot: svg('<circle cx="13" cy="4.5" r="1.8"/><path d="M10 21l2.2-6.3L15 17v4M12.2 14.7 12.8 9l-3.3 1.6L8 14M12.8 9l2.5 3 2.7.8"/>'),
  chevronUp: svg('<path d="M6 15l6-6 6 6"/>'),
  chevronDown: svg('<path d="M6 9l6 6 6-6"/>'),
  swap: svg('<path d="M7 7h11l-3-3M17 17H6l3 3"/>'),
};
