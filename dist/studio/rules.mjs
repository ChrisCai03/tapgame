// A board index is mover-relative for evaluation. A superko key always retains named seats.
export const H = 220, N = H * H, QUIET = 20000;
export const OPEN = Object.freeze({a:[1, 1, 1], b:[1, 1, 1], turn:'A'});
export const hands = [], ids = new Int16Array(1000), live = new Uint8Array(H);
export const size = new Uint8Array(N), next = new Uint16Array(N*9), code = new Uint8Array(N*9);
const packed = a => a[0]*100+a[1]*10+a[2];
for (let x = 0; x<=9; x++) for (let y = x; y<=9; y++) for (let z = y; z<=9; z++) {
  const i = hands.length;
  hands.push([x, y, z]);
  ids[100*x+10*y+z] = i;
  live[i] = Number(x>0)+Number(y>0)+Number(z>0);
}
for (let a = 1; a<H; a++) for (let b = 1; b<H; b++) {
  const s = a*H+b;
  for (let i = 0; i<3; i++) {
    const x = hands[a][i];
    if (!x || (i && hands[a][i-1] === x)) continue;
    for (let j = 0; j<3; j++) {
      const y = hands[b][j];
      if (!y || (j && hands[b][j-1] === y)) continue;
      const copy = hands[a].slice();
      copy[i] = (x+y)%10;
      copy.sort((l, r) => l-r);
      const edge = 9*s+size[s]++;
      code[edge] = 10*x+y;
      next[edge] = b*H+ids[packed(copy)];
    }
  }
}
export const aHand = s => Math.floor(s/H);
export const key = (s, t) => t ? (s%H)*H+aHand(s) : s;
export const seat = t => t ? 'B' : 'A';
export const drop = e => Math.floor(code[e]/10)+code[e]%10 === 10;
export function checkStart(start = OPEN) {
  if (!start || !['A', 'B'].includes(start.turn)) throw Error('Choose A or B to move.');
  const triple = h => {
    if (!Array.isArray(h) || h.length !== 3 || h.some(x => !Number.isInteger(x) || x<0 || x>9)) throw Error('Each hand set needs three digits from 0 to 9.');
    return [...h].sort((a, b) => a-b);
  };
  const a = triple(start.a), b = triple(start.b);
  if (!a[2] && !b[2]) throw Error('Both players cannot already have withdrawn every number.');
  return {a, b, turn:start.turn};
}
export function initial(start) {
  start = checkStart(start);
  const t = Number(start.turn === 'B'), board = ids[packed(start.a)]*H+ids[packed(start.b)];
  const seen = new Int32Array(N);
  seen[board] = 1;
  return {s:key(board, t), t, ply:0, quiet:0, seen};
}
export function edges(s, t, seen) {
  const out = [];
  for (let i = s*9; i<s*9+size[s]; i++) if (!seen[key(next[i], 1-t)]) out.push(i);
  return out;
}
export function terminal(p) {
  const {s, t, quiet, seen} = p;
  if (!aHand(s) || !(s%H)) return {winner:seat(!aHand(s)?t:1-t), reason:'clearance'};
  if (quiet>=QUIET) return {winner:null, reason:'timeout'};
  for (let e = s*9; e<s*9+size[s]; e++) if (!seen[key(next[e], 1-t)]) return null;
  return {winner:seat(1-t), reason:'blockade'};
}
export function advance(p, e) {
  p.s = next[e];
  p.t = 1-p.t;
  p.ply++;
  p.quiet = drop(e)?0:p.quiet+1;
  p.seen[key(p.s, p.t)] = p.ply+1;
}
export function traceOK(trace) {
  if (typeof trace !== 'string' || trace.length>2*N || trace.length%2 || /[^1-9]/.test(trace)) throw Error('A trace must contain pairs of digits from 1 to 9.');
}
export function step(p, move) {
  if (terminal(p)) throw Error('The game has ended at tap '+p.ply+'.');
  if (typeof move !== 'string' || !/^[1-9]{2}$/.test(move)) throw Error('Invalid tap '+String(move));
  for (let e = 9*p.s; e<9*p.s+size[p.s]; e++) if (code[e] === Number(move)) {
    const stamp = p.seen[key(next[e], 1-p.t)];
    if (stamp) throw Error('Tap '+move+' repeats the board after tap '+(stamp-1)+'.');
    advance(p, e);
    return;
  }
  throw Error('Tap '+move+' is unavailable at tap '+p.ply+'.');
}
export function replay(position = {}) {
  if (!position || typeof position !== 'object') throw Error('Expected a position.');
  const p = initial(position.start === undefined?OPEN:position.start);
  const trace = position.trace === undefined?'':position.trace;
  traceOK(trace);
  for (let i = 0; i<trace.length; i += 2) step(p, trace.slice(i, i+2));
  return p;
}
export function inspect(p) {
  const {s, t, seen} = p, board = key(s, t), result = terminal(p), legal = [], banned = [];
  for (let e = s*9; e<s*9+size[s]; e++) {
    const stamp = seen[key(next[e], 1-t)], move = String(code[e]);
    if (stamp) banned.push({move, repeatPly:stamp-1});
    else if (!result) legal.push(move);
  }
  return {a:hands[aHand(board)], b:hands[board%H], turn:seat(t), ply:p.ply, quiet:p.quiet, legal, banned, result};
}
export const tapText = move => move[0]+' + '+move[1];
