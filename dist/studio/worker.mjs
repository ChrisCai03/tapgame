import {readTables} from './policy.mjs';
import {readV3} from './v3.mjs';
import {respond} from './protocol.mjs';
const data = Promise.all(['assets/tables.bin', 'assets/wdl.json'].map(async (name, i) => {
      const r = await fetch(new URL(name, import.meta.url));
      if (!r.ok)throw Error('Could not load '+name);
      return i?r.json():readTables(await r.arrayBuffer());
    }));
let book;
self.onmessage = async ({data:request}) => {
  try {
    const [tables, model] = await data;
    if ([request.engine, request.policyA, request.policyB].includes('v3')) {
      book ??= fetch(new URL('assets/v3.bin',import.meta.url)).then(async r=>{
        if(!r.ok) throw Error('Could not load V3 proof book.');
        return readV3(await r.arrayBuffer());
      }).catch(error=>{book=null;throw error;});
      tables.v3=await book;
    }
    self.postMessage(respond(request, tables, model));
  }
  catch (e) {
    self.postMessage({v:1, id:request.id, ok:false, error:{code:'engine_unavailable', message:e.message}});
  }
};
