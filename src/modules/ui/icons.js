// Inline SVG glyph set for the HUD. 24-unit viewBox, stroke-based, currentColor.
// All glyphs share stroke width / caps so the HUD reads as one icon family.
const P = {
  select:   'M5.5 3.5l14 7.5-6.2 1.6L9.8 19.5 5.5 3.5z',
  road:     'M4.5 20l4.5-16M19.5 20L15 4M12 5.5v2.5M12 11v3M12 17v3',
  zone:     'M4 4h16v16H4zM4 12h16M12 4v16',
  terrain:  'M3 19l6-10 3.5 5.5L15 11l6 8H3z',
  bulldoze: 'M3.5 15.5V10h7l3 4h3.5M18.5 9v7M3.5 15.5h14',
  alley:    'M9.5 4v16M14.5 4v16',
  local:    'M7 4v16M17 4v16M12 5v3M12 10.5v3M12 16v3',
  avenue:   'M4.5 4v16M19.5 4v16M12 4v16M8.2 5.5v2.5M8.2 11v2.5M8.2 16.5v2.5M15.8 5.5v2.5M15.8 11v2.5M15.8 16.5v2.5',
  highway:  'M3 4v16M21 4v16M10.8 4v16M13.2 4v16M7 5.5v2.5M7 11v2.5M7 16.5v2.5M17 5.5v2.5M17 11v2.5M17 16.5v2.5',
  raise:    'M3 20l5.5-7 3.5 4 2.5-3L21 20H3zM12 3.5v6.5M9 6.5l3-3 3 3',
  lower:    'M3 20l5.5-7 3.5 4 2.5-3L21 20H3zM12 10V3.5M9 7l3 3 3-3',
  flatten:  'M3.5 17.5h17M3.5 21h17M12 3v10.5M8.5 10l3.5 3.5L15.5 10',
  smooth:   'M2.5 15c3-7 6.5-7 9.5 0s6.5 7 9.5 0M3 20h18',
  pause:    'M8 5v14M16 5v14',
  play:     'M7 4.5l12 7.5-12 7.5v-15z',
  fast2:    'M4 5l7 7-7 7M13 5l7 7-7 7',
  fast3:    'M2.5 6l6 6-6 6M9.5 6l6 6-6 6M16.5 6l6 6-6 6',
  sun:      'M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4',
  moon:     'M20 14.2A8 8 0 1 1 9.8 4a6.4 6.4 0 0 0 10.2 10.2z',
  cloud:    'M7 18.5h10.5a4 4 0 0 0 .3-8A6 6 0 0 0 6.2 12 3.3 3.3 0 0 0 7 18.5z',
  rain:     'M7 15h10.5a3.6 3.6 0 0 0 .3-7.2A5.6 5.6 0 0 0 6.6 9.2 3 3 0 0 0 7 15zM8.5 18l-1 2.5M12.5 18l-1 2.5M16.5 18l-1 2.5',
  fog:      'M7 13.5h10.5a3.6 3.6 0 0 0 .3-7.2A5.6 5.6 0 0 0 6.6 7.7 3 3 0 0 0 7 13.5zM4 17.5h16M6.5 21h11',
  gear:     'M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1',
  coin:     'M6.5 6.5l2 2M17.5 6.5l-2 2M6.5 17.5l2-2M17.5 17.5l-2-2',
  people:   'M3.5 20a5.5 5.5 0 0 1 11 0M15.5 4.6a3.5 3.5 0 0 1 0 6.8M21 20a5.5 5.5 0 0 0-3.8-5.2',
  calendar: 'M3.5 5.5h17v15h-17zM3.5 10.5h17M8 3v4.5M16 3v4.5',
  clock:    'M12 7.5V12l3 2',
  briefcase:'M3.5 7.5h17v12h-17zM9 7.5V5.5a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 5.5v2M3.5 13h17',
  smile:    'M8.5 14.5a4.5 4.5 0 0 0 7 0',
  meh:      'M8.5 15h7',
  frown:    'M8.5 16a4.5 4.5 0 0 1 7 0',
  percent:  'M19 5L5 19',
  info:     'M12 11v5.5M12 7.8v.01',
  check:    'M5 12.5l4.5 4.5L19 7',
  warning:  'M12 3.5l9.5 17h-19zM12 10v4.5M12 17.5v.01',
  error:    'M9 9l6 6M15 9l-6 6',
  close:    'M6 6l12 12M18 6L6 18',
  activity: 'M2.5 12h4l3-7.5 5 15 3-7.5h4',
  hash:     'M5 9.5h14M5 14.5h14M10 3.5l-2 17M16 3.5l-2 17',
  reload:   'M20 12a8 8 0 1 1-2.4-5.7M20 4v5h-5',
  city:     'M3 20.5h18M5 20.5V9l4-2v13.5M9 20.5V12h4v8.5M13 20.5V6l6-2.5v17M16 8v.01M16 11v.01M16 14v.01',
  cursorcost:'M4 4h16v10H4zM8 18h8',
  minus:    'M6 12h12',
  plus:     'M12 6v12M6 12h12',
  chevron:  'M8 10l4 4 4-4',
  eye:      'M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6z',
};
// Extra shapes (circles) per glyph, drawn after the path.
const C = {
  sun: [[12, 12, 4]], gear: [[12, 12, 3.8]], coin: [[12, 12, 8.5], [12, 12, 4.2]], people: [[9, 8.5, 3.5]],
  clock: [[12, 12, 8.5]], smile: [[12, 12, 8.5], [9.3, 10, 0.9], [14.7, 10, 0.9]], meh: [[12, 12, 8.5], [9.3, 10, 0.9], [14.7, 10, 0.9]],
  frown: [[12, 12, 8.5], [9.3, 10, 0.9], [14.7, 10, 0.9]], percent: [[7, 7, 2.6], [17, 17, 2.6]], info: [[12, 12, 8.5]],
  error: [[12, 12, 8.5]], bulldoze: [[6.5, 19, 1.6], [13.5, 19, 1.6]], eye: [[12, 12, 3]],
};
const FILLED = new Set(['select', 'play']);

export function icon(name, size = 16, cls = '') {
  const d = P[name] || P.info;
  const circles = (C[name] || []).map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}"${r < 1 ? ' fill="currentColor" stroke="none"' : ''}/>`).join('');
  const fill = FILLED.has(name) ? 'currentColor' : 'none';
  return `<svg class="ico ${cls}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="${fill}" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/>${circles}</svg>`;
}
export const WEATHER_ICON = { clear: 'sun', overcast: 'cloud', rain: 'rain', fog: 'fog' };
