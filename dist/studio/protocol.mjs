import {replay, inspect, terminal, step, initial, traceOK, edges, code} from './rules.mjs';
import {Search} from './search.mjs';
import {estimate, simulate, rng, rolloutNames, simNames, simpleMove} from './policy.mjs';

export const ENGINE_NAMES = {v2:'Tapgame v2', v1:'Tapgame v1', ...rolloutNames};
export const RULESET = 'tap10-3-positional-v1';
const own = (obj, k) => typeof k === 'string' && Object.hasOwn(obj, k);
const integer = (x, lo, hi, name) => {
  if (!Number.isInteger(x) || x<lo || x>hi) throw Error(name+' must be an integer between '+lo+' and '+hi+'.');
  return x;
};
export const defaultLimits = engine => engine === 'v1'?{nodes:4500, depth:8}:{nodes:500000, depth:18};
export function respond(request, tables, model, fixedEngine) {
  const id = request?.id ?? null;
  try {
    if (!request || request.v !== 1 || !(typeof id === 'string' || Number.isSafeInteger(id)))throw Error('TGEP version 1 and a request id are required.');
    const {cmd} = request, engine = fixedEngine ?? request.engine ?? 'v2';
    if (!own(ENGINE_NAMES, engine))throw Error('Unknown engine.');
    const canSearch = engine === 'v1' || engine === 'v2';
    const commands = ['hello', 'inspect', 'choose', 'evaluate', 'timeline', 'simulate', ...(canSearch?['analyze']:[])];
    if (!commands.includes(cmd))throw Error('Unsupported command: '+String(cmd));
    const ok = result => ({v:1, id, ok:true, result});
    if (cmd === 'hello')return ok({protocol:'TGEP', version:1, engine:ENGINE_NAMES[engine], rulesets:[RULESET], commands,
        defaultLimits:canSearch?defaultLimits(engine):null, moveEncoding:'xy', stochastic:engine !== 'v1'});
    const pos = request.position ?? {}, state = cmd === 'timeline'?null:replay(pos);
    if (cmd === 'inspect')return ok(inspect(state));
    if (cmd === 'timeline') {
      const trace = pos.trace ?? '';
      traceOK(trace);
      const p = initial(pos.start), values = [estimate(p, tables, model).A];
      for (let i = 0; i<trace.length; i += 2) {
        step(p, trace.slice(i, i+2));
        values.push(estimate(p, tables, model).A);
      }
      return ok({perspective:'A', values});
    }
    const seed = integer(request.seed ?? 1, 0, 4294967295, 'Seed');
    if (cmd === 'evaluate')return ok({wdl:estimate(state, tables, model), policy:model.metadata.policy});
    if (cmd === 'simulate') {
      const games = integer(request.games ?? 128, 1, 4096, 'Games');
      const policyA = request.policyA ?? 'guided', policyB = request.policyB ?? 'guided';
      if (!own(simNames, policyA) || !own(simNames, policyB))throw Error('Unknown simulation policy.');
      return ok(simulate(state, tables, {games, seed, policyA, policyB}));
    }
    const end = terminal(state);
    if (end)return ok(cmd === 'choose'?{move:null, terminal:end}:{...inspect(state), terminal:end, recommended:null, candidates:[], depth:0, nodes:0, proven:end.winner, distance:0, wdl:estimate(state, tables, model)});
    const d = defaultLimits(engine), limits = {nodes:integer(request.limits?.nodes ?? d.nodes, 16, 2000000, 'Nodes'), depth:integer(request.limits?.depth ?? d.depth, 1, 32, 'Depth')};
    if (cmd === 'choose') {
      if (!canSearch) {
        const edge = simpleMove(engine, state, edges(state.s, state.t, state.seen), rng(seed), tables);
        return ok({move:String(code[edge])});
      }
      return ok({move:new Search(tables, engine, state, limits).choose(seed)});
    }
    return ok({...new Search(tables, engine, state, limits, true).analyze(), terminal:null, wdl:estimate(state, tables, model)});
  } catch (error) {
    return {v:1, id, ok:false, error:{code:'invalid_request', message:String(error.message || error)}};
  }
}
