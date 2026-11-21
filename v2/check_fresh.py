"""Independently derive the fresh-history signs for every one-vs-one and two-vs-one ending."""
from collections import deque
from functools import cache
from itertools import combinations_with_replacement,product
from pathlib import Path
import csv,sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'tools'))
from verify import options

single=[(0,0,i) for i in range(1,10)]
double=[(0,i,j) for i,j in combinations_with_replacement(range(1,10),2)]
@cache
def children(b,t):
    return tuple(options(b,t,set()).values())
def forced(b,t,seen):
    length=0
    while True:
        kids=[n for n in children(b,t) if n not in seen]
        if not kids:return (-1 if length%2==0 else 1)
        assert len(kids)==1
        b=kids[0];seen=seen|{b};t=1-t;length+=1
def reference():
    def phase(b):return sum(x>0 for h in b for x in h)
    seeds=list(product(single,single))+list(product(single,double))+list(product(double,single))
    worth={b:forced(b,0,{b}) for b in seeds if phase(b)==2}
    positions=[b for b in seeds if phase(b)==3]
    ranks={};candidate={}
    def after(n):return (n[1],n[0])
    for rank in range(1,100):
        new={}
        for b in positions:
            if b in candidate:continue
            vals=[-1 if (0,0,0) in n else worth.get(after(n),candidate.get(after(n),0)) for n in children(b,0)]
            if -1 in vals:new[b]=1
            elif vals and all(v==1 for v in vals):new[b]=-1
        if not new:break
        ranks.update(dict.fromkeys(new,rank));candidate.update(new)
    def test(b,t,history,sign):
        k=b if t==0 else b[::-1]
        if phase(b)==2:return forced(b,t,history)==sign
        if candidate.get(k)!=sign:return False
        if sign>0:
            for n in children(b,t):
                if n in history:continue
                if phase(n)==3 and ranks.get(n if t==1 else n[::-1],999)>=ranks[k]:continue
                if test(n,1-t,history|{n},-sign):return True
            return False
        return all(test(n,1-t,history|{n},-sign) for n in children(b,t) if n not in history)
    for b in positions:
        assert test(b,0,{b},candidate[b])
        worth[b]=candidate[b]
    return worth
if __name__=='__main__':
    table=reference()
    if len(sys.argv)>1:
        with open(sys.argv[1]) as f:
            compiled={tuple(tuple(map(int,h)) for h in (r[0],r[1])):int(r[2]) for r in csv.reader(f)}
        assert table==compiled
    print('Independently verified',len(table),'fresh endgame outcomes.')
