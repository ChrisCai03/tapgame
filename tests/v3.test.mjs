import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {H,N,live,code,size,drop,next,key,replay,inspect} from '../dist/studio/rules.mjs';
import {readV3,V3Context} from '../dist/studio/v3.mjs';
import {readTables} from '../dist/studio/policy.mjs';
import {respond} from '../dist/studio/protocol.mjs';
import {checkAnalysis} from '../dist/studio/client.mjs';
import {openingFromId,openingProof} from '../dist/studio/openings.mjs';

const root=new URL('../',import.meta.url);
const read=path=>fs.readFileSync(new URL(path,root));
function binary(path) {const bytes=read(path);return bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);}
const tables=readTables(binary('dist/studio/assets/tables.bin'));
const book=tables.v3=readV3(binary('dist/studio/assets/v3.bin'));
const model=JSON.parse(read('dist/studio/assets/wdl.json'));

// Independent verifier: constrain the winning player's quiet moves to the
// published set. The opponent can play every legal reply. Check smaller phases
// first, so a withdrawal may only cite a previously verified result.
test('all 13,934 V3 strategy supports and their winning taps verify against the browser rules', () => {
  const seen=new Uint8Array(N), allowed=new Uint8Array(N), checked=new Uint8Array(N);
  const n=[0,0,0,0,0,0,0], full=[0,0];
  function works(s,t,winner,rootMove=0) {
    for(let e=9*s;e<9*s+size[s];e++) {
      const child=next[e],named=key(child,1-t);
      if(seen[named])continue;
      if(t===winner && (rootMove && code[e]!==rootMove || !drop(e) && !allowed[named]))continue;
      let ok;
      if(drop(e)) {
        if(child%H===0)ok=t===winner;
        else ok=checked[child] && book.cert[child]===(t===winner?-1:1);
      } else {
        seen[named]=1;ok=works(child,1-t,winner);seen[named]=0;
      }
      if(t===winner && ok)return true;
      if(t!==winner && !ok)return false;
    }
    return t!==winner;
  }
  for(let phase=2;phase<=6;phase++) for(let s=0;s<N;s++) {
    if(!size[s] || live[Math.floor(s/H)]+live[s%H]!==phase || !book.cert[s])continue;
    assert.ok(book.supportMove[s]>=0);
    const keys=book.keys.subarray(book.offsets[s],book.offsets[s+1]);
    for(const k of keys)allowed[k]=1;
    assert.equal(allowed[s],0);
    seen[s]=1;
    const winner=book.cert[s]>0?0:1;
    assert.ok(works(s,0,winner,book.supportMove[s]),'support '+s);
    if(book.cert[s]>0)assert.equal(book.move[s],book.supportMove[s]);
    checked[s]=1;n[phase]++;
    if(phase===6)full[winner]++;
    seen[s]=0;for(const k of keys)allowed[k]=0;
  }
  assert.deepEqual(n.slice(2),[81,810,3793,6343,2907]);
  assert.deepEqual(full,[2787,120]);
});

const games=read('dist/data/league/v2-v1.csv').toString().trim().split(/\r?\n/).slice(1);
function samples() {
  return Array.from({length:64},(_,i)=>{
    const row=games[(i*71+17)%games.length].split(',');
    const start=openingFromId(Number(row[10])), n=Math.floor(Number(row[5])*((i*137)%991)/991);
    return {start,trace:row[7].slice(0,n*2)};
  });
}

test('V3 analysis reports legal continuations with active repetition histories', () => {
  for(const pos of samples().filter((_,i)=>i%8===0)) {
    const reply=respond({v:1,id:1,cmd:'analyze',engine:'v3',position:pos,limits:{nodes:4500,depth:12}},tables,model);
    assert.ok(reply.ok,reply.error?.message);
    checkAnalysis(reply.result,pos);
  }
});

test('native and TGEP V3 choose identical taps on both seats and midgame histories', {skip:!process.env.TAPGAME_V3}, () => {
  const positions=samples();
  for(const [nodes,depth] of [[4500,12],[500000,32]]) {
    const list=nodes===4500?positions:positions.filter((_,i)=>i%4===0);
    const input=list.map(({start,trace})=>'17 '+(trace || '-')+' '+start.turn+start.a.join('')+start.b.join('')).join('\n')+'\n';
    const reference=execFileSync(process.env.TAPGAME_V3,['choose','model/values.txt','v2/values.txt',String(nodes),'12',String(depth)],{input,encoding:'utf8'}).trim().split('\n').map(s=>s.replaceAll(' ',''));
    for(const [i,position] of list.entries()) {
      const r=respond({v:1,id:i,cmd:'choose',engine:'v3',position,limits:{nodes,depth},seed:17},tables,model);
      assert.ok(r.ok,r.error?.message);
      assert.equal(r.result.move,reference[i],'sample '+i+' limit '+nodes);
    }
  }
});

test('V3 advertises the measured playing limits and analyzes every legal tap at the minimum budget', () => {
  const hello = respond({v:1,id:1,cmd:'hello',engine:'v3'},tables,model);
  assert.deepEqual(hello.result.defaultLimits,{nodes:500000,depth:32});
  for (const pos of samples().filter((_,i)=>i%6===0)) {
    const r=respond({v:1,id:2,cmd:'analyze',engine:'v3',position:pos,limits:{nodes:16,depth:32}},tables,model);
    assert.ok(r.ok,r.error?.message);
    checkAnalysis(r.result,pos);
  }
});

test('all earlier opening proofs agree with the expanded book', () => {
  const old=read('dist/studio/assets/opening-proofs.bin');
  let kept=0;
  for(let id=0;id<54450;id+=2) {
    const start=openingFromId(id), proof=openingProof(start,old);
    if(!proof) continue;
    assert.equal(book.cert[replay({start}).s], proof.winner==='A'?1:-1);
    kept++;
  }
  assert.equal(kept,2781);
});

test('the same visible 9 against 8 has opposite forced winners under two legal histories', () => {
  const history={start:openingFromId(54190),trace:'91199669556995544953389118'};
  const p=replay(history);
  const fresh={start:{a:[0,0,9],b:[0,0,8],turn:'B'},trace:''};
  assert.equal(p.s,replay(fresh).s);
  assert.equal(p.t,replay(fresh).t);
  assert.equal(new V3Context(tables,p).supported(p.s,p.t,p.quiet),0);
  for(const [position,expected] of [[fresh,'B'],[history,'A']]) {
    const r=respond({v:1,id:1,engine:'v3',cmd:'analyze',position},tables,model);
    assert.ok(r.ok,r.error?.message);
    assert.equal(checkAnalysis(r.result,position).proven,expected);
  }
});

test('all 320 championship games replay to the recorded outcome in Studio', () => {
  const records=read('dist/data/v3/championship.csv').toString().trim().split(/\r?\n/).slice(1);
  assert.equal(records.length,320);
  for(const line of records) {
    const [, , first, result, reason, taps, , trace, raw, , id]=line.split(',');
    const start=openingFromId(Number(id));
    assert.equal(start.turn+start.a.join('')+start.b.join(''),raw);
    const state=inspect(replay({start,trace}));
    assert.equal(state.ply,Number(taps));
    const opponent=start.turn==='A'?'B':'A';
    const winner=result==='draw'?null:((result==='win')===(first==='1')?start.turn:opponent);
    assert.deepEqual(state.result,{winner,reason:{blocked:'blockade',cleared:'clearance',timeout:'timeout'}[reason]});
  }
});
