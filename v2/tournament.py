import argparse,csv,io,random,subprocess
from itertools import combinations_with_replacement
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
p=argparse.ArgumentParser()
for arg in ('engine','old','new','out'):p.add_argument(arg,type=Path)
for arg in ('games','seat_seed','policy_seed','nodes','band','workers'):p.add_argument(arg,type=int)
p.add_argument("--depth",type=int,default=13)
p.add_argument("--opening-seed", type=int, help="pair each random three-vs-three start with a rematch swapping bots")
p.add_argument('--players', nargs=2, choices=['v2','v1','heuristic','random'],
               help='policies in CSV result order, for random-opening matches')
a=p.parse_args()
if a.players and a.opening_seed is None:
    p.error('--players requires --opening-seed')
if a.games%2:raise ValueError('balanced draw requires an even number of games')
seats=[0,1]*(a.games//2);random.Random(a.seat_seed).shuffle(seats)
jobs=[(i+1,a.policy_seed+i,seats[i]) for i in range(a.games)]
mode = 'match'
opening_ids = {}
if a.opening_seed is not None:
    mode = 'match-start'
    triples = [''.join(t) for t in combinations_with_replacement('123456789', 3)]
    opening_rng = random.Random(a.opening_seed)
    first_games = [i for i, seat in enumerate(seats) if seat]
    second_games = [i for i, seat in enumerate(seats) if not seat]
    for pair, (i, j) in enumerate(zip(first_games, second_games), 1):
        number = opening_rng.randrange(2 * len(triples)**2)
        a_hand, b_hand = divmod(number // 2, len(triples))
        start = 'AB'[number % 2] + triples[a_hand] + triples[b_hand]
        for k in (i, j):
            jobs[k] = (*jobs[k], start)
            opening_ids[k+1] = (pair, number)
def run(chunk):
    schedule=''.join(' '.join(map(str,x))+'\n' for x in chunk)
    result=subprocess.run([a.engine.resolve(),mode,a.old,a.new,str(a.nodes),str(a.band),str(a.depth),*(a.players or [])],input=schedule,text=True,capture_output=True,check=True)
    return list(csv.DictReader(io.StringIO(result.stdout)))
with ThreadPoolExecutor(max_workers=a.workers) as pool:
    batches=list(pool.map(run,[jobs[i::a.workers] for i in range(a.workers)]))
rows=sorted((r for group in batches for r in group),key=lambda r:int(r['game']))
assert len(rows)==a.games
if opening_ids:
    for row in rows:
        row['pair'], row['opening_id'] = opening_ids[int(row['game'])]
with a.out.open('w',newline='') as f:
    writer=csv.DictWriter(f,fieldnames=list(rows[0]),lineterminator="\n");writer.writeheader();writer.writerows(rows)
print(a.nodes, len(rows),sum(r['result']=='win' for r in rows),len(set(r['trace'] for r in rows)),flush=True)
