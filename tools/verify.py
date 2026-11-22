"""Independent history-aware referee and result aggregation."""
from collections import Counter
from pathlib import Path
import csv,json
from statistics import median,mean
ROOT=Path(__file__).resolve().parents[1]
def options(board,t,seen):
    if (0,0,0) in board:return {}
    result={}
    for x in set(board[t])-{0}:
        for y in set(board[1-t])-{0}:
            copy=list(board[t]);copy[copy.index(x)]=(x+y)%10
            following=list(board);following[t]=tuple(sorted(copy));following=tuple(following)
            if following not in seen:result[(x,y)]=following
    return result
def heuristic_grade(move,following,t,seen):
    reply=options(following,1-t,seen|{following})
    if not reply:return 10
    fatal=any(after[1-t]==(0,0,0) for after in reply.values())
    threatened=any(sum(action)==10 for action in reply)
    return 4*(not fatal)+2*(not threatened)+int(sum(move)==10)
def verify(row,baseline,primary=None):
    start = row.get('start', 'A111111')
    assert len(start) == 7 and start[0] in 'AB' and all(c in '123456789' for c in start[1:])
    board = tuple(tuple(sorted(map(int, digits))) for digits in (start[1:4], start[4:]))
    t = int(start[0] == 'B')
    bot = t if int(row['bot_first']) else 1-t
    seen={board};quiet=0;drops=0
    tr=row['trace'];assert len(tr)==2*int(row['taps'])
    for i in range(0,len(tr),2):
        assert quiet<20000
        legal=options(board,t,seen);action=tuple(map(int,tr[i:i+2]));n=legal[action]
        if (primary if t==bot else baseline)=='heuristic':
            assert heuristic_grade(action,n,t,seen)==max(heuristic_grade(k,v,t,seen) for k,v in legal.items())
        quiet=0 if sum(action)==10 else quiet+1;drops+=sum(action)==10
        t=1-t;board=n;seen.add(board)
    r='cleared' if board[1-t]==(0,0,0) else 'timeout' if quiet>=20000 else 'blocked'
    if r=='blocked':assert not options(board,t,seen)
    assert row['reason']==r and int(row['withdrawals'])==drops
    assert row['result']==('draw' if r=='timeout' else 'loss' if t==bot else 'win')
def aggregate(rows):
    c=Counter(r['result'] for r in rows);reasons=Counter(r['reason'] for r in rows);length=[int(r['taps']) for r in rows]
    return dict(games=len(rows),win=c['win'],loss=c['loss'],draw=c['draw'],median=median(length),longest=max(length),
                mean=round(mean(length),2),cleared=reasons['cleared'],blocked=reasons['blocked'])
def main():
    data=ROOT/'dist/data';summary={}
    for b,seed in [('random',3100000),('heuristic',5200000)]:
        with (data/(b+'.csv')).open() as f:rows=list(csv.DictReader(f))
        assert len(rows)==2000
        for i,r in enumerate(rows):
            assert int(r['game'])==i+1 and int(r['seed'])==seed+i and int(r['bot_first'])==(i%2==0)
            verify(r,b)
        summary[b]={k:aggregate([r for r in rows if seat is None or int(r['bot_first'])==seat]) for k,seat in [('all',None),('first',1),('second',0)]}
    (data/'results.json').write_text(json.dumps(summary,indent=2))
    print(json.dumps(summary))
def verify_openings(path, primary=None, opponent=None):
    from itertools import combinations_with_replacement
    triples = list(combinations_with_replacement('123456789', 3))
    with path.open() as f:
        rows = list(csv.DictReader(f))
    pairs = {}
    for row in rows:
        verify(row, opponent, primary)
        opening_id = int(row['opening_id'])
        assert 0 <= opening_id < 2 * len(triples)**2
        a, b = divmod(opening_id // 2, len(triples))
        assert row['start'] == 'AB'[opening_id % 2] + ''.join(triples[a]+triples[b])
        pairs.setdefault(int(row['pair']), []).append(row)
    for pair in pairs.values():
        assert len(pair) == 2 and pair[0]['start'] == pair[1]['start']
        assert {r['bot_first'] for r in pair} == {'0', '1'}
    assert len({r['game'] for r in rows}) == len(rows)
    return {name:aggregate([r for r in rows if seat is None or int(r['bot_first']) == seat])
            for name,seat in [('all',None),('first',1),('second',0)]}

if __name__=='__main__':
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('--random-openings', type=Path, metavar='CSV')
    args = parser.parse_args()
    if args.random_openings:
        print(json.dumps(verify_openings(args.random_openings), indent=2))
    else:
        main()
