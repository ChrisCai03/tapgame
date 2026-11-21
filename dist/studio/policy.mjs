import {Search} from './search.mjs';
import {N, H, aHand, live, hands, key, code, next, size, drop, terminal, edges, advance} from './rules.mjs';

export function readTables(buffer) {
  const bytes = new Uint8Array(buffer), view = new DataView(buffer);
  if (bytes.length !== 4+12*N || String.fromCharCode(...bytes.slice(0, 4)) !== 'TGS1') throw Error('Unrecognized engine tables.');
  const arrays = Array.from({length:6}, () => new Int16Array(N));
  for (let s = 0; s<N; s++) for (let f = 0; f<6; f++) arrays[f][s] = view.getInt16(4+12*s+2*f, true);
  const [v1, v2, nominal, rank, cert, certRank] = arrays;
  const evaluate = new Int16Array(N);
  for (let s = 0; s<N; s++) evaluate[s] = v2[s]+260*nominal[s];
  return {v1, v2, nominal, rank, cert, certRank, evaluate};
}
// Deterministic across Node and browser workers. Each rollout has its own seed.
export function rng(seed) {
  let s = seed>>>0;
  return () => {
    s = (s+0x6D2B79F5)>>>0;
    let t = Math.imul(s^(s>>>15), s|1);
    t^=t+Math.imul(t^(t>>>7), t|61);
    return ((t^(t>>>14))>>>0)/4294967296;
  };
}
export const rolloutNames = {guided:'Guided 15%', heuristic:'Heuristic', random:'Uniform random'};
export const simNames = {...rolloutNames, v1:'Tapgame v1 · released', v2:'Tapgame v2 · released'};
export function simpleMove(name, p, legal, random, tables) {
  if (legal.length === 1) return legal[0];
  if (name === 'random' || (name === 'guided' && random()<0.15)) return legal[Math.floor(random()*legal.length)];
  if (name !== 'guided' && name !== 'heuristic') throw Error('Unknown rollout policy.');
  let best = -Infinity, chosen = legal[0], ties = 0;
  for (const e of legal) {
    const child = next[e];
    let replies = 0, fatal = false, withdraw = false;
    for (let r = 9*child; r<9*child+size[child]; r++) if (!p.seen[key(next[r], p.t)]) {
      replies++;
      withdraw ||= drop(r);
      fatal ||= next[r]%H === 0;
    }
    let grade = 4*Number(!fatal)+2*Number(!withdraw)+Number(drop(e));
    if (name === 'guided') grade = -tables.evaluate[child]+40*Number(drop(e))-120*Number(withdraw)-3000*Number(fatal);
    if (!replies || !(child%H)) grade = 20000;
    if (grade>best) {
      best = grade;
      chosen = e;
      ties = 1;
    }
    else if (grade === best && random()<1/(++ties)) chosen = e;
  }
  return chosen;
}
export function features(p, tables) {
  const s = p.s, a = aHand(s), b = s%H, legal = edges(s, p.t, p.seen);
  let withdraw = 0, best = -2000, worst = 2000, immediate = 0;
  for (const e of legal) {
    const child = next[e];
    best = Math.max(best, -tables.evaluate[child]);
    worst = Math.min(worst, -tables.evaluate[child]);
    if (drop(e)) withdraw++;
    if (!(child%H) || !edges(child, 1-p.t, p.seen).length) immediate++;
  }
  const digits = [];
  for (const h of [hands[a], hands[b]]) for (let d = 1; d<=9; d++) digits.push(h.reduce((n, x) => n+(x === d), 0));
  return [tables.v2[s], tables.nominal[s], tables.cert[s], live[a], live[b], legal.length, size[s]-legal.length,
    withdraw, immediate, best, worst, Math.min(240, p.quiet), Math.min(480, p.ply), ...digits];
}
export function simulate(p, tables, {games, seed, policyA, policyB}) {
  const traces = new Set(), result = {A:0, draw:0, B:0}, reasons = {clearance:0, blockade:0, timeout:0};
  for (let game = 0; game<games; game++) {
    const q = {...p, seen:p.seen.slice()}, random = rng((seed+Math.imul(game, 2654435761))>>>0);
    let end, path = '';
    while (!(end = terminal(q))) {
      const opts = edges(q.s, q.t, q.seen);
      const policy = q.t?policyB:policyA;
      let edge = opts[0];
      if (opts.length>1) {
        if (policy === 'v1' || policy === 'v2') {
          const limits = policy === 'v1'?{nodes:4500, depth:8}:{nodes:500000, depth:18};
          const picked = new Search(tables, policy, q, limits).choose(Math.floor(random()*4294967296));
          edge = opts.find(e => String(code[e]) === picked);
        } else edge = simpleMove(policy, q, opts, random, tables);
      }
      path += String(code[edge]);
      advance(q, edge);
    }
    result[end.winner || 'draw']++;
    reasons[end.reason]++;
    traces.add(path);
  }
  return {games, seed, policyA, policyB, counts:result, reasons, distinct:traces.size};
}
export function estimate(p, tables, model) {
  const end = terminal(p);
  if (end) return {A:Number(end.winner === 'A'), draw:Number(!end.winner), B:Number(end.winner === 'B'), source:'terminal'};
  // If there is only one continuation until termination, every policy shares its result.
  let q = {...p}, mark = [];
  try {
    while (true) {
      const legal = edges(q.s, q.t, q.seen);
      if (legal.length !== 1)break;
      advance(q, legal[0]);
      mark.push(key(q.s, q.t));
      const final = terminal(q);
      if (final)return {A:Number(final.winner === 'A'), draw:Number(!final.winner), B:Number(final.winner === 'B'), source:'forced'};
    }
  } finally {
    for (const k of mark)p.seen[k] = 0;
  }
  const x = features(p, tables);
  let logit = model.base;
  for (const tree of model.trees) {
    let i = 0;
    while (tree[i][0]>=0) {
      const [f, cut, left, right] = tree[i];
      i = x[f]<=cut?left:right;
    }
    logit += tree[i][1];
  }
  const mover = 1/(1+Math.exp(-(model.slope*logit+model.intercept)));
  const winA = (p.t?1-mover:mover)*(1-model.draw);
  return {A:winA, draw:model.draw, B:1-model.draw-winA, source:'guided-model'};
}
