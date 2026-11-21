// Serve the graphical workbench and bridge explicitly registered local TGEP executables.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
const root = fileURLToPath(new URL('../dist/', import.meta.url)), project = path.dirname(root.slice(0, -1));
let port = 8787, config;
for (let i = 2; i<process.argv.length; i += 2) {
  if (process.argv[i] === '--port')port = Number(process.argv[i+1]);
  else if (process.argv[i] === '--engines')config = process.argv[i+1];
  else throw Error('Use --port PORT and/or --engines engines.json');
}
const list = config?JSON.parse(fs.readFileSync(config, 'utf8')):[];
const entries = new Map();
for (const item of list) {
  if (!/^[a-z0-9_-]{1,40}$/.test(item.id) || entries.has(item.id) || !Array.isArray(item.argv) || !item.argv.length || item.argv.some(a => typeof a !== 'string'))throw Error('Each engine needs a unique id and an argv array.');
  entries.set(item.id, {...item, proc:null, pending:null, queue:Promise.resolve(), serial:0});
}
function stop(entry, reason) {
  const proc = entry.proc;
  entry.proc = null;
  if (proc)proc.kill();
  entry.pending?.reject(Error(reason));
  entry.pending = null;
}
function start(entry) {
  if (entry.proc)return;
  const proc = spawn(entry.argv[0], entry.argv.slice(1), {cwd:project, shell:false, stdio:['pipe', 'pipe', 'inherit']});
  entry.proc = proc;
  let buffer = '';
  const fail = e => {
    if (entry.proc === proc)stop(entry, e.message || 'Engine exited.');
  };
  proc.on('error', fail);
  proc.on('exit', () => fail(Error('Engine exited.')));
  proc.stdin.on('error', fail);
  proc.stdout.setEncoding('utf8');
  proc.stdout.on('data', chunk => {
      if (entry.proc !== proc)return;
      buffer += chunk;
      if (buffer.length>2*1024*1024)return fail(Error('Engine response too large.'));
      let split;
      while ((split = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, split);
        buffer = buffer.slice(split+1);
        if (!line.trim())continue;
        try {
          const r = JSON.parse(line), p = entry.pending;
          if (!p || r.v !== 1 || r.id !== p.id || typeof r.ok !== 'boolean')throw Error('Invalid TGEP reply or mismatched id.');
          entry.pending = null;
          p.resolve({...r, id:p.clientId});
        } catch (e) {
          fail(e);
          break;
        }
      }
    });
}
function exchange(entry, req) {
  const run = async() => {
    start(entry);
    const id = ++entry.serial;
    let timer;
    try {
      return await new Promise((resolve, reject) => {
          entry.pending = {id, clientId:req.id, resolve, reject};
          timer = setTimeout(() => stop(entry, 'Engine timed out.'), 30000);
          entry.proc.stdin.write(JSON.stringify({...req, id})+'\n');
        });
    } finally {
      clearTimeout(timer);
    }
  };
  const result = entry.queue.then(run, run);
  entry.queue = result.catch (() => {});
  return result;
}
const types = {'.html':'text/html', '.css':'text/css', '.mjs':'text/javascript', '.json':'application/json', '.csv':'text/csv', '.bin':'application/octet-stream'};
const app = http.createServer(async(req, res) => {
    const json = (status, body) => {
      res.writeHead(status, {'Content-Type':'application/json', 'Cache-Control':'no-store'});
      res.end(JSON.stringify(body));
    };
    try {
      const host = req.headers.host;
      if (!host || !/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host) || (req.headers.origin && req.headers.origin !== 'http://'+host))return json(403, {error:'Loopback origin required.'});
      const url = new URL(req.url, 'http://'+host);
      if (req.method === 'GET' && url.pathname === '/tgep/engines')return json(200, [...entries].map(([id, e]) => ({id, name:e.name || id})));
      if (req.method === 'POST' && url.pathname.startsWith('/tgep/engine/')) {
        const e = entries.get(url.pathname.slice('/tgep/engine/'.length));
        if (!e)return json(404, {error:'Unregistered engine.'});
        let text = '';
        for await(const chunk of req) {
          text += chunk;
          if (text.length>512*1024)return json(413, {error:'Request too large.'});
        }
        const msg = JSON.parse(text);
        if (!msg || msg.v !== 1 || !['hello', 'choose', 'analyze'].includes(msg.cmd))return json(400, {error:'Unsupported bridge request.'});
        return json(200, await exchange(e, msg));
      }
      if (req.method !== 'GET' && req.method !== 'HEAD')return json(405, {error:'Method not allowed.'});
      let name = decodeURIComponent(url.pathname);
      if (name === '/') {
        res.writeHead(302, {Location:'/studio/'});
        return res.end();
      }
      if (name.endsWith('/'))name += 'index.html';
      const file = path.resolve(root, '.'+name);
      if (!file.startsWith(root) || !fs.existsSync(file) || !fs.statSync(file).isFile())return json(404, {error:'File unavailable.'});
      res.writeHead(200, {'Content-Type':types[path.extname(file)] || 'application/octet-stream', 'X-Content-Type-Options':'nosniff'});
      if (req.method === 'HEAD')return res.end();
      fs.createReadStream(file).on('error', () => res.destroy()).pipe(res);
    } catch (e) {
      if (!res.headersSent)json(400, {error:e.message}); else res.end();
    }
  });
app.listen(port, '127.0.0.1');
await once(app, 'listening');
console.log('Tapgame Studio: http://127.0.0.1:'+app.address().port+'/studio/');
function shutdown() {
  for (const e of entries.values())stop(e, 'Server stopping.');
  app.close();
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
