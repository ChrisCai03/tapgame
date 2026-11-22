const byId = id => document.getElementById(id);
const pct = score => (100 * score).toFixed(1) + '%';
try {
  const response = await fetch('../data/v3/results.json');
  if (!response.ok) throw Error('The championship data could not be loaded.');
  const data = await response.json();
  byId('score').textContent = pct(data.all.win / data.all.games);
  const [lower, upper] = data.paired_score_ci95;
  byId('interval').textContent = '95% score interval '+pct(lower)+'–'+pct(upper);
  for (const [key, label] of [['all','Both seats'],['first','V3 first'],['second','V3 second']]) {
    const row = byId('rows').insertRow(), stats = data[key];
    const header = document.createElement('th');
    header.scope = 'row';
    header.textContent = label;
    row.append(header);
    for (const value of [stats.win, stats.draw, stats.loss, pct(stats.win / stats.games)]) {
      row.insertCell().textContent = value;
    }
  }
  byId('rating').textContent = 'The head-to-head score corresponds to '+Math.round(data.head_to_head_elo)+
    ' Elo points for V3 relative to V2. The 95% interval is '+Math.round(data.elo_ci95[0])+' to '+
    Math.round(data.elo_ci95[1])+' points, resampling the 160 opening draws with their seat-swapped games together.';
} catch (error) {
  byId('reportError').hidden = false;
  byId('reportError').textContent = error.message;
}
