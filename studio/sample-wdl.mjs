// One randomly selected nonterminal position per complete game. Split by game ID.
import fs from 'node:fs';
import {initial, edges, advance, terminal} from '../dist/studio/rules.mjs';
import {readTables, rng, simpleMove, features} from '../dist/studio/policy.mjs';
const data = fs.readFileSync(new URL('../dist/studio/assets/tables.bin', import.meta.url));
const tables = readTables(data.buffer.slice(data.byteOffset, data.byteOffset+data.byteLength));
const count = Number(process.argv[2] || 60000), out = fs.openSync(process.argv[3] || 'wdl-samples.csv', 'w');
let batch = '';
for (let g = 0; g<count; g++) {
  const seed = (2731001+g)>>>0, random = rng(seed), sample = rng(seed^0xcd289b71);
  const p = initial();
  let chosen, side, end;
  while (!(end = terminal(p))) {
    if (sample()<1/(p.ply+1)) {
      chosen = features(p, tables);
      side = p.t;
    }
    const legal = edges(p.s, p.t, p.seen);
    advance(p, simpleMove('guided', p, legal, random, tables));
  }
  const y = end.winner === null?0:(end.winner === (side?'B':'A')?1:-1);
  batch += [g, ...chosen, y].join(',')+'\n';
  if ((g+1)%500 === 0) {
    fs.writeSync(out, batch);
    batch = '';
  }
}
fs.writeSync(out, batch);
fs.closeSync(out);
