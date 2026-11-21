import {OPEN, replay, inspect, tapText} from './rules.mjs';
import {simNames} from './policy.mjs';
import {createStudy, importStudy, position, branch, forkPly} from './study.mjs';
import {engines, discover, Channel, checkAnalysis} from './client.mjs';
import {showDialog, loadGame, presets, esc, selectOpts} from './dialogs.mjs';

const $ = id => document.getElementById(id);
const channels = Object.fromEntries(['analysis', 'chart', 'eval', 'sim', 'play', 'pick', 'scan'].map(k => [k, new Channel()]));
const defaults = {engine:'v2', preset:'balanced', policyA:'guided', policyB:'guided', games:128, seed:42, seatA:'human', seatB:'v2'};
const read = (k, d) => {
  try {
    return JSON.parse(localStorage.getItem('tapstudio.'+k)) ?? d;
  } catch {
    return d;
  }
};
let storageWarned = false;
function save(k, v) {
  try {
    localStorage.setItem('tapstudio.'+k, JSON.stringify(v));
  } catch {
    if (!storageWarned) {
      storageWarned = true;
      notice('Device storage is full or unavailable. Export the study to keep it.');
    }
  }
}
const config = {...defaults, ...read('config', {})};
if (!Object.hasOwn(presets, config.preset))config.preset = 'balanced';
let study = createStudy('Opening'), info = null, revision = 0, analysis = null, actualMove = null, selected = null, sourceDigit = null, mode = 'review';
let chartMode = 'wdl';
let graphValues = [], graphKey = '', pendingChart = '', replayTimer = null, run = false, playRevision = 0, busyPlay = false, playTimer = null;
let simToken = 0, simBusy = false, scanToken = 0, scanState = null, scanBusy = false, timerNotice;
const analysisCache = new Map(), annotations = new Map();
const activeLine = () => study.lines[study.active];
const moveAt = (trace, n) => trace.slice(2*n, 2*n+2);
const nameOf = id => engines.get(id)?.name ?? id;
const pct = n => n>0 && n<.0005?'‹0.1%':(n*100).toFixed(1)+'%';
const fmt = n => n.toLocaleString('en-US');
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
function notice(msg) {
  const bar = $('notice');
  bar.textContent = msg;
  bar.hidden = false;
  clearTimeout(timerNotice);
  timerNotice = setTimeout(() => bar.hidden = true, 5000);
}
function failure(e) {
  if (e.name !== 'AbortError')notice(e.message);
}
function stampStudy() {
  save('current', study);
}
function recent() {
  return read('recent', []).filter(s => s?.format === 'tapgame-study/1');
}
function remember() {
  const old = recent().filter(s => s.title !== study.title || s.lines[0] !== study.lines[0]);
  save('recent', [study, ...old].slice(0, 8));
}
function openStudy(s) {
  pauseAll();
  remember();
  study = s;
  mode = 'review';
  graphKey = '';
  refresh();
}
function applySettings(update) {
  Object.assign(config, update);
  save('config', config);
  pauseAll();
  refresh();
}
const dialog = type => {
  stopPlayback();
  stopArena();
  showDialog(type, {config, info, open:openStudy, recent, settings:applySettings});
};
function stopPlayback() {
  if (replayTimer)clearInterval(replayTimer);
  replayTimer = null;
  $('playback').textContent = '▶︎';
  $('playback').setAttribute('aria-label', 'Replay line');
}
function stopArena() {
  run = false;
  busyPlay = false;
  playRevision++;
  clearTimeout(playTimer);
  channels.play.cancel();
  if (info)syncArena();
}
function stopSim() {
  simToken++;
  simBusy = false;
  if (channels.sim.active)channels.sim.cancel();
  $('simulate').textContent = 'Run simulations';
}
function stopScan() {
  scanToken++;
  scanBusy = false;
  if (channels.scan.active)channels.scan.cancel();
  $('scan').textContent = 'Scan line';
}
function pauseAll() {
  stopPlayback();
  stopArena();
  stopSim();
  stopScan();
}
function go(ply) {
  stopPlayback();
  stopArena();
  study.ply = clamp(Math.round(ply), 0, activeLine().length/2);
  refresh();
}
function commitMoves(moves, fromPlayer = false) {
  try {
    if (!fromPlayer)stopArena();
    stopPlayback();
    branch(study, moves);
    refresh();
    if (info.result && run) stopArena();
    else if (run) queuePlay();
  }
  catch (e) {
    stopArena();
    failure(e);
  }
}
function requestMoveDigit(side, digit) {
  if (!digit || info.result)return;
  if (mode === 'play' && config['seat'+info.turn] !== 'human') {
    notice('This seat is controlled by an engine. Use Review to try another tap.');
    return;
  }
  if (side === info.turn) {
    sourceDigit = sourceDigit === digit?null:digit;
    renderBoard();
    return;
  }
  if (sourceDigit === null) {
    notice('Select a number belonging to Player '+info.turn+' first.');
    return;
  }
  const m = String(sourceDigit)+digit;
  if (info.legal.includes(m)) {
    commitMoves([m], true);
    return;
  }
  const ban = info.banned.find(b => b.move === m);
  notice(ban?'This tap repeats the board at tap '+ban.repeatPly+'. See Repetition check.':'Unavailable tap.');
}
function renderBoard() {
  const terminal = info.result;
  for (const side of ['B', 'A']) {
    const values = info[side.toLowerCase()], active = info.turn === side && !terminal;
    const box = $('side'+side);
    box.className = 'side side'+side;
    box.replaceChildren();
    const label = document.createElement('div');
    label.className = 'seatLabel';
    const player = mode === 'play'?(config['seat'+side] === 'human'?'Human':nameOf(config['seat'+side])):study.players?.[side];
    label.innerHTML = '<span class="seatName"><i class="dot"></i>Player '+side+'</span>'+(player?'<small>'+esc(player)+'</small>':'')+(active?'<span class="turnTag">To move</span>':'');
    const tiles = document.createElement('div');
    tiles.className = 'tiles';
    // Keep live values together; withdrawn slots remain in view.
    for (const d of [...values.filter(Boolean), ...values.filter(v => !v)]) {
      const b = document.createElement('button'), target = !active && sourceDigit !== null && info.legal.includes(String(sourceDigit)+d);
      b.className = 'tile'+(!d?' dead':'')+(active && sourceDigit === d?' selected':'')+(target?' target':'');
      b.textContent = d?String(d):'–';
      b.disabled = !d || !!terminal;
      b.setAttribute('aria-label', 'Player '+side+' '+(d?'number '+d:'withdrawn number'));
      if (d && active)b.setAttribute('aria-pressed', String(sourceDigit === d));
      b.onclick = () => requestMoveDigit(side, d);
      tiles.append(b);
    }
    const live = document.createElement('span');
    live.className = 'liveCount';
    live.textContent = values.filter(Boolean).length+' live';
    box.append(label, tiles, live);
  }
  $('quietCount').textContent = info.quiet+' '+(info.quiet === 1?'tap':'taps')+' since withdrawal';
  $('cancelTap').hidden = sourceDigit === null;
  $('boardHint').textContent = terminal?(terminal.winner?'Player '+terminal.winner+' wins by '+terminal.reason+'.':'Draw after 10,000 rounds without a withdrawal.'):
  sourceDigit !== null?'Selected '+sourceDigit+' · choose an opposing number to add.':mode === 'play' && config['seat'+info.turn] !== 'human'?
  nameOf(config['seat'+info.turn])+' controls Player '+info.turn+'.':'Select a number from Player '+info.turn+', then an opposing number.';
}
function renderTransport() {
  const total = activeLine().length/2, ply = study.ply;
  $('context').textContent = study.title;
  $('boardTitle').textContent = 'Game board';
  $('studyType').textContent = study.active?'Variation '+study.active:'Main line';
  $('moveCounter').textContent = 'Tap '+ply+' / '+total;
  $('scrub').max = String(total || 1);
  $('scrub').disabled = !total;
  $('scrub').value = String(ply);
  $('first').disabled = $('prev').disabled = !ply;
  $('next').disabled = $('last').disabled = ply === total;
  $('playback').disabled = !total;
  const last = ply?moveAt(activeLine(), ply-1):'';
  $('lastTap').textContent = last?'Last · '+tapText(last)+' = '+((+last[0]+ +last[1])%10):'Starting position';
  $('lineSelect').innerHTML = selectOpts(study.lines.map((l, i) => [i, i?'Variation '+i+' · fork at '+forkPly(l, study.lines[0])+' · '+l.length/2+' taps':'Main line · '+l.length/2+' taps']), study.active);
  $('returnMain').disabled = !study.active;
  const strip = $('recordStrip');
  strip.replaceChildren();
  for (let j = Math.max(0, Math.min(ply-4, total-8)); j<=Math.min(total, Math.max(8, ply+4)); j++) {
    const btn = document.createElement('button');
    btn.className = j === ply?'active':'';
    btn.textContent = j?j+' · '+tapText(moveAt(activeLine(), j-1)):'Start';
    btn.setAttribute('aria-label', 'Go to tap '+j);
    btn.onclick = () => go(j);
    strip.append(btn);
  }
}
function renderBans() {
  const box = $('bans');
  box.replaceChildren();
  $('banCount').textContent = info.banned.length+' barred';
  if (!info.banned.length) {
    box.innerHTML = '<p>Every arithmetic tap leads to a fresh board.</p>';
    if (info.result)box.textContent = 'No repeated tap to inspect.';
    return;
  }
  const p = document.createElement('p');
  p.textContent = 'Jump to the earlier occurrence of the board.';
  box.append(p);
  const chips = document.createElement('div');
  chips.className = 'chips';
  for (const item of info.banned) {
    const b = document.createElement('button');
    b.textContent = tapText(item.move)+' · repeats tap '+item.repeatPly;
    b.onclick = () => go(item.repeatPly);
    chips.append(b);
  }
  box.append(chips);
}
function setWDL(v) {
  if (!v) {
    for (const k of ['A', 'D', 'B']) {
      $('pct'+k).textContent = '—';
      $('prob'+k).style.width = '0';
    }
    return;
  }
  for (const [el, vv] of [['A', v.A], ['D', v.draw], ['B', v.B]]) {
    $('pct'+el).textContent = pct(vv).replace('‹', '<');
    $('prob'+el).style.width = 100*vv+'%';
  }
  $('estimateLabel').textContent = v.source === 'terminal'?'Final result':v.source === 'forced'?'Exact outcome · forced continuation':'Guided 15% vs Guided 15% · calibrated estimate';
}
function showAnalysis() {
  const tr = $('rows');
  tr.replaceChildren();
  const rows = analysis?.candidates || [];
  const result = info.result, proven = analysis?.proven;
  $('proof').hidden = !result && !proven;
  $('proof').textContent = result?(result.winner?'Player '+result.winner+' wins by '+result.reason+'.':'Draw by timeout.'):proven?
  'Proven '+proven+' win'+(analysis.distance != null?' in '+analysis.distance+' tap'+(analysis.distance === 1?'':'s'):'')+'.':'';
  if (!rows.length) {
    const x = document.createElement('tr');
    x.innerHTML = '<td colspan="4">'+(result?'Game over. Step back to examine a tap.':analysis?'No candidates.':'Searching this position…')+'</td>';
    tr.append(x);
  }
  const recorded = moveAt(activeLine(), study.ply);
  rows.forEach((row, i) => {
      const it = document.createElement('tr');
      it.className = row.move === selected?'selected':'';
      const val = row.proven?row.proven+' win':(row.bound === 'lower'?'≥':row.bound === 'upper'?'≤':'')+(row.score>0?'+':'')+row.score;
      it.innerHTML = '<td>'+String(i+1).padStart(2, '0')+'</td><td><button class="candBtn" aria-label="Inspect tap '+esc(row.move)+'">'+esc(tapText(row.move))+'</button></td><td>'+esc(val)+'</td><td>'+([row.move === recorded?'Played':'', row.move === actualMove?'Bot pick':''].filter(Boolean).join(' · ') || '—')+'</td>';
      it.onclick = () => {
        selected = row.move;
        showAnalysis();
      };
      tr.append(it);
    });
  $('searchStatus').textContent = analysis?(result?'Terminal':'Depth '+analysis.depth+' · '+fmt(analysis.nodes)+' nodes'):'Searching…';
  const row = rows.find(r => r.move === selected), pv = $('pv');
  pv.replaceChildren();
  $('pvEnd').textContent = row?(row.end === 'proof frontier'?'Ends at certificate':row.end === 'horizon'?'Search horizon':row.end):'';
  (row?.pv || []).forEach((m, i) => {
      const b = document.createElement('button');
      b.className = ((info.turn === 'A') === (i%2 === 0))?'altA':'altB';
      b.textContent = tapText(m);
      b.title = 'Explore through tap '+(study.ply+i+1);
      b.onclick = () => commitMoves(row.pv.slice(0, i+1));
      pv.append(b);
    });
  $('playCandidate').disabled = $('followPV').disabled = !row;
}
function analysisKey(pos) {
  return [config.engine, config.preset, pos.start.turn, pos.start.a.join(''), pos.start.b.join(''), pos.trace].join(':');
}
function cacheResult(k, r) {
  if (analysisCache.size>=1500)analysisCache.delete(analysisCache.keys().next().value);
  analysisCache.set(k, r);
}
async function analyzeCurrent(pos, rev) {
  const key = analysisKey(pos), engine = config.engine;
  try {
    let r = analysisCache.get(key);
    if (!r) {
      r = checkAnalysis(await channels.analysis.request(engine, 'analyze', {position:pos, limits:presets[config.preset]}), pos);
      cacheResult(key, r);
    }
    if (rev !== revision)return;
    analysis = r;
    selected = r.recommended;
    showAnalysis();
    drawChart();
    if (r.wdl)setWDL(r.wdl);
  } catch (e) {
    if (rev === revision && e.name !== 'AbortError') {
      $('searchStatus').textContent = 'Analysis unavailable';
      $('rows').innerHTML = '<tr><td colspan="4">'+esc(e.message)+'</td></tr>';
    }
  }
}
function drawChart() {
  const canvas = $('chart'), rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height)return;
  const dpr = Math.min(2, window.devicePixelRatio || 1), w = rect.width, h = rect.height;
  canvas.width = w*dpr;
  canvas.height = h*dpr;
  const c = canvas.getContext('2d');
  c.scale(dpr, dpr);
  const y = v => 5+(1-v)*(h-10);
  c.lineWidth = 1;
  for (const v of [0, .25, .5, .75, 1]) {
    c.strokeStyle = v === .5?'#acc4b8':'#e0e8e2';
    c.setLineDash(v === .5?[4, 3]:[]);
    c.beginPath();
    c.moveTo(0, y(v));
    c.lineTo(w, y(v));
    c.stroke();
  }
  c.setLineDash([]);
  const scores = chartMode === 'score', cap = 1000;
  const vals = scores?scoreValues():graphValues;
  const idx = study.ply, fmtVal = v => scores?(Math.abs(v)>5000?(v>0?'A win':'B win'):(v>0?'+':'')+v):'A '+(100*v).toFixed(1)+'%';
  $('chartCaption').textContent = scores?'Search score for Player A · points clipped at ±1,000':'Player A win estimate · Guided self-play';
  $('axisHigh').textContent = scores?'+1k':'100%';
  $('axisMid').textContent = scores?'0':'50%';
  $('axisLow').textContent = scores?'−1k':'0%';
  $('chartValue').textContent = vals[idx] != null?fmtVal(vals[idx]):'…';
  if (!vals.length)return;
  const x = i => 4+i/Math.max(1, vals.length-1)*(w-8), yVal = v => y(scores ? 0.5+clamp(v, -cap, cap)/(2*cap) : v);
  c.lineWidth = 1.85;
  c.strokeStyle = '#277d63';
  c.beginPath();
  let connected = false;
  vals.forEach((v, i) => {
      if (v == null) {
        connected = false;
        return;
      }
      if (connected)c.lineTo(x(i), yVal(v)); else c.moveTo(x(i), yVal(v));
      connected = true;
    });
  c.stroke();
  if (!scores) {
    c.lineTo(x(vals.length-1), h);
    c.lineTo(x(0), h);
    c.closePath();
    const grad = c.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#77ba9475');
    grad.addColorStop(1, '#b7d9bc16');
    c.fillStyle = grad;
    c.fill();
  } else {
    c.fillStyle = '#277d63';
    vals.forEach((v, i) => {
        if (v != null)c.fillRect(x(i)-1.2, yVal(v)-1.2, 2.4, 2.4);
      });
  }
  const px = x(idx);
  c.strokeStyle = '#2d5948';
  c.lineWidth = 1;
  c.beginPath();
  c.moveTo(px, 0);
  c.lineTo(px, h);
  c.stroke();
  if (vals[idx] != null) {
    c.beginPath();
    c.arc(px, yVal(vals[idx]), 4, 0, Math.PI*2);
    c.fillStyle = '#176c55';
    c.fill();
    c.strokeStyle = 'white';
    c.lineWidth = 1.5;
    c.stroke();
  }

}
function updateChart() {
  const line = activeLine(), id = JSON.stringify(study.start)+line;
  $('chartEnd').textContent = 'Tap '+line.length/2;
  if (graphKey === id && graphValues.length && !pendingChart) {
    drawChart();
    return;
  }
  if (pendingChart === id)return;
  graphValues = [];
  $('chartValue').textContent = '…';
  drawChart();
  pendingChart = id;
  channels.chart.request('v2', 'timeline', {position:{start:study.start, trace:line}}).then(r => {
      if (pendingChart !== id)return;
      graphKey = id;
      pendingChart = '';
      graphValues = r.values;
      drawChart();
    }).catch (e => {
      if (pendingChart === id) {
        pendingChart = '';
        failure(e);
      }
    });
}
function simLabel() {
  return simNames[config.policyA]+' vs '+simNames[config.policyB]+' · '+fmt(config.games)+' games · seed '+config.seed;
}
function refresh() {
  const pos = position(study), rev = ++revision;
  info = inspect(replay(pos));
  sourceDigit = null;
  selected = null;
  analysis = null;
  actualMove = null;
  if (channels.pick.active)channels.pick.cancel();
  $('actualStatus').textContent = '';
  $('actualPick').disabled = !!info.result;
  if (channels.analysis.active)channels.analysis.cancel();
  stopSim();
  $('simResults').replaceChildren();
  $('simProgress').textContent = '';
  $('simSpec').textContent = simLabel();
  renderBoard();
  renderTransport();
  renderBans();
  syncArena();
  $('engineName').textContent = nameOf(config.engine);
  $('effort').textContent = presets[config.preset].name+' search';
  setWDL(null);
  showAnalysis();
  updateChart();
  showScan();
  stampStudy();
  if (!analysisCache.get(analysisKey(pos))?.wdl) {
    channels.eval.request('v2', 'evaluate', {position:pos}).then(r => {
        if (rev === revision)setWDL(r.wdl);
      }).catch (failure);
  }
  analyzeCurrent(pos, rev);
}
function syncArena() {
  $('arena').hidden = mode !== 'play';
  $('reviewMode').setAttribute('aria-pressed', String(mode === 'review'));
  $('playMode').setAttribute('aria-pressed', String(mode === 'play'));
  for (const s of ['A', 'B']) {
    $('seat'+s).innerHTML = selectOpts([['human', 'Human'], ...[...engines].map(([id, e]) => [id, e.name])], config['seat'+s]);
  }
  $('autoPlay').textContent = run?'Pause play':'Start play';
  $('autoPlay').disabled = !!info?.result;
  $('oneMove').disabled = !!info?.result || busyPlay || config['seat'+info?.turn] === 'human';
  $('playStatus').textContent = info?.result?'Game over':busyPlay?'Thinking…':run?'Playing':'Paused';
}
function queuePlay() {
  clearTimeout(playTimer);
  if (run && !info.result && config['seat'+info.turn] !== 'human')playTimer = setTimeout(() => engineTurn(), 180);
}
async function engineTurn() {
  if (busyPlay || info.result)return;
  const engine = config['seat'+info.turn];
  if (engine === 'human')return;
  const ticket = ++playRevision, rev = revision, pos = position(study);
  busyPlay = true;
  syncArena();
  try {
    const r = await channels.play.request(engine, 'choose', {position:pos, seed:(config.seed+Math.imul(study.ply, 2654435761))>>>0});
    if (ticket !== playRevision || rev !== revision)return;
    if (!info.legal.includes(r.move))throw Error(nameOf(engine)+' returned an illegal move; play is paused.');
    busyPlay = false;
    commitMoves([r.move], true);
    if (info.result)stopArena(); else syncArena();
  } catch (e) {
    if (ticket === playRevision) {
      stopArena();
      failure(e);
    }
  }
}
function startReplay() {
  if (replayTimer) {
    stopPlayback();
    return;
  }
  stopArena();
  if (study.ply === activeLine().length/2) {
    study.ply = 0;
    refresh();
  }
  replayTimer = setInterval(() => {
      if (study.ply<activeLine().length/2) {
        study.ply++;
        refresh();
      }
      if (study.ply>=activeLine().length/2)stopPlayback();
    }, 750);
  $('playback').textContent = 'Ⅱ';
  $('playback').setAttribute('aria-label', 'Pause replay');
}
function wilson(k, n) {
  const p = k/n, z = 1.95996398454, d = 1+z*z/n, c = (p+z*z/(2*n))/d, r = z*Math.sqrt(p*(1-p)/n+z*z/(4*n*n))/d;
  return [Math.max(0, (c-r)*100).toFixed(1), Math.min(100, (c+r)*100).toFixed(1)].join('–')+'%';
}
async function runSim() {
  if (simBusy) {
    stopSim();
    $('simProgress').textContent = 'Stopped';
    return;
  }
  const rev = revision, token = ++simToken, pos = position(study), k = config.games, seed = config.seed;
  simBusy = true;
  $('simulate').textContent = 'Stop';
  $('simResults').replaceChildren();
  let done = 0;
  const counts = {A:0, draw:0, B:0};
  try {
    while (done<k) {
      const n = Math.min([config.policyA, config.policyB].some(p => p === 'v1' || p === 'v2')?1:64, k-done);
      $('simProgress').textContent = done+' / '+k;
      const r = await channels.sim.request('guided', 'simulate', {position:pos, games:n, seed:(seed+Math.imul(done, 2654435761))>>>0, policyA:config.policyA, policyB:config.policyB});
      if (token !== simToken || rev !== revision)return;
      for (const key of ['A', 'draw', 'B'])counts[key] += r.counts[key];
      done += n;
      $('simProgress').textContent = fmt(done)+' / '+fmt(k)+' completed';
      $('simResults').innerHTML = '<table><thead><tr><th>Outcome</th><th>Games</th><th>Rate</th><th>95% interval</th></tr></thead><tbody>'+[['A', 'A wins'], ['draw', 'Timeout draw'], ['B', 'B wins']].map(([id, label]) => '<tr><td>'+label+'</td><td>'+counts[id]+'</td><td>'+(100*counts[id]/done).toFixed(1)+'%</td><td>'+wilson(counts[id], done)+'</td></tr>').join('')+'</tbody></table><small>Wilson intervals for the selected policies.</small>';
    }
    $('simProgress').textContent = fmt(k)+' completed';
  } catch (e) {
    failure(e);
  } finally {
    if (token === simToken) {
      simBusy = false;
      $('simulate').textContent = 'Run simulations';
    }
  }
}
function scoreFor(r) {
  if (r.terminal)return r.terminal.winner === 'A'?10000:r.terminal.winner === 'B'?-10000:0;
  if (r.proven)return r.proven === 'A'?10000:-10000;
  const row = r.candidates.find(x => x.move === r.recommended);
  return row?(r.turn === 'A'?1:-1)*row.score:null;
}
function scoreValues() {
  const values = Array(activeLine().length/2+1).fill(null);
  if (scanState?.key === scanKey())(scanState.scores || []).forEach((v, i) => values[i] = v);
  if (analysis)values[study.ply] = scoreFor(analysis);
  return values;
}
function scanKey() {
  return analysisKey({start:study.start, trace:activeLine()});
}
function showScan() {
  const k = scanKey();
  if (scanState?.key !== k) {
    stopScan();
    scanState = annotations.get(k) ?? null;
  }
  const s = scanState;
  $('scan').textContent = scanBusy?'Stop scan':s?.finished?'Scan again':s?.done?'Continue scan':'Scan line';
  $('scanProgress').textContent = s?(s.finished?'Complete':'Checked '+s.done+' / '+s.total):'';
  const box = $('scanMarks');
  box.replaceChildren();
  for (const [key, label] of [['difference', 'First alternative'], ['proof', 'First proof']]) {
    if (s?.[key] != null) {
      const b = document.createElement('button');
      b.textContent = label+' · tap '+s[key];
      b.onclick = () => go(s[key]);
      box.append(b);
    }
  }
  if (s?.finished && s.difference == null)box.append(' Every played tap was top-ranked.');
}
async function scan() {
  if (scanBusy) {
    stopScan();
    showScan();
    return;
  }
  const line = activeLine(), k = scanKey(), token = ++scanToken;
  if (scanState?.finished || !scanState)scanState = {key:k, done:0, total:line.length/2+1, difference:null, proof:null, finished:false, scores:[]};
  const s = scanState;
  annotations.set(k, s);
  scanBusy = true;
  showScan();
  try {
    while (s.done<s.total) {
      const i = s.done, pos = {start:study.start, trace:line.slice(0, 2*i)}, ak = analysisKey(pos);
      let r = analysisCache.get(ak);
      if (!r) {
        r = checkAnalysis(await channels.scan.request(config.engine, 'analyze', {position:pos, limits:presets[config.preset]}), pos);
        cacheResult(ak, r);
      }
      if (token !== scanToken)return;
      if (s.proof === null && r.proven)s.proof = i;
      const rec = moveAt(line, i), picked = r.candidates.find(x => x.move === rec), top = r.candidates.find(x => x.move === r.recommended);
      if (s.difference === null && picked && top && (picked.proven !== top.proven || (!top.proven && picked.score !== top.score)))s.difference = i;
      s.scores[i] = scoreFor(r);
      s.done = i+1;
      showScan();
      if (chartMode === 'score')drawChart();
      if (i%10 === 0)await new Promise(resolve => setTimeout(resolve, 0));
    }
    s.finished = true;
  } catch (e) {
    failure(e);
  } finally {
    if (token === scanToken) {
      scanBusy = false;
      showScan();
    }
  }
}
function wire() {
  document.querySelectorAll('[data-open]').forEach(b => b.onclick = () => dialog(b.dataset.open));
  $('navWork').onclick = () => window.scrollTo({top:0, behavior:'smooth'});
  $('editBoard').onclick = () => dialog('edit');
  $('simSettings').onclick = () => dialog('simulation');
  $('settings').onclick = () => dialog('settings');
  $('dialog').addEventListener('click', e => {
      if (e.target === $('dialog')) {
        const r = $('dialog').getBoundingClientRect();
        if (e.clientX<r.left || e.clientX>r.right || e.clientY<r.top || e.clientY>r.bottom)$('dialog').close();
      }
    });
  $('cancelTap').onclick = () => {
    sourceDigit = null;
    renderBoard();
  };
  $('scrub').oninput = e => go(+e.target.value);
  $('first').onclick = () => go(0);
  $('last').onclick = () => go(activeLine().length/2);
  $('prev').onclick = () => go(study.ply-1);
  $('next').onclick = () => go(study.ply+1);
  $('playback').onclick = startReplay;
  $('playCandidate').onclick = () => {
    if (selected)commitMoves([selected]);
  };
  $('followPV').onclick = () => {
    const r = analysis?.candidates.find(x => x.move === selected);
    if (r)commitMoves(r.pv);
  };
  for (const m of ['review', 'play'])$(m+'Mode').onclick = () => {
    pauseAll();
    mode = m;
    renderBoard();
    syncArena();
    if (m === 'play')$('arena').scrollIntoView({block:'nearest'});
  };
  for (const s of ['A', 'B'])$('seat'+s).onchange = e => {
    const value = e.target.value;
    stopArena();
    config['seat'+s] = value;
    save('config', config);
    renderBoard();
    syncArena();
  };
  $('arenaNew').onclick = () => {
    openStudy(createStudy('New game'));
    mode = 'play';
    renderBoard();
    syncArena();
  };
  $('actualPick').onclick = async() => {
    const rev = revision, engine = config.engine, seed = (config.seed+Math.imul(study.ply, 2654435761))>>>0;
    $('actualPick').disabled = true;
    $('actualStatus').textContent = 'Thinking…';
    try {
      const r = await channels.pick.request(engine, 'choose', {position:position(study), seed});
      if (rev !== revision)return;
      if (!info.legal.includes(r.move))throw Error('Engine returned an illegal tap.');
      actualMove = r.move;
      $('actualStatus').textContent = tapText(r.move)+' · playing limits · seed '+seed;
      showAnalysis();
    } catch (e) {
      if (rev === revision) {
        failure(e);
        $('actualStatus').textContent = 'Unavailable';
      }
    }
    finally {
      if (rev === revision)$('actualPick').disabled = false;
    }
  };
  $('oneMove').onclick = engineTurn;
  $('autoPlay').onclick = () => {
    if (run)stopArena(); else {
      stopPlayback();
      run = true;
      syncArena();
      queuePlay();
    }
  };
  $('lineSelect').onchange = e => {
    const idx = +e.target.value;
    pauseAll();
    study.active = idx;
    go(Math.min(study.ply, activeLine().length/2));
  };
  $('returnMain').onclick = () => {
    pauseAll();
    const where = forkPly(activeLine(), study.lines[0]);
    study.active = 0;
    go(where);
  };
  $('chartMode').onchange = e => {
    chartMode = e.target.value;
    drawChart();
    if (chartMode === 'score' && !scanState?.finished && !scanBusy) {
      document.querySelector('.reviewDetail').open = true;
      scan();
    }
  };
  $('simulate').onclick = runSim;
  $('scan').onclick = scan;
  $('exportStudy').onclick = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(study, null, 2)], {type:'application/json'}));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'tapgame-study.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 3000);
  };
  $('importBtn').onclick = () => $('fileInput').click();
  $('fileInput').onchange = async e => {
    try {
      const f = e.target.files[0];
      if (!f)return;
      if (f.size>3000000)throw Error('Study file is too large.');
      openStudy(importStudy(JSON.parse(await f.text())));
    } catch (err) {
      failure(err);
    } finally {
      e.target.value = '';
    }
  };
  $('chart').onclick = e => {
    const r = e.currentTarget.getBoundingClientRect();
    go((e.clientX-r.left-4)/(r.width-8)*(activeLine().length/2));
  };
  $('chart').onpointermove = e => {
    const r = e.currentTarget.getBoundingClientRect(), n = clamp(Math.round((e.clientX-r.left-4)/(r.width-8)*(graphValues.length-1)), 0, graphValues.length-1);
    const value = chartMode === 'score'?scoreValues()[n]:graphValues[n];
    if (value != null)e.currentTarget.title = 'Tap '+n+' · A '+(chartMode === 'score'?(value>0?'+':'')+value:pct(value));
  };
  new ResizeObserver(drawChart).observe($('chartWrap'));
  document.addEventListener('keydown', e => {
      if ($('dialog').open || ['SELECT', 'INPUT', 'TEXTAREA'].includes(document.activeElement.tagName) || e.ctrlKey || e.metaKey || e.altKey)return;
      const key = e.key;
      if (key === 'ArrowLeft')go(study.ply-1); else if (key === 'ArrowRight')go(study.ply+1); else if (key === 'Home')go(0); else if (key === 'End')go(activeLine().length/2);
      else if (key === ' ' && document.activeElement.tagName !== 'BUTTON')startReplay(); else if (key === 'Escape') {
        sourceDigit = null;
        renderBoard();
        stopArena();
      } else return;
      e.preventDefault();
    });
  document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        stopPlayback();
        stopArena();
      }
    });
}
async function boot() {
  try {
    await discover();
  } catch {/* Static hosting works without a local bridge. */}
  if (!engines.get(config.engine)?.search)config.engine = 'v2';
  for (const s of ['A', 'B'])if (config['seat'+s] !== 'human' && !engines.has(config['seat'+s]))config['seat'+s] = defaults['seat'+s];
  try {
    const stored = read('current', null), url = new URLSearchParams(location.search);
    if (url.has('game')) {
      const n = Number(url.get('tap') ?? 0);
      study = await loadGame(url.get('suite') || 'v2-v1', Number(url.get('game')), Number.isInteger(n)?n:0);
    } else study = stored?importStudy(stored):await loadGame('v2-v1', 1, 12);
  } catch (e) {
    study = createStudy('Opening');
    notice(e.message);
  }
  wire();
  refresh();
}
boot();
