import {hands} from './rules.mjs';

const triples = hands.filter(hand => hand[0] > 0);
const rank = new Map(triples.map((hand, i) => [hand.join(''), i]));
export const BOARD_COUNT = triples.length ** 2;
export const OPENING_COUNT = 2 * BOARD_COUNT;

export function openingFromId(id) {
  if (!Number.isInteger(id) || id < 0 || id >= OPENING_COUNT) throw Error('Opening number must be 0–54,449.');
  const board = Math.floor(id / 2);
  return {
    a: [...triples[Math.floor(board / triples.length)]],
    b: [...triples[board % triples.length]],
    turn: id % 2 ? 'B' : 'A'
  };
}

// The opening number includes both named hands and the first player.
export function openingId(start) {
  const a = rank.get(start.a.join('')), b = rank.get(start.b.join(''));
  if (a === undefined || b === undefined) return null;
  return 2 * (a * triples.length + b) + Number(start.turn === 'B');
}

export function drawOpeningId() {
  const word = new Uint32Array(1);
  const limit = 2 ** 32 - (2 ** 32 % OPENING_COUNT);
  do { crypto.getRandomValues(word); } while (word[0] >= limit);
  return word[0] % OPENING_COUNT;
}

export function openingProof(start, table) {
  const movingFirst = start.turn === 'A' ? start : {a:start.b, b:start.a, turn:'A'};
  const id = openingId(movingFirst);
  if (id === null) return null;
  const offset = 2 * Math.floor(id / 2);
  const kind = table[offset];
  if (!kind) return null;
  const moverWins = kind === 1 || kind === 3;
  return {
    winner: moverWins ? start.turn : (start.turn === 'A' ? 'B' : 'A'),
    short: kind <= 2, move: table[offset + 1] || null
  };
}
