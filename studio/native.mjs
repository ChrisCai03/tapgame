// Adapt the native C++ executable to TGEP/1. Run from the repository root.
import readline from 'node:readline';
import {spawn} from 'node:child_process';
import {checkStart, replay, terminal} from '../dist/studio/rules.mjs';
const exe = process.argv[2] || './engine2';
let runtime;
function close() {
  if (runtime)runtime.child.kill();
  runtime = null;
}
process.on('exit', close);
process.on('SIGTERM', () => {
    close();
    process.exit(0);
  });
function launch(key, cmd, nodes, depth) {
  close();
  const child = spawn(exe, [cmd, 'model/values.txt', 'v2/values.txt', String(nodes), '12', String(depth)], {stdio:['pipe', 'pipe', 'inherit']});
  const lines = readline.createInterface({input:child.stdout})[Symbol.asyncIterator]();
  const ready = new Promise((resolve, reject) => {
      child.once('spawn', resolve);
      child.once('error', reject);
    });
  child.stdin.on('error', () => {});
  child.on('error', () => {});
  runtime = {key, child, lines, ready};
  return runtime;
}
for await(const line of readline.createInterface({input:process.stdin, crlfDelay:Infinity})) {
  let id = null;
  try {
    const r = JSON.parse(line);
    id = r.id;
    if (r.v !== 1 || !(typeof id === 'string' || Number.isSafeInteger(id)))throw Error('Invalid TGEP request.');
    let result;
    if (r.cmd === 'hello') {
      result = {protocol:'TGEP', version:1, engine:'Native Tapgame v2', rulesets:['tap10-3-positional-v1'], commands:['hello', 'choose', 'analyze'], defaultLimits:{depth:18, nodes:500000}};
    } else {
      if (!['choose', 'analyze'].includes(r.cmd))throw Error('Unsupported command.');
      const pos = r.position || {}, p = replay(pos), end = terminal(p), start = checkStart(pos.start);
      const nodes = r.limits?.nodes ?? 500000, depth = r.limits?.depth ?? 18, seed = r.seed ?? 1;
      if (!Number.isInteger(nodes) || nodes<16 || nodes>2000000 || !Number.isInteger(depth) || depth<1 || depth>32 || !Number.isInteger(seed) || seed<0 || seed>0xffffffff)throw Error('Invalid limits or seed.');
      if (end)result = r.cmd === 'choose'?{move:null, terminal:end}:{terminal:end, recommended:null, candidates:[], proven:end.winner, distance:0, nodes:0, depth:0};
      else {
        const key = r.cmd+'/'+nodes+'/'+depth;
        const proc = runtime?.key === key?runtime:launch(key, r.cmd, nodes, depth);
        await proc.ready;
        proc.child.stdin.write([seed, pos.trace || '-', start.turn+start.a.join('')+start.b.join('')].join(' ')+'\n');
        const reply = await proc.lines.next();
        if (reply.done)throw Error('Native engine stopped.');
        result = r.cmd === 'choose'?{move:reply.value.replace(/\s/g, '')}:JSON.parse(reply.value);
      }
    }
    console.log(JSON.stringify({v:1, id, ok:true, result}));
  } catch (e) {
    close();
    console.log(JSON.stringify({v:1, id, ok:false, error:{code:'engine_error', message:e.message}}));
  }
}
close();
