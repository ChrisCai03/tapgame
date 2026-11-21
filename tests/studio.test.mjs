import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {OPEN, checkStart, replay, inspect, terminal, step, QUIET} from '../dist/studio/rules.mjs';
import {readTables, estimate} from '../dist/studio/policy.mjs';
import {respond} from '../dist/studio/protocol.mjs';
import {branch, importStudy, createStudy} from '../dist/studio/study.mjs';
const root = new URL('../', import.meta.url);
const file = p => fs.readFileSync(new URL(p, root));
const binary = file('dist/studio/assets/tables.bin'), tables = readTables(binary.buffer.slice(binary.byteOffset, binary.byteOffset+binary.byteLength));
const model = JSON.parse(file('dist/studio/assets/wdl.json'));
const request = (cmd, fields = {}) => respond({v:1, id:1, cmd, ...fields}, tables, model);
function ask(cmd, fields) {
  const reply = request(cmd, fields);
  assert.equal(reply.ok, true, JSON.stringify(reply.error));
  return reply.result;
}
const records = name => file('dist/data/'+name+'.csv').toString().trim().split(/\r?\n/).slice(1).map(line => line.split(','));
const games = records('v2-v1'), trace = games[0][7];

test('replay all 10,000 completed records against archived referee results', () => {
    let count = 0;
    for (const set of ['v2-v1', 'v2-equal', 'v2-equal-nodes', 'random', 'heuristic']) {
      for (const [id, seed, first, result, reason, plies, drops, line] of records(set)) {
        const p = replay({trace:line}), end = terminal(p), bot = first === '1'?'A':'B';
        assert.equal(p.ply, Number(plies));
        assert.equal(end.reason, {blocked:'blockade', cleared:'clearance', timeout:'timeout'}[reason]);
        assert.equal(end.winner, result === 'draw'?null:result === 'win'?bot:bot === 'A'?'B':'A');
        count++;
      }
    }
    assert.equal(count, 10000);
  });
test('game-1 repetition, forced win, and jump target depend on exact history', () => {
    const pos = {trace:trace.slice(0, 536)}, r = ask('analyze', {position:pos}), row = r.candidates[0];
    assert.equal(r.proven, 'A');
    assert.equal(r.distance, 3);
    assert.deepEqual(row.pv, ['13', '34', '47']);
    assert.equal(row.end, 'blockade');
    assert.deepEqual(ask('evaluate', {position:pos}).wdl, {A:1, B:0, draw:0, source:'forced'});
    const board = ask('inspect', {position:{trace}});
    assert.deepEqual(board.banned, [{move:'71', repeatPly:260}]);
    assert.deepEqual(board.legal, []);
    const fresh = ask('inspect', {position:{start:{a:board.a, b:board.b, turn:board.turn}}});
    assert.deepEqual(fresh.legal, ['71']);
    assert.equal(request('choose', {position:{trace:trace+'71'}}).ok, false);
  });
test('referee handles clearing, timeouts, custom B-to-move setups and invalid traces', () => {
    const start = {a:[9, 0, 0], b:[0, 1, 0], turn:'B'}, p = replay({start});
    step(p, '19');
    assert.equal(terminal(p).winner, 'B');
    p.quiet = QUIET;
    assert.equal(terminal(p).reason, 'clearance');
    const quiet = replay({});
    quiet.quiet = QUIET;
    assert.equal(terminal(quiet).reason, 'timeout');
    for (const trace of ['9', '13', '00', 'aa'])assert.equal(request('analyze', {position:{trace}}).ok, false);
    assert.throws(() => checkStart({a:[0, 0, 0], b:[0, 0, 0], turn:'A'}));
    assert.equal(request('choose', {limits:{nodes:0}}).ok, false);
    assert.equal(respond({v:2, id:'a', cmd:'hello'}, tables, model).ok, false);
  });
test('branching retains main record and validates exported studies', () => {
    const s = createStudy('archive', OPEN, trace, 12), before = trace.slice(0, 24);
    branch(s, ['24']);
    assert.equal(s.active, 1);
    assert.equal(s.lines[0], trace);
    assert.equal(s.lines[1], before+'24');
    s.ply = 12;
    branch(s, [trace.slice(24, 26)]);
    assert.equal(s.active, 0);
    assert.deepEqual(importStudy(JSON.parse(JSON.stringify(s))).lines, s.lines);
    assert.throws(() => importStudy({...s, lines:['99']}));
  });
