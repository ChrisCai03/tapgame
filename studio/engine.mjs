// Standalone TGEP/1 engine. Keep diagnostics on stderr and responses on stdout.
import {readV3} from '../dist/studio/v3.mjs';
import fs from 'node:fs';
import readline from 'node:readline';
import {readTables} from '../dist/studio/policy.mjs';
import {respond, ENGINE_NAMES} from '../dist/studio/protocol.mjs';
const args = process.argv.slice(2), engine = args[1] ?? 'v2';
if ((args.length && (args[0] !== '--engine' || args.length !== 2)) || !Object.hasOwn(ENGINE_NAMES, engine)) {
  console.error('Usage: node studio/engine.mjs [--engine v3|v2|v1|guided|heuristic|random]');
  process.exit(2);
}
const bytes = fs.readFileSync(new URL('../dist/studio/assets/tables.bin', import.meta.url));
const tables = readTables(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset+bytes.byteLength));
function loadV3() {
  const bytes=fs.readFileSync(new URL('../dist/studio/assets/v3.bin',import.meta.url));
  tables.v3=readV3(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
}
const model = JSON.parse(fs.readFileSync(new URL('../dist/studio/assets/wdl.json', import.meta.url)));
for await(const line of readline.createInterface({input:process.stdin, crlfDelay:Infinity})) {
  let response;
  try {
    const request=JSON.parse(line);
    if(!tables.v3 && [engine,request.policyA,request.policyB].includes('v3'))loadV3();
    response = respond(request, tables, model, engine);
  }
  catch {
    response = {v:1, id:null, ok:false, error:{code:'parse_error', message:'Invalid JSON.'}};
  }
  process.stdout.write(JSON.stringify(response)+'\n');
}
