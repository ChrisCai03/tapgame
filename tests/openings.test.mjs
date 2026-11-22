import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {openingFromId, openingId, openingProof, OPENING_COUNT} from '../dist/studio/openings.mjs';
import {execFileSync} from 'node:child_process';
import {readTables} from '../dist/studio/policy.mjs';
import {inspect, replay, step, key, code, edges, next, drop, N, H, ids} from '../dist/studio/rules.mjs';
const certificates = fs.readFileSync(new URL('../dist/studio/assets/opening-proofs.bin', import.meta.url));

test('every named full opening round-trips, including either starting seat', () => {
  assert.equal(OPENING_COUNT, 54450);
  for (let id=0; id<OPENING_COUNT; id++) {
    const start=openingFromId(id);
    assert.equal(openingId(start), id);
    for (const digits of [start.a,start.b]) {
      assert.ok(digits[0] >= 1 && digits[0] <= digits[1] && digits[1] <= digits[2] && digits[2] <= 9);
    }
  }
  assert.throws(() => openingFromId(54450));
  assert.throws(() => openingFromId(-1));
});

test('opening certificates use mover perspective and provide legal first moves for winning roots', () => {
  const counts = {A:0, B:0, unknown:0};
  for(let id=0; id<OPENING_COUNT; id+=2){
    const start=openingFromId(id), proof=openingProof(start, certificates);
    counts[proof?.winner || 'unknown']++;
    if(proof?.move) assert.ok(start.a.includes(Math.floor(proof.move/10)) && start.b.includes(proof.move%10));
    const swapped=openingProof({a:start.b,b:start.a,turn:'B'},certificates);
    if(proof) assert.deepEqual(swapped,{...proof,winner:proof.winner==='A'?'B':'A'});
    else assert.equal(swapped,null);
  }
  assert.deepEqual(counts,{A:2681,B:100,unknown:24444});
  assert.equal(openingProof(openingFromId(0),certificates),null);
  assert.equal(openingProof(openingFromId(86),certificates).winner,'B');
  const start=openingFromId(27040), pos=replay({start});
  assert.deepEqual(openingProof(start,certificates),{winner:'A',short:true,move:37});
  for(const move of ['37','73','37','73','37']){
    assert.deepEqual(inspect(pos).legal,[move]); step(pos,move);
  }
  assert.deepEqual(inspect(pos).result,{winner:'A',reason:'clearance'});
});


test('every published proof and its winning move survive a separate traversal of the browser rules', () => {
  const file = fs.readFileSync(new URL('../dist/studio/assets/tables.bin', import.meta.url));
  const {cert} = readTables(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength));
  const seen = new Uint8Array(N);
  function check(state, turn, depth, useEndgames, witness) {
    if (state % H === 0) return -1;
    const legal = edges(state, turn, seen);
    if (!legal.length) return -1;
    if (!depth) return 0;
    const outcomes = [];
    for (const edge of legal) {
      if (witness && code[edge] !== witness) continue;
      const successor = next[edge], named = key(successor, 1-turn);
      seen[named] = 1;
      const sign = (useEndgames && drop(edge) && cert[successor]) ||
        check(successor, 1-turn, depth-1, useEndgames);
      seen[named] = 0;
      outcomes.push(-sign);
    }
    return Math.max(...outcomes);
  }
  for (let id = 0; id < OPENING_COUNT; id += 2) {
    const start = openingFromId(id), proof = openingProof(start, certificates);
    if (!proof) continue;
    const state = ids[Number(start.a.join(''))] * H + ids[Number(start.b.join(''))];
    seen[state] = 1;
    assert.equal(check(state, 0, proof.short ? 6 : 2, !proof.short, proof.move),
      proof.winner === 'A' ? 1 : -1, 'opening #'+id);
    seen[state] = 0;
  }
});

test('released v2 choices match the frozen engine on 120 mixed random openings', {
  skip: !(process.env.TAPGAME_NATIVE && process.env.TAPGAME_FROZEN)
}, () => {
  const requests = Array.from({length:120}, (_,i) => {
    const start = openingFromId((7919*i+953) % OPENING_COUNT);
    return (31000+i)+' - '+start.turn+start.a.join('')+start.b.join('');
  }).join('\n')+'\n';
  const choices = engine => execFileSync(engine, ['choose','model/values.txt','v2/values.txt','500000','12','18'],
    {input:requests, encoding:'utf8'}).trim().split('\n');
  const current = choices(process.env.TAPGAME_NATIVE);
  assert.equal(current.length, 120);
  assert.deepEqual(current, choices(process.env.TAPGAME_FROZEN));
});

test('replay the 1,000 random-start records with the drawn board and named seats', () => {
  const text = fs.readFileSync(new URL('../dist/data/random-openings-v2-v1.csv', import.meta.url),'utf8');
  const rows = text.trim().split(/\r?\n/).slice(1);
  const pairs = new Map();
  assert.equal(rows.length, 1000);
  for (const row of rows) {
    const [, , first, result, reason, plies, , trace, raw, pair, opening] = row.split(',');
    const start = openingFromId(Number(opening));
    assert.equal(raw, start.turn+start.a.join('')+start.b.join(''));
    const p = replay({start, trace});
    const end = inspect(p).result;
    const other = start.turn === 'A' ? 'B' : 'A';
    assert.equal(p.ply, Number(plies));
    assert.equal(end.reason, {cleared:'clearance', blocked:'blockade', timeout:'timeout'}[reason]);
    assert.equal(end.winner, result === 'draw' ? null : (result === 'win') === (first === '1') ? start.turn : other);
    const previous = pairs.get(pair);
    if (previous) {
      assert.equal(previous.opening, opening);
      assert.notEqual(previous.first, first);
    } else pairs.set(pair, {opening,first});
  }
  assert.equal(pairs.size, 500);
});
