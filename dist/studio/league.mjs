const names = {v2:'V2', v1:'V1', heuristic:'Heuristic', random:'Random'};
const bots = Object.keys(names);
const percent = value => (100*value).toFixed(2)+'%';
const signed = value => value > 0 ? '+'+Math.round(value) : String(Math.round(value));
const shortInterval = value => Math.round(value.low)+' to '+Math.round(value.high);
const get = id => document.getElementById(id);

function showReport(data) {
  const leader = data.ratings.v2;
  get('heroElo').textContent = signed(leader.elo);
  get('heroRange').textContent = '95% interval '+shortInterval(leader);
  const grid = Object.fromEntries(bots.map(bot => [bot,{}]));
  for (const m of data.matches) {
    grid[m.first][m.second] = m.score;
    grid[m.second][m.first] = 1-m.score;
    const slug = m.first+'-'+m.second;
    const row = get('records').tBodies[0].insertRow();
    row.innerHTML = '<th scope="row"><a href="index.html?suite=league/'+slug+'&amp;game=1">'+names[m.first]+' vs '+names[m.second]+'</a></th>'+
      [m.all.win,m.all.draw,m.all.loss,m.firstSeat.win+' / 1,000',m.secondSeat.win+' / 1,000'].map(n=>'<td>'+n+'</td>').join('')+
      '<td><a href="../data/league/'+slug+'.csv" download>CSV</a></td>';
  }
  get('matrix').innerHTML += '<thead><tr><th>Bot</th>'+bots.map(b=>'<th>'+names[b]+'</th>').join('')+'</tr></thead><tbody>'+
    bots.map(b=>'<tr><th scope="row">'+names[b]+'</th>'+bots.map(o=>{
      if (o === b) return '<td class="diag">—</td>';
      const s = grid[b][o];
      return '<td class="'+(s>0.5?'high':s<0.5?'low':'')+'">'+percent(s)+'</td>';
    }).join('')+'</tr>').join('')+'</tbody>';
  for (const bot of [...bots].sort((a,b)=>data.ratings[b].elo-data.ratings[a].elo)) {
    const r = data.ratings[bot];
    get('ratings').tBodies[0].insertRow().innerHTML = '<th scope="row">'+names[bot]+'</th><td>'+signed(r.elo)+'</td><td>'+
      (bot==='random'?'Fixed anchor':shortInterval(r))+'</td>';
  }
  const m = data.matches.find(m=>m.first==='v2' && m.second==='random');
  const direct = m.direct_elo === null ? 'an unbounded direct Elo gap' : 'a direct Elo difference of '+signed(m.direct_elo);
  get('direct').textContent = 'V2 scored '+percent(m.score)+' against Random, giving '+direct+
    '. The four-bot fit places V2 at '+signed(leader.elo)+' relative to Random because it also uses both bots’ results against V1 and Heuristic.';
  const worst = data.matches.reduce((a,b)=>Math.abs(a.score-a.fitted_score)>Math.abs(b.score-b.fitted_score)?a:b);
  get('misfit').textContent = 'The largest gap between the rating prediction and the observed score is '+names[worst.first]+' vs '+names[worst.second]+
    '. The fit predicts '+percent(worst.fitted_score)+' for '+names[worst.first]+', which scored '+percent(worst.score)+' in play.';
}
try {
  const response = await fetch('../data/league/results.json');
  if (!response.ok) throw Error();
  showReport(await response.json());
} catch {
  const error = get('reportError');
  error.hidden = false;
  error.textContent = 'Could not load the tournament results. Reload to try again.';
}