test('seeded simulations are chunk-invariant; forced games agree for every supplied policy', () => {
    const opts = {policyA:'guided', policyB:'random', seed:337, position:{trace:'1112'}};
    const a = ask('simulate', {...opts, games:17}), b = ask('simulate', {...opts, games:9}), c = ask('simulate', {...opts, seed:(337+Math.imul(9, 2654435761))>>>0, games:8});
    for (const k of ['A', 'draw', 'B'])assert.equal(a.counts[k], b.counts[k]+c.counts[k]);
    for (const policyA of ['v2', 'v1', 'guided', 'random', 'heuristic']) {
      const r = ask('simulate', {position:{trace:trace.slice(0, 536)}, policyA, policyB:'v2', games:4});
      assert.equal(r.counts.A, 4);
    }
  });
test('exported WDL predictor reproduces untouched test-set metrics', {skip:!process.env.TAPGAME_WDL_SAMPLES}, () => {
    const lines = fs.readFileSync(process.env.TAPGAME_WDL_SAMPLES, 'utf8').trim().split('\n').slice(51000);
    let total = 0;
    for (const line of lines) {
      const row = line.split(',').map(Number), x = row.slice(1, -1), target = row.at(-1);
      let logit = model.base;
      for (const tree of model.trees) {
        let i = 0;
        while (tree[i][0]>=0) {
          const [f, n, a, b] = tree[i];
          i = x[f]<=n?a:b;
        }
        logit += tree[i][1];
      }
      const w = (1-model.draw)/(1+Math.exp(-model.slope*logit-model.intercept));
      total += (w-Number(target === 1))**2+(model.draw-Number(target === 0))**2+(1-w-model.draw-Number(target === -1))**2;
    }
    assert.equal(lines.length, 9000);
    assert.ok(Math.abs(total/9000-model.metadata.testBrier)<1e-10);
  });
test('all 891 independently checked small fresh positions have the native winner', {skip:!process.env.TAPGAME_NATIVE}, () => {
    const data = execFileSync(process.env.TAPGAME_NATIVE, ['small-table', 'model/values.txt', 'v2/values.txt'], {encoding:'utf8'}).trim().split('\n');
    assert.equal(data.length, 891);
    for (const line of data) {
      const [a, b, sign] = line.split(','), pos = {start:{a:[...a].map(Number), b:[...b].map(Number), turn:'A'}};
      const result = ask('analyze', {position:pos, limits:{nodes:800, depth:3}});
      assert.equal(result.proven, sign === '1'?'A':'B', line);
    }
  });
test('cross-engine full-window scores, proofs, PVs and frozen choices on 180 real prefixes', {skip:!process.env.TAPGAME_NATIVE}, () => {
    const samples = Array.from({length:180}, (_, i) => {
        const row = games[(i*29)%games.length], taps = Math.min(Number(row[5])-1, i<60?i%20:(i*37)%Number(row[5]));
        return {seed:i*993+7, trace:row[7].slice(0, taps*2)};
      });
    const run = (exe, mode, nodes, depth) => execFileSync(exe, [mode, 'model/values.txt', 'v2/values.txt', String(nodes), '12', String(depth)], {input:samples.map(r => r.seed+' '+r.trace).join('\n')+'\n', encoding:'utf8', maxBuffer:16e6}).trim().split('\n');
    const native = run(process.env.TAPGAME_NATIVE, 'analyze', 4500, 9);
    const choices = run(process.env.TAPGAME_FROZEN || process.env.TAPGAME_NATIVE, 'choose', 500000, 18);
    for (const [i, s] of samples.entries()) {
      const expected = JSON.parse(native[i]), r = ask('analyze', {position:s, limits:{nodes:4500, depth:9}});
      for (const k of ['turn', 'depth', 'nodes', 'recommended', 'proven', 'distance', 'candidates']) assert.deepEqual(r[k], expected[k], i+' '+k);
      const choice = ask('choose', {position:s, seed:s.seed});
      assert.equal(choice.move, choices[i].replace(/ /g, ''), 'Frozen choice '+i);
      for (const row of r.candidates)replay({trace:s.trace+row.pv.join('')});
    }
  });
test('browser v1 chooses the archived v1 tap on 72 sampled tournament turns', () => {
    for (let i = 0; i<72; i++) {
      const row = games[i*53], taps = Number(row[5]), parity = Number(row[2]);
      const ply = 2*((i*11)%Math.floor((taps-parity+1)/2))+parity;
      const r = ask('choose', {engine:'v1', position:{trace:row[7].slice(0, ply*2)}});
      assert.equal(r.move, row[7].slice(ply*2, ply*2+2), 'game '+row[0]+' tap '+ply);
    }
  });
