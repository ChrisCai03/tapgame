// Browser/stdio search. choose follows the released C++ root windows and move order.
// analyze gives every root tap a full window and records a line at the last common depth.
import {H, N, QUIET, aHand, live, key, seat, size, code, next, drop, edges, terminal} from './rules.mjs';
const MATE = 10000, CERT = 8000, INF = 20000;
const single = s => live[aHand(s)] === 1 && live[s%H] === 1;
const terminalSign = (s) => !aHand(s)?1:-1;

function forced(s, t, ply, quiet, seen, line) {
  let distance = 0, sign = 1, result = 0;
  const marked = [];
  while (true) {
    if (!aHand(s) || !(s%H)) {
      result = sign*terminalSign(s)*(MATE-ply-distance);
      break;
    }
    if (quiet>=QUIET) {
      result = 0;
      break;
    }
    const edge = s*9, child = next[edge], k = key(child, 1-t);
    if (seen[k]) {
      result = -sign*(MATE-ply-distance);
      break;
    }
    if (line)line.push(String(code[edge]));
    seen[k] = 1;
    marked.push(k);
    distance++;
    sign = -sign;
    quiet = drop(edge)?0:quiet+1;
    s = child;
    t = 1-t;
  }
  for (const k of marked)seen[k] = 0;
  return result;
}
// Mirrors the frozen rank-decreasing checker. The history is the current branch's.
// For a phase with <=5 live numbers, there are at most 7425 distinct boards in that phase.
function prove(s, t, wanted, seen, tables, budget, quiet, choice) {
  if (--budget.left<0) return false;
  if (!aHand(s) || !(s%H))return wanted === terminalSign(s);
  if (quiet>=QUIET || quiet+7425>=QUIET)return false;
  if (single(s))return Math.sign(forced(s, t, 0, quiet, seen)) === wanted;
  if (tables.nominal[s] !== wanted)return false;
  for (let e = 9*s; e<9*s+size[s]; e++) {
    const child = next[e], k = key(child, 1-t);
    if (seen[k])continue;
    let ok = false;
    if (drop(e))ok = tables.cert[child] === -wanted;
    else if (tables.rank[child]<tables.rank[s]) {
      seen[k] = 1;
      ok = prove(child, 1-t, -wanted, seen, tables, budget, quiet+1);
      seen[k] = 0;
    }
    if (ok && wanted>0) {
      if (choice)choice.edge = e;
      return true;
    }
    if (!ok && wanted<0)return false;
  }
  return wanted<0;
}
// First libstdc++ mt19937 uniform index. Matches the seed-based choose command.
function seededIndex(seed, n) {
  if (n === 1)return 0;
  const mt = new Uint32Array(624);
  mt[0] = seed>>>0;
  for (let i = 1; i<624; i++)mt[i] = (Math.imul(1812433253, mt[i-1]^(mt[i-1]>>>30))+i)>>>0;
  let i = 0;
  for (;;) {
    const y = (mt[i]&0x80000000)|(mt[(i+1)%624]&0x7fffffff);
    let v = mt[i] = (mt[(i+397)%624]^(y>>>1)^((y&1)?0x9908b0df:0))>>>0;
    v^=v>>>11;
    v^=(v<<7)&0x9d2c5680;
    v^=(v<<15)&0xefc60000;
    v^=v>>>18;
    const product = (v>>>0)*n;
    if ((product>>>0)>=4294967296%n)return Math.floor(product/4294967296);
    i = (i+1)%624;
  }
}
export class Search {
  constructor(tables, engine, p, limits, collect = false) {
    this.tab = tables;
    this.v2 = engine === 'v2';
    this.p = p;
    this.seen = p.seen;
    this.limit = limits.nodes;
    this.depth = limits.depth;
    this.nodes = 0;
    this.collect = collect;
    this.eval = this.v2?tables.evaluate:tables.v1;
    this.order = Array.from({length:this.depth+3}, () => new Int32Array(9));
    this.line = Array.from({length:this.depth+3}, () => []);
    // Values are local to this root and never used as position-only scores.
    this.hint = new Int32Array(N);
  }
  score(s, t, d, alpha, beta, ply, fresh, quiet) {
    const pv = this.line[ply];
    if (this.collect)pv.length = 0;
    if (++this.nodes>this.limit)return 0;
    if (!aHand(s) || !(s%H))return terminalSign(s)*(MATE-ply);
    if (quiet>=QUIET)return 0;
    if (single(s))return forced(s, t, ply, quiet, this.seen, this.collect?pv:null);
    if (this.v2 && fresh && this.tab.cert[s])return this.tab.cert[s]*(CERT-ply-this.tab.certRank[s]);
    const start = s*9, order = this.order[ply];
    let n = 0;
    for (let e = start; e<start+size[s]; e++) {
      const child = next[e];
      if (this.seen[key(child, 1-t)])continue;
      const clear = !(child%H);
      if (clear || (this.v2 && drop(e) && this.tab.cert[child]<0)) {
        if (this.collect)pv.push(String(code[e]));
        return clear?MATE-ply-1:CERT-ply-1-this.tab.certRank[child];
      }
      let priority = this.eval[child]-(this.v2?20:12)*Number(drop(e));
      if (this.v2 && this.hint[s] === e+1)priority -= 2000;
      const entry = priority*16+(e-start);
      let j = n;
      while (j>0 && order[j-1]>entry) {
        order[j] = order[j-1];
        j--;
      }
      order[j] = entry;
      n++;
    }
    if (!n)return -MATE+ply;
    if (!d)return this.eval[s]-(this.v2?6:3)*(size[s]-n);
    let best = -INF, pick = -1;
    for (let j = 0; j<n; j++) {
      const e = start+(order[j]&15), child = next[e], k = key(child, 1-t);
      this.seen[k] = 1;
      const v = -this.score(child, 1-t, d-1, -beta, -alpha, ply+1, drop(e), drop(e)?0:quiet+1);
      this.seen[k] = 0;
      if (this.nodes>this.limit)return 0;
      if (v>best) {
        best = v;
        pick = e;
        if (this.collect) {
          pv.length = 0;
          pv.push(String(code[e]), ...this.line[ply+1]);
        }
      }
      alpha = Math.max(alpha, v);
      if (alpha>=beta)break;
    }
    if (this.v2)this.hint[s] = pick+1;
    return best;
  }
  child(e, d, window) {
    const {t, quiet} = this.p, child = next[e], k = key(child, 1-t);
    this.seen[k] = 1;
    const value = -this.score(child, 1-t, d-1, -INF, window, 1, drop(e), drop(e)?0:quiet+1);
    this.seen[k] = 0;
    return value;
  }
  choose(seed) {
    const {s, t, ply, quiet} = this.p;
    let ids = edges(s, t, this.seen);
    if (ids.length === 1)return String(code[ids[0]]);
    if (this.v2 && this.tab.nominal[s]>0) {
      const choice = {};
      if (prove(s, t, 1, this.seen, this.tab, {left:4000}, quiet, choice) && ids.includes(choice.edge))return String(code[choice.edge]);
    }
    if (!this.v2)ids.sort((a, b) => this.eval[next[a]]-this.eval[next[b]]);
    let completed = [ids[0]];
    const tol = this.v2 && ply<20?12:0;
    for (let d = 1; d<=this.depth; d++) {
      let best = -INF;
      const rows = [];
      for (const e of ids) {
        const value = this.child(e, d, -best+(this.v2?tol+1:0));
        if (this.nodes>this.limit)return String(code[completed[seededIndex(seed, completed.length)]]);
        rows.push({e, value});
        best = Math.max(best, value);
      }
      rows.sort((a, b) => b.value-a.value);
      if (this.v2) {
        ids = rows.map(r => r.e);
        completed = rows.filter(r => r.value>=best-(Math.abs(best)>5000?0:tol)).map(r => r.e);
      } else {
        completed = [rows[0].e];
        ids = [completed[0], ...ids.filter(e => e !== completed[0])];
      }
      if (Math.abs(best)>5000)break;
    }
    return String(code[completed[seededIndex(seed, completed.length)]]);
  }
  analyze() {
    const {s, t, quiet} = this.p, turn = seat(t), other = seat(1-t);
    let ids = edges(s, t, this.seen), ready = [], depth = 0;
    for (let d = 1; d<=this.depth; d++) {
      const rows = [];
      for (const e of ids) {
        const value = this.child(e, d, INF);
        if (this.nodes>this.limit)break;
        rows.push({move:String(code[e]), score:value === 0?0:value, bound:'exact-at-depth', pv:[String(code[e]), ...this.line[1]],
            proven:Math.abs(value)>5000?(value>0?turn:other):null});
      }
      if (rows.length !== ids.length)break;
      rows.sort((a, b) => b.score-a.score || Number(a.move)-Number(b.move));
      ready = rows;
      depth = d;
      if (single(s) || rows.every(r => r.proven))break;
      ids = rows.map(r => ids.find(e => code[e] === Number(r.move)));
    }
    // A root strategy can be verified even when its witness is beyond the common search horizon.
    if (this.v2 && !single(s) && this.tab.nominal[s]) {
      const sign = this.tab.nominal[s], witness = {};
      if (prove(s, t, sign, this.seen, this.tab, {left:4000}, quiet, witness)) {
        for (const row of ready)if (sign<0 || code[witness.edge] === Number(row.move))row.proven = sign>0?turn:other;
      }
    }
    const tier = row => row.proven === turn?2:row.proven === other?0:1;
    ready.sort((a, b) => tier(b)-tier(a) || b.score-a.score || Number(a.move)-Number(b.move));
    for (const row of ready) {
      let q = {...this.p, seen:this.seen.slice()}, allForced = true, fresh = false;
      for (const move of row.pv) {
        const opts = edges(q.s, q.t, q.seen);
        allForced &&= opts.length === 1;
        const e = opts.find(i => code[i] === Number(move));
        if (e === undefined || terminal(q))throw Error('Search generated an illegal variation.');
        fresh = drop(e);
        q.quiet = fresh?0:q.quiet+1;
        q.t = 1-q.t;
        q.s = next[e];
        q.seen[key(q.s, q.t)] = 1;
      }
      const end = terminal(q);
      row.end = end?end.reason:this.v2 && fresh && this.tab.cert[q.s]?'proof frontier':'horizon';
      row.distance = allForced && end?row.pv.length:null;
    }
    const winner = ready.some(r => r.proven === turn)?turn:ready.length && ready.every(r => r.proven === other)?other:null;
    return {turn, depth, nodes:Math.min(this.nodes, this.limit), budgetHit:this.nodes>this.limit,
      recommended:ready[0]?.move || null, proven:winner, distance:ready[0]?.distance ?? null, candidates:ready};
  }
}
