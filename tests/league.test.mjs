import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {openingFromId} from '../dist/studio/openings.mjs';
import {replay, terminal} from '../dist/studio/rules.mjs';

const file = path => fs.readFileSync(new URL('../dist/data/'+path,import.meta.url),'utf8');
const rows = path => file(path).trimEnd().split(/\r?\n/).slice(1).map(line=>line.split(','));

test('general match runner reproduces frozen standard-start records for all four policies', {
  skip: !process.env.TAPGAME_NATIVE
}, () => {
  for (const [suite, first, second] of [['v2-v1','v2','v1'],['random','v1','random'],['heuristic','v1','heuristic']]) {
    const sample = rows(suite+'.csv').slice(0,8);
    const schedule = sample.map(([id,seed,role])=>[id,seed,role,'A111111'].join(' ')).join('\n')+'\n';
    const result = execFileSync(process.env.TAPGAME_NATIVE,
      ['match-start','model/values.txt','v2/values.txt','500000','12','18',first,second],
      {input:schedule, encoding:'utf8'});
    assert.deepEqual(result.trimEnd().split('\n').slice(1).map(line=>line.split(',').slice(0,8)), sample);
  }
});

test('all round-robin replays match the published counts and the opening-paired schedule', () => {
  const report = JSON.parse(file('league/results.json'));
  assert.equal(report.games,12000);
  assert.equal(report.matches.length,6);
  assert.equal(report.ratings.random.elo,0);
  let standard;
  for (const match of report.matches) {
    const games = rows('league/'+match.first+'-'+match.second+'.csv');
    assert.equal(games.length,2000);
    const schedule = [], totals = {win:0, draw:0, loss:0};
    for (const [, , first, result, reason, taps, , trace, packed, pair, id] of games) {
      const start = openingFromId(Number(id));
      assert.equal(packed,start.turn+start.a.join('')+start.b.join(''));
      const state = replay({start,trace}), outcome = terminal(state);
      const moverWon = (outcome.winner === start.turn);
      assert.equal(taps,String(state.ply));
      assert.equal(outcome.reason,{cleared:'clearance',blocked:'blockade',timeout:'timeout'}[reason]);
      assert.equal(result,outcome.winner === null ? 'draw' : moverWon === (first === '1') ? 'win' : 'loss');
      totals[result]++;
      schedule.push([pair,id,first]);
    }
    if (standard) assert.deepEqual(schedule, standard);
    else standard = schedule;
    for (const key of Object.keys(totals)) assert.equal(match.all[key],totals[key]);
    assert.equal(match.score,(totals.win + totals.draw/2)/games.length);
    const gap = report.ratings[match.first].elo - report.ratings[match.second].elo;
    assert.ok(Math.abs(match.fitted_score - 1/(1+10**(-gap/400))) < 0.0001);
  }
});
