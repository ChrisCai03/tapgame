import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import {replay, inspect, step, terminal} from '../dist/studio/rules.mjs';

test('discover subprocess engines, play a complete cross-language match and validate the reply contract', async() => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tap-bridge-')), file = path.join(dir, 'engines.json');
    const entries = [{id:'python', argv:['python3', 'studio/example_bot.py']}, {id:'javascript', argv:['node', 'studio/engine.mjs', '--engine', 'v1']}];
    if (process.env.TAPGAME_NATIVE)entries.push({id:'native', argv:['node', 'studio/native.mjs', process.env.TAPGAME_NATIVE]});
    fs.writeFileSync(file, JSON.stringify(entries));
    const child = spawn(process.execPath, ['studio/server.mjs', '--port', '0', '--engines', file], {stdio:['ignore', 'pipe', 'inherit']});
    const closed = once(child, 'exit');
    try {
      const line = readline.createInterface({input:child.stdout});
      const [ready] = await once(line, 'line');
      line.close();
      const base = new URL(ready.split(' ').at(-1)).origin;
      const inventory = await (await fetch(base+'/tgep/engines')).json();
      assert.deepEqual(inventory.map(x => x.id), entries.map(x => x.id));
      let serial = 0;
      const command = async(id, cmd, fields = {}) => {
        const req = {v:1, id:++serial, cmd, ...fields};
        const r = await (await fetch(base+'/tgep/engine/'+id, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(req)})).json();
        assert.equal(r.id, req.id);
        assert.equal(r.ok, true, JSON.stringify(r));
        return r.result;
      };
      for (const {id} of entries) {
        const h = await command(id, 'hello');
        assert.ok(h.commands.includes('choose'));
        assert.equal(h.version, 1);
      }
      const pos = {trace:''}, p = replay(pos);
      while (!terminal(p)) {
        const r = await command(p.t?'python':'javascript', 'choose', {position:pos, seed:80+p.ply});
        assert.ok(inspect(p).legal.includes(r.move));
        step(p, r.move);
        pos.trace += r.move;
        assert.ok(p.ply<1000);
      }
      assert.equal((await command('python', 'choose', {position:pos})).move, null);
      assert.equal((await command('javascript', 'choose', {position:pos})).move, null);
      if (process.env.TAPGAME_NATIVE) {
        const start = {a:[0, 0, 2], b:[0, 0, 8], turn:'B'}, r = await command('native', 'analyze', {position:{start, trace:''}});
        assert.equal(r.proven, 'B');
        assert.deepEqual(r.candidates[0].pv, ['82']);
        assert.equal(r.distance, 1);
        const choice = await command('native', 'choose', {position:{start, trace:''}});
        assert.equal(choice.move, '82');
        const full = {trace:''}, q = replay(full);
        while (!terminal(q)) {
          const pick = await command(q.t?'javascript':'native', 'choose', {position:full, seed:712+q.ply});
          step(q, pick.move);
          full.trace += pick.move;
        }
        assert.ok(q.ply>0);
        console.log('Native v2 vs stdio v1: '+q.ply+' taps; '+JSON.stringify(terminal(q)));
      }
      const status = await fetch(base+'/studio/');
      assert.equal(status.status, 200);
      assert.match(await status.text(), /Analysis workbench/);
    } finally {
      child.kill();
      await closed;
      fs.rmSync(dir, {recursive:true, force:true});
    }
  });
