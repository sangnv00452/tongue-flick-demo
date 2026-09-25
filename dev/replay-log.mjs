// Replays a test log recorded on a phone (Copy / Share test log on the results screen) through the
// lick counter, so a counting problem can be seen and a fix tried on real frames.
//
//   node dev/replay-log.mjs <log file> [--strokeLen=0.3 --releaseMs=120 ...] [--timeline]
//
// Prints the round's summary, each lick as recorded and as replayed (with the options given), and
// with --timeline one line per 100 ms: tongue points, points inside the candy, the touch point and
// the counter's state, so what the tracker saw during each lick can be read.
import { readFileSync } from 'node:fs';
import { createLickCounter } from '../src/lick-counter.js';
import { parseTestLog } from '../src/test-log.js';

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
if (!file) {
  console.error('usage: node dev/replay-log.mjs <log file> [--option=value ...] [--timeline]');
  process.exit(1);
}
const options = Object.fromEntries(
  args.filter((a) => a.startsWith('--') && a.includes('=')).map((a) => {
    const [k, v] = a.slice(2).split('=');
    return [k, Number(v)];
  }),
);
const { meta, frames } = parseTestLog(readFileSync(file, 'utf8'));

const fmt = (v) => (v === null ? '   -' : v.toFixed(2).padStart(5));
const span = frames.length ? frames.at(-1).t - frames[0].t : 0;
console.log(`round: ${frames.length} frames over ${(span / 1000).toFixed(1)} s (${((frames.length / span) * 1000).toFixed(1)} fps)`);
console.log(`meta: ${JSON.stringify(meta)}`);
const faceLost = frames.filter((f) => !f.face).length;
const withTongue = frames.filter((f) => f.pts >= 3).length;
const touching = frames.filter((f) => f.in >= 3).length;
console.log(`face lost ${faceLost} frames, tongue seen ${withTongue}, tongue on the candy ${touching}`);
const recorded = frames.filter((f) => f.lick);
console.log(`\nrecorded licks: ${recorded.length}`);
for (const f of recorded) console.log(`  ${(f.t / 1000).toFixed(2)} s  ${f.lick}`);

const c = createLickCounter(options);
const replayed = [];
for (const f of frames) {
  if (!f.face) continue;
  const contact = f.cx === null ? null : { x: f.cx, y: f.cy };
  const r = c.update({ t: f.t, tonguePoints: f.pts ?? 0, pointsInside: f.in ?? 0, contact });
  if (r.lick) replayed.push({ t: f.t, reason: r.reason });
}
console.log(`\nreplayed licks${Object.keys(options).length ? ` with ${JSON.stringify(options)}` : ''}: ${replayed.length}`);
for (const l of replayed) console.log(`  ${(l.t / 1000).toFixed(2)} s  ${l.reason}`);

if (args.includes('--timeline')) {
  console.log('\n   time  pts   in     cx     cy     tx     ty  out touch lick');
  let next = 0;
  for (const f of frames) {
    if (f.t < next && !f.lick) continue;
    next = f.t + 100;
    console.log(`${(f.t / 1000).toFixed(2).padStart(7)} ${String(f.pts ?? '-').padStart(4)} ${String(f.in ?? '-').padStart(4)} ${fmt(f.cx)}  ${fmt(f.cy)}  ${fmt(f.tx)}  ${fmt(f.ty)}  ${f.out ? ' out' : '  in'} ${f.touch ? '  yes' : '   no'} ${f.face ? f.lick ?? '' : 'face lost'}`);
  }
}
