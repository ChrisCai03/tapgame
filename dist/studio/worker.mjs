import {readTables} from './policy.mjs';
import {respond} from './protocol.mjs';
const data = Promise.all(['assets/tables.bin', 'assets/wdl.json'].map(async (name, i) => {
      const r = await fetch(new URL(name, import.meta.url));
      if (!r.ok)throw Error('Could not load '+name);
      return i?r.json():readTables(await r.arrayBuffer());
    }));
self.onmessage = async ({data:request}) => {
  try {
    const [tables, model] = await data;
    self.postMessage(respond(request, tables, model));
  }
  catch (e) {
    self.postMessage({v:1, id:request.id, ok:false, error:{code:'engine_unavailable', message:e.message}});
  }
};
