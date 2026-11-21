import {checkStart, OPEN, replay, traceOK} from './rules.mjs';
export function createStudy(title, start = OPEN, main = '', ply = 0) {
  const checked = checkStart(start);
  replay({start:checked, trace:main});
  return {format:'tapgame-study/1', title:title.slice(0, 100), start:checked, lines:[main], active:0, ply:Math.max(0, Math.min(ply, main.length/2))};
}
export function importStudy(obj) {
  if (!obj || obj.format !== 'tapgame-study/1' || typeof obj.title !== 'string' || !Array.isArray(obj.lines) || !obj.lines.length || obj.lines.length>256)throw Error('Expected a Tapgame Studio study with 1–256 lines.');
  const start = checkStart(obj.start);
  let total = 0;
  for (const trace of obj.lines) {
    traceOK(trace);
    total += trace.length;
    if (total>2000000)throw Error('Study is too large.');
    replay({start, trace});
  }
  if (!Number.isInteger(obj.active) || obj.active<0 || obj.active>=obj.lines.length || !Number.isInteger(obj.ply) || obj.ply<0 || obj.ply>obj.lines[obj.active].length/2)throw Error('Invalid active line or cursor.');
  let players;
  if (obj.players && [obj.players.A, obj.players.B].every(n => typeof n === 'string' && n.length<=64))players = {A:obj.players.A, B:obj.players.B};
  return {players, format:obj.format, title:obj.title.slice(0, 100), start, lines:[...obj.lines], active:obj.active, ply:obj.ply};
}
export const position = study => ({start:study.start, trace:study.lines[study.active].slice(0, study.ply*2)});
export function branch(study, moves) {
  const pos = position(study), combined = pos.trace+moves.join('');
  replay({...pos, trace:combined});
  let index = study.active;
  if (!study.lines[index].startsWith(combined)) {
    const found = study.lines.findIndex(trace => trace.startsWith(combined));
    if (found>=0)index = found;
    else if (study.lines[index] === pos.trace)study.lines[index] = combined;
    else {
      if (study.lines.length>=256)throw Error('This study already has 256 variations.');
      study.lines.push(combined);
      index = study.lines.length-1;
    }
  }
  study.active = index;
  study.ply = combined.length/2;
}
export function forkPly(a, b) {
  let i = 0;
  while (i<a.length && i<b.length && a.slice(i, i+2) === b.slice(i, i+2))i += 2;
  return i/2;
}
