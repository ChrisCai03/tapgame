import argparse,csv,io,random,subprocess
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
p=argparse.ArgumentParser()
for arg in ('engine','old','new','out'):p.add_argument(arg,type=Path)
for arg in ('games','seat_seed','policy_seed','nodes','band','workers'):p.add_argument(arg,type=int)
p.add_argument("--depth",type=int,default=13)
a=p.parse_args()
if a.games%2:raise ValueError('balanced draw requires an even number of games')
seats=[0,1]*(a.games//2);random.Random(a.seat_seed).shuffle(seats)
jobs=[(i+1,a.policy_seed+i,seats[i]) for i in range(a.games)]
def run(chunk):
    schedule=''.join('%d %d %d\n'%x for x in chunk)
    result=subprocess.run([a.engine.resolve(),'match',a.old,a.new,str(a.nodes),str(a.band),str(a.depth)],input=schedule,text=True,capture_output=True,check=True)
    return list(csv.DictReader(io.StringIO(result.stdout)))
with ThreadPoolExecutor(max_workers=a.workers) as pool:
    batches=list(pool.map(run,[jobs[i::a.workers] for i in range(a.workers)]))
rows=sorted((r for group in batches for r in group),key=lambda r:int(r['game']))
assert len(rows)==a.games
with a.out.open('w',newline='') as f:
    writer=csv.DictWriter(f,fieldnames=list(rows[0]));writer.writeheader();writer.writerows(rows)
print(a.nodes, len(rows),sum(r['result']=='win' for r in rows),len(set(r['trace'] for r in rows)),flush=True)
