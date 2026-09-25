// Records one round frame by frame, so a test on a phone can be sent back as text and replayed
// offline: `node dev/replay-log.mjs <log>` runs the recorded frames through the lick counter.
// Positions are in candy radii from the candy's centre (x right, y down), like the lick counter.
//
// Format: a `#tongue-flick-log <json meta>` line, a header line, then one CSV row per frame.
// Columns: t = ms since the round started; face = face found (1/0); pts = tongue-shape points;
// in = points inside the candy; cx,cy = touch point; mx,my = mouth centre; tx,ty = tongue tip
// (the tongue point farthest from the mouth); r = candy radius in px; fill = mouth-fill cue;
// out, touch = the counter's state (1/0); lick = why a lick scored (flick, touch, stroke) or empty.

export const LOG_HEADER = '#tongue-flick-log';
export const LOG_COLUMNS = ['t', 'face', 'pts', 'in', 'cx', 'cy', 'mx', 'my', 'tx', 'ty', 'r', 'fill', 'out', 'touch', 'lick'];

const cell = (v) => (v === null || v === undefined ? '' : typeof v === 'boolean' ? (v ? 1 : 0) : typeof v === 'number' ? +v.toFixed(2) : v);

export function createTestLog() {
  let meta = null;
  let rows = [];
  return {
    /** Starts a new round, forgetting the last one. */
    begin(m) {
      meta = m;
      rows = [];
    },
    /** One frame: an object with the LOG_COLUMNS keys (missing = empty). */
    frame(row) {
      if (meta) rows.push(LOG_COLUMNS.map((k) => cell(row[k])).join(','));
    },
    get frames() {
      return rows.length;
    },
    text() {
      return meta ? [`${LOG_HEADER} ${JSON.stringify(meta)}`, LOG_COLUMNS.join(','), ...rows].join('\n') + '\n' : '';
    },
  };
}

/** Parses a log back: { meta, frames } with numbers as numbers and empty cells as null. */
export function parseTestLog(text) {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  const first = lines.findIndex((l) => l.startsWith(LOG_HEADER));
  if (first < 0) throw new Error(`not a tongue-flick log: no ${LOG_HEADER} line`);
  const meta = JSON.parse(lines[first].slice(LOG_HEADER.length));
  const columns = lines[first + 1].split(',');
  const frames = lines.slice(first + 2).map((line) => {
    const cells = line.split(',');
    return Object.fromEntries(columns.map((k, i) => {
      const v = cells[i] ?? '';
      return [k, v === '' ? null : Number.isNaN(Number(v)) ? v : Number(v)];
    }));
  });
  return { meta, frames };
}
