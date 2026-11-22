import {drawOpeningId, openingFromId, openingId} from './openings.mjs';
import {createStudy, importStudy} from './study.mjs';
import {OPEN} from './rules.mjs';
import {engines} from './client.mjs';
import {simNames} from './policy.mjs';

const leagueBots = {v2:'V2', v1:'V1', heuristic:'Heuristic', random:'Random'};
const leaguePairs = Object.keys(leagueBots).flatMap((left, index, bots) => bots.slice(index+1).map(right => [left,right]));
export const sets = {
  ...Object.fromEntries(leaguePairs.map(([left,right]) =>
    ['league/'+left+'-'+right, [leagueBots[left]+' vs '+leagueBots[right]+' · Round robin', 2000]])),
  'v2-v1':['V2 vs V1 · Released settings', 5000],
  'random-openings-v2-v1':['V2 vs V1 · Random openings', 1000], 'v2-equal':['V2 vs V1 · Equal depth and nodes', 500],
  'v2-equal-nodes':['V2 vs V1 · Equal nodes', 500], random:['V1 vs random', 2000], heuristic:['V1 vs heuristic', 2000]
};
export const presets = {quick:{name:'Quick', nodes:4500, depth:8}, balanced:{name:'Balanced', nodes:36000, depth:13}, deep:{name:'Deep', nodes:500000, depth:18}};
export const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'})[c]);
const dataCache = new Map(), $ = id => document.getElementById(id);
export const selectOpts = (entries, selected) => entries.map(([v, k]) => '<option value="'+esc(v)+'" '+(String(v) === String(selected)?'selected':'')+'>'+esc(k)+'</option>').join('');
export async function loadGame(suite, id, ply = 0) {
  if (!Object.hasOwn(sets, suite) || !Number.isInteger(id) || id<1 || id>sets[suite][1])throw Error('Choose a game within the selected collection.');
  if (!dataCache.has(suite))dataCache.set(suite, fetch('../data/'+suite+'.csv').then(async r => {
        if (!r.ok)throw Error('Could not load the archive.');
        return (await r.text()).trim().split(/\r?\n/);
      }).catch (e => {
        dataCache.delete(suite);
        throw e;
      }));
  const rows = await dataCache.get(suite), row = rows[id]?.split(',');
  if (!row || Number(row[0]) !== id || row[7]?.length !== Number(row[5])*2)throw Error('Invalid archive record.');
  const league = suite.startsWith('league/');
  const randomStart = league || suite === 'random-openings-v2-v1';
  const start = randomStart ? openingFromId(Number(row[10])) : OPEN;
  if (randomStart && row[8] !== start.turn+start.a.join('')+start.b.join('')) throw Error('Opening number and recorded board disagree.');
  const suffix = randomStart ? ' · opening #'+row[10] : suite === 'v2-equal' ? ' (depth control)' : suite === 'v2-equal-nodes' ? ' (node control)' : '';
  const study = createStudy(sets[suite][0].split(' · ')[0]+' / Game '+String(id).padStart(4, '0')+suffix, start, row[7], ply);
  const pair = league ? suite.slice(7).split('-').map(bot => leagueBots[bot]) :
    suite.startsWith('v2-') || randomStart ? ['Tapgame v2', 'Tapgame v1'] : ['Tapgame v1', suite === 'random' ? 'Uniform random' : 'Heuristic'];
  if ((row[2] === '0') !== (start.turn === 'B')) pair.reverse();
  study.players = {A:pair[0], B:pair[1]};
  return study;
}
export function showDialog(type, api) {
  const dlg = $('dialog'), b = $('dlgBody'), title = $('dlgTitle'), err = () => '<div class="formError" id="dialogError" role="alert"></div>';
  function body(label, html) {
    title.textContent = label;
    b.innerHTML = html;
    if (!dlg.open)dlg.showModal();
  }
  function apply(id, cb) {
    $(id).onclick = async() => {
      const btn = $(id);
      btn.disabled = true;
      try {
        await cb();
        dlg.close();
      } catch (e) {
        if ($('dialogError'))$('dialogError').textContent = e.message;
      }
      finally {
        btn.disabled = false;
      }
    };
  }
  const options = type === 'settings'?api.config:null;
  if (type === 'archive') {
    body('Game archive', '<label>Collection<select id="suite">'+selectOpts(Object.entries(sets).map(([s, v]) => [s, v[0]]), 'v2-v1')+'</select></label><label>Game number<input id="gameId" type="number" min="1" max="5000" value="1" inputmode="numeric"></label><p id="archiveSize">Games 1–5,000. Records include every tap.</p>'+err()+'<div class="actions"><button class="primary" id="loadGame">Open game</button><button id="demoEnd">Study game 1’s blockade</button></div><h3>Recent studies</h3><div id="recent" class="recent"></div>');
    $('suite').onchange = () => {
      const max = sets[$('suite').value][1];
      $('gameId').max = max;
      $('archiveSize').textContent = 'Games 1–'+max.toLocaleString()+'. Records include every tap.';
    };
    apply('loadGame', async() => api.open(await loadGame($('suite').value, Number($('gameId').value))));
    apply('demoEnd', async() => api.open(await loadGame('v2-v1', 1, 268)));
    const recent = api.recent();
    if (!recent.length)$('recent').textContent = 'No earlier studies on this device.';
    recent.forEach(s => {
        const btn = document.createElement('button');
        btn.textContent = s.title+' · tap '+s.ply;
        btn.onclick = () => {
          api.open(importStudy(s));
          dlg.close();
        };
        $('recent').append(btn);
      });
  } else if (type === 'new' || type === 'edit') {
    const src = type === 'edit'?api.info:OPEN;
    const randomControls = type === 'new' ? '<div class="btnRow"><button id="drawStart">Draw random opening</button><span id="drawLabel" role="status"></span></div><p>Draws two three-number hands and the first player. Equal chances for all 165 sorted hands.</p>' : '';
    const boxes = side => src[side].map((n, i) => '<input aria-label="Player '+side.toUpperCase()+' number '+(i+1)+'" type="number" min="0" max="9" step="1" value="'+n+'" id="digit'+side+i+'">').join('');
    body(type === 'edit'?'Set up this position':'New study', '<label>Study name<input id="studyName" maxlength="100" value="'+(type === 'edit'?'Position from tap '+api.info.ply:'Untitled study')+'"></label>'+
      randomControls+'<div class="formRow"><div><label>Player A</label><div class="boardEditor">'+boxes('a')+'</div></div><div><label>Player B</label><div class="boardEditor">'+boxes('b')+'</div></div></div>'+
      '<label>First to move<select id="startTurn">'+selectOpts([['A', 'Player A'], ['B', 'Player B']], src.turn)+'</select></label><p>Use 0 for a withdrawn number. A setup begins a new history at tap 0. Your current study stays in Recent studies.</p>'+err()+'<button id="createStudy" class="primary">Open position</button>');
    let drawnId = null;
    if (type === 'new') {
      $('drawStart').onclick = () => {
        drawnId = drawOpeningId();
        const start = openingFromId(drawnId);
        for (const side of ['a', 'b']) start[side].forEach((digit, i) => { $('digit'+side+i).value = digit; });
        $('startTurn').value = start.turn;
        $('drawLabel').textContent = 'Opening #'+drawnId;
      };
      for (const field of b.querySelectorAll('.boardEditor input, #startTurn')) {
        field.oninput = () => { drawnId = null; $('drawLabel').textContent = ''; };
      }
    }
    apply('createStudy', () => {
        const hand = k => [0, 1, 2].map(i => {
            const v = $('digit'+k+i).value.trim();
            if (!/^[0-9]$/.test(v))throw Error('Enter one digit in each box.');
            return Number(v);
          });
        const start = {a:hand('a'), b:hand('b'), turn:$('startTurn').value};
        let name = $('studyName').value.trim() || 'Untitled study';
        if (drawnId !== null && name === 'Untitled study' && openingId(start) === drawnId) name = 'Random opening #'+drawnId;
        api.open(createStudy(name, start));
      });
  } else if (type === 'settings') {
    body('Analysis settings', '<label>Analysis engine<select id="analysisEngine">'+selectOpts([...engines].filter(([, e]) => e.search).map(([id, e]) => [id, e.name]), options.engine)+'</select></label><label>Analysis budget<select id="budget">'+selectOpts(Object.entries(presets).map(([id, p]) => [id, p.name+' · '+p.nodes.toLocaleString()+' nodes / '+p.depth+' taps']), options.preset)+'</select></label><p>The candidate table compares taps at the deepest depth completed for every legal choice. Playing engines use their own released limits.</p>'+err()+'<button class="primary" id="applySettings">Apply settings</button>');
    apply('applySettings', () => api.settings({engine:$('analysisEngine').value, preset:$('budget').value}));
  } else if (type === 'simulation') {
    const opts = Object.entries(simNames), s = api.config;
    body('Simulation options', '<div class="formRow"><label>Player A<select id="rollA">'+selectOpts(opts, s.policyA)+'</select></label><label>Player B<select id="rollB">'+selectOpts(opts, s.policyB)+'</select></label></div><div class="formRow"><label>Games<select id="rollGames">'+selectOpts([1, 4, 16, 32, 128, 512, 2048].map(n => [n, n]), s.games)+'</select></label><label>Random seed<input type="number" id="rollSeed" min="0" max="4294967295" value="'+Number(s.seed)+'"></label></div><p>Each game continues from this exact history. Guided chooses a random tap 15% of the time. Released search engines use their full playing budgets and can take longer. Start with 1–4 games for those engines.</p>'+err()+'<button class="primary" id="applySim">Save options</button>');
    apply('applySim', () => {
        const seed = $('rollSeed').valueAsNumber;
        if (!Number.isInteger(seed) || seed<0 || seed>4294967295)throw Error('Enter a seed from 0 to 4294967295.');
        api.settings({policyA:$('rollA').value, policyB:$('rollB').value, games:Number($('rollGames').value), seed});
      });
  } else {
    body('Workbench guide', '<h3>Read a position</h3><p>Amber is Player A and mint is Player B. Select a live number on the moving side, then an opposing number to add. A result of zero withdraws that number. Clear all three or leave the opponent without a legal tap to win. The timeout is 20,000 taps without a withdrawal.</p>'+
      '<h3>Try a different opening</h3><p>In Play, select Random opening for two fresh three-number hands and a randomly chosen first player. In New study you can draw, inspect and edit the opening. Click its number at tap zero for a reusable link.</p>'+
      '<p>Among 27,225 pairs of hands ordered by who moves first, the opening search proves 2,681 wins for the first player and 100 for the second. Try <a href="index.html?opening=27040">a forced win in five taps</a> or <a href="index.html?opening=86">a second-player win</a>. The standard all-ones opening is unresolved.</p>'+
      '<h3>Explore a continuation</h3><p>Select a candidate, then click a tap in its continuation to follow the line that far. The game record keeps your variations. Use Left/Right to step, Home/End to jump and Space to replay. Click a forbidden tap to revisit the earlier board.</p>'+
      '<h3>Scores, proofs and percentages</h3><p>Higher search scores favor the side to move. A proof accounts for the current repetition history. A line can stop at a search horizon or a certified endgame. A distance appears only for a forced sequence all the way to termination.</p>'+
      '<p>The chart always follows Player A. W/D/L predicts Guided 15% against itself, trained on 42,000 games, calibrated on 9,000 and tested on a separate 9,000. Three-outcome Brier score: 0.339 (constant forecast 0.500, lower is better). All 60,000 games were decisive. The model uses a small pooled draw estimate; its local draw risk could not be calibrated. Forced continuations show their exact outcome. An edited opening or late blockade can be outside the training distribution. Simulations let you test a position directly.</p>'+
      '<h3>Connect another engine</h3><p>The browser ships with five bots. In a local checkout, run <code>node studio/server.mjs --engines studio/engines.example.json</code> after building the native executable. The bridge handshakes with registered processes and lists compatible engines in Play and Settings. Each exchange is a versioned TGEP/1 JSON request and reply.</p><p><a href="https://github.com/ChrisCai03/tapgame/blob/main/docs/engine-protocol.md">Engine protocol and examples</a></p>');
  }
}
