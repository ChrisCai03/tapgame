import {RULESET, ENGINE_NAMES} from './protocol.mjs';
import {replay, step, inspect} from './rules.mjs';
export const engines = new Map(Object.entries(ENGINE_NAMES).map(([id, name]) => [id, {id, name, search:id === 'v3' || id === 'v2' || id === 'v1', local:false}]));
export async function discover() {
  if (!['localhost', '127.0.0.1'].includes(location.hostname))return;
  const res = await fetch('/tgep/engines');
  if (!res.ok || !res.headers.get('Content-Type')?.includes('application/json'))return;
  const list = await res.json();
  await Promise.all(list.map(async e => {
        const id = 'external:'+e.id;
        const response = await fetch('/tgep/engine/'+encodeURIComponent(e.id), {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({v:1, id:'hello', cmd:'hello'})});
        const msg = await response.json(), hello = msg.result;
        if (msg.v === 1 && msg.id === 'hello' && msg.ok && hello?.protocol === 'TGEP' && hello.version === 1 && hello.rulesets?.includes(RULESET) && hello.commands?.includes('choose'))
        engines.set(id, {id, name:e.name, search:hello.commands.includes('analyze'), local:true});
      }));
}
// Channels are independent: a budget-heavy simulation cannot block a play or review request.
export class Channel{
  constructor() {
    this.serial = 0;
    this.worker = null;
    this.active = null;
  }
  cancel() {
    this.worker?.terminate();
    this.worker = null;
    if (this.active) {
      this.active.abort?.abort();
      this.active.reject(new DOMException('Cancelled', 'AbortError'));
      this.active = null;
    }
  }
  request(engine, cmd, body = {}) {
    if (this.active)this.cancel();
    const id = ++this.serial, msg = {...body, id, cmd, engine, v:1};
    return new Promise((resolve, reject) => {
        const finish = reply => {
          if (this.active?.id !== id)return;
          this.active = null;
          if (reply?.id !== id || reply.v !== 1 || !reply.ok)reject(Error(reply?.error?.message || 'Invalid reply from engine.'));
          else resolve(reply.result);
        };
        const fail = err => {
          if (this.active?.id === id) {
            this.active = null;
            reject(err);
          }
        };
        this.active = {id, reject};
        if (engine.startsWith('external:')) {
          const abort = new AbortController();
          this.active.abort = abort;
          fetch('/tgep/engine/'+encodeURIComponent(engine.slice(9)), {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(msg), signal:abort.signal})
          .then(async r => {
              const data = await r.json();
              if (!r.ok)throw Error(data.error || 'Bridge unavailable.');
              return data;
            }).then(finish, fail);
        } else {
          this.worker??=new Worker(new URL('./worker.mjs', import.meta.url), {type:'module'});
          this.worker.onmessage = e => finish(e.data);
          this.worker.onerror = e => {
            this.worker?.terminate();
            this.worker = null;
            fail(Error(e.message || 'Engine worker failed.'));
          };
          this.worker.postMessage(msg);
        }
      });
  }
}
// Validate external engine moves and variations using the host referee before showing them.
export function checkAnalysis(result, pos) {
  const info = inspect(replay(pos));
  if (!result || !Array.isArray(result.candidates) || !Number.isInteger(result.depth) || !Number.isInteger(result.nodes))throw Error('Malformed analysis response.');
  if (info.result) {
    if (result.candidates.length || result.terminal?.reason !== info.result.reason || result.terminal?.winner !== info.result.winner)throw Error('Engine disagrees about termination.');
    return result;
  }
  const got = new Set();
  for (const row of result.candidates) {
    if (!info.legal.includes(row.move) || got.has(row.move) || !Number.isFinite(row.score) || !['exact-at-depth', 'upper', 'lower'].includes(row.bound) || !Array.isArray(row.pv) || row.pv[0] !== row.move)throw Error('Engine returned an invalid candidate.');
    if (row.proven != null && !['A', 'B'].includes(row.proven))throw Error('Invalid proof label.');
    const p = replay(pos);
    for (const tap of row.pv)step(p, tap);
    got.add(row.move);
  }
  if (got.size !== info.legal.length || !got.has(result.recommended))throw Error('Engine omitted a legal candidate or its recommendation.');
  return result;
}
