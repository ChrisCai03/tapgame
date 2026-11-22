import {N,H,QUIET,aHand,code,drop,key,live,next,size} from './rules.mjs';

export function readV3(buffer) {
  const view = new DataView(buffer);
  if (view.byteLength < 4+12*N || view.getUint32(0) !== 0x54475633) throw Error('Invalid V3 proof book.');
  const fields = Array.from({length:5},()=>new Int16Array(N));
  for (let s=0;s<N;s++) for (let j=0;j<5;j++) fields[j][s]=view.getInt16(4+10*s+2*j,true);
  const [cert,move,guide,rank,value]=fields;
  const offsets=new Uint32Array(N+1), supportMove=new Int16Array(N).fill(-1), keys=[];
  let cursor=4+10*N;
  for(let s=0;s<N;s++) {
    offsets[s]=keys.length;
    const length=view.getUint16(cursor,true);cursor+=2;
    if(length===65535)continue;
    supportMove[s]=view.getUint16(cursor,true);cursor+=2;
    for(let i=0;i<length;i++){keys.push(view.getUint16(cursor,true));cursor+=2;}
  }
  offsets[N]=keys.length;
  if(cursor!==view.byteLength)throw Error('Invalid proof support data.');
  return {cert,move,guide,rank,value,offsets,supportMove,keys:Uint16Array.from(keys)};
}

let topology;
function buildTopology() {
  const groups=Array.from({length:16},()=>[]), count=new Uint32Array(2*N+1);
  for (let t=0;t<2;t++) for (let s=0;s<N;s++) {
    if (!size[s]) continue;
    const named=key(s,t);
    groups[4*live[aHand(named)]+live[named%H]].push(t*N+s);
    for (let e=9*s;e<9*s+size[s];e++) if (!drop(e)) count[(1-t)*N+next[e]+1]++;
  }
  for (let i=1;i<count.length;i++) count[i]+=count[i-1];
  const index=count.slice(), parents=new Int32Array(count[2*N]);
  for (let t=0;t<2;t++) for (let s=0;s<N;s++) for (let e=9*s;e<9*s+size[s];e++)
    if (!drop(e)) parents[index[(1-t)*N+next[e]]++]=t*N+s;
  return {groups,count,parents};
}

export class V3Context {
  constructor(tables,p) {
    this.book=tables.v3;
    if (!this.book) throw Error('V3 proof book is unavailable.');
    this.p=p;
    this.base=tables.v2;
    this.staticEval=this.book.staticEval??=Int16Array.from(this.book.value,(v,s)=>
      v+Math.trunc(this.base[s]/4)+this.book.guide[s]*(1600-Math.min(400,3*this.book.rank[s])));
    this.active=false;
  }
  supported(s,t,quiet,maxSize=64) {
    const {cert,offsets,supportMove,keys}=this.book;
    if(supportMove[s]<0 || quiet+128>=QUIET || offsets[s+1]-offsets[s]>maxSize)return 0;
    for(let i=offsets[s];i<offsets[s+1];i++)if(this.p.seen[key(keys[i],t)])return 0;
    return cert[s];
  }
  modelRisk(states) {
    const risk=new Int16Array(2*N), sweep=new Int16Array(2*N), unresolved=[], taps=new Int16Array(9);
    for(const id of states) {
      risk[id]=this.sign[id]?this.sign[id]*(1000-Math.min(350,4*this.rank[id])):this.book.value[id%N];
      if(!this.sign[id])unresolved.push(id);
    }
    for(let pass=0;pass<10;pass++) {
      for(const id of unresolved) {
        const s=id%N,t=Number(id>=N);
        let n=0,floor=-1000;
        for(let e=9*s;e<9*s+size[s];e++) {
          const c=next[e];
          if(this.p.seen[key(c,1-t)])continue;
          if(drop(e))floor=Math.max(floor,this.book.cert[c]?-1000*this.book.cert[c]:-this.book.value[c]);
          else {
            const val=-risk[(1-t)*N+c];
            let j=n++;
            while(j && taps[j-1]>val){taps[j]=taps[j-1];j--;}
            taps[j]=val;
          }
        }
        for(let i=0;i<n;i++)if(taps[i]>floor)floor=Math.trunc((3*taps[i]+floor)/4);
        sweep[id]=Math.trunc(floor*99/100);
      }
      for(const id of unresolved)risk[id]=sweep[id];
    }
    return risk;
  }
  prepare() {
    if (!this.p.quiet || this.active) return;
    this.active=true;
    const {groups,count,parents}=topology??=buildTopology();
    const {s,t,seen}=this.p, named=key(s,t);
    this.group=4*live[aHand(named)]+live[named%H];
    const states=groups[this.group], sign=this.sign=new Int8Array(2*N), rank=this.rank=new Int16Array(2*N);
    const remaining=new Int8Array(2*N), queue=new Int32Array(states.length);
    let tail=0;
    for (const id of states) {
      const b=id%N, turn=Number(id>=N);
      let win=false, open=0;
      for(let e=9*b;e<9*b+size[b];e++) {
        const c=next[e];
        if(seen[key(c,1-turn)])continue;
        if(drop(e) && this.book.cert[c]<0)win=true;
        if(!drop(e) || this.book.cert[c]<=0)open++;
      }
      sign[id]=win?1:open?0:-1;rank[id]=1;remaining[id]=open;
      if(sign[id])queue[tail++]=id;
    }
    for(let i=0;i<tail;i++) {
      const id=queue[i];
      if(seen[key(id%N,Number(id>=N))])continue;
      for(let j=count[id];j<count[id+1];j++) {
        const parent=parents[j];
        if(!sign[parent] && (sign[id]<0 || --remaining[parent]===0)) {
          sign[parent]=-sign[id];rank[parent]=rank[id]+1;queue[tail++]=parent;
        }
      }
    }
    const risk=live[aHand(named)]+live[named%H]<=5?this.modelRisk(states):null;
    this.values=[this.staticEval.slice(),this.staticEval.slice()];
    for(const id of states) {
      const s=id%N;
      this.values[Number(id>=N)][s]=(risk?risk[id]:this.book.value[s])+Math.trunc(this.base[s]/4)+
        sign[id]*(1600-Math.min(400,3*rank[id]));
    }
  }
  evaluate(s,t) {return this.active?this.values[t][s]:this.staticEval[s];}
  claim() {
    const {s,t,quiet}=this.p;
    if(!quiet) return {sign:this.book.cert[s],move:this.book.move[s]};
    this.prepare();
    if(this.supported(s,t,quiet,N))return {sign:this.book.cert[s],move:this.book.supportMove[s]};
    const id=t*N+s, sign=this.sign[id], witness={left:12000,move:0};
    if(sign && quiet+this.rank[id]<QUIET && this.strategy(s,t,sign,witness,true)) return {sign,move:witness.move};
    return {sign:0,move:0};
  }
  strategy(s,t,wanted,budget,root=false) {
    if(--budget.left<0)return false;
    const {seen}=this.p,id=t*N+s;
    for(let e=9*s;e<9*s+size[s];e++) {
      const c=next[e], k=key(c,1-t), child=(1-t)*N+c;
      if(seen[k])continue;
      let ok=false;
      if(drop(e))ok=this.book.cert[c]===-wanted;
      else if(this.sign[child]===-wanted && this.rank[child]<this.rank[id]) {
        seen[k]=1;ok=this.strategy(c,1-t,-wanted,budget);seen[k]=0;
      }
      if(ok && wanted>0){if(root)budget.move=code[e];return true;}
      if(!ok && wanted<0)return false;
    }
    return wanted<0;
  }
}
