"""Replay both evaluation suites with the independent referee; emit Site statistics."""
import csv,sys,json,random
from pathlib import Path
from collections import Counter
from statistics import median
base=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(base/'tools'))
from verify import verify,aggregate
data=base/'dist/data'
def summary(path,expected,seatseed,startseed):
    with path.open() as file:rows=list(csv.DictReader(file))
    assert len(rows)==expected
    seats=[0,1]*(expected//2);random.Random(seatseed).shuffle(seats)
    for i,r in enumerate(rows):
        assert (int(r['game']),int(r['seed']),int(r['bot_first']))==(i+1,startseed+i,seats[i])
        verify(r,'v1')
    def group(part):
        result=aggregate(part);result['unique']=len({r['trace'] for r in part})
        result['win_rate']=round(100*result['win']/len(part),2)
        return result
    return {k:group([r for r in rows if seat is None or int(r['bot_first'])==seat]) for k,seat in [('all',None),('first',1),('second',0)]}
if __name__=='__main__':
    report={'main':summary(data/'v2-v1.csv',5000,882347,45000000),'equal':summary(data/'v2-equal.csv',500,67121,22400000),'nodes':summary(data/'v2-equal-nodes.csv',500,67121,22400000)}
    (data/'v2-results.json').write_text(json.dumps(report,indent=2))
    print(json.dumps(report))
