"""Replay the championship and estimate score uncertainty by paired opening draw."""
import csv
import json
import math
import random
import sys
import struct
from collections import Counter, defaultdict
from pathlib import Path
from itertools import combinations_with_replacement

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tools'))
from verify import verify_openings


def report(path):
    summary = verify_openings(path, 'v3', 'v2')
    with path.open() as stream:
        rows = list(csv.DictReader(stream))
    seats = [0, 1] * 160
    random.Random(715013).shuffle(seats)
    opening_rng = random.Random(905517)
    openings = [opening_rng.randrange(2 * 165**2) for _ in range(160)]
    draws = defaultdict(list)
    hands = {''.join(hand):i for i,hand in enumerate(combinations_with_replacement('0123456789',3))}
    book = (ROOT / 'dist/studio/assets/v3.bin').read_bytes()
    assert book[:4] == b'TGV3'
    by_opening = defaultdict(Counter)
    for index, row in enumerate(rows):
        pair = int(row['pair'])
        assert int(row['game']) == index + 1 and int(row['seed']) == 97427000 + index
        assert int(row['bot_first']) == seats[index] and int(row['opening_id']) == openings[pair-1]
        draws[pair].append({'loss':0, 'draw':0.5, 'win':1}[row['result']])
        start = row['start']
        a, b = hands[start[1:4]], hands[start[4:]]
        mover, other = (a,b) if start[0]=='A' else (b,a)
        sign, = struct.unpack_from('<h', book, 4+10*(220*mover+other))
        favors_v3 = (sign > 0) == bool(seats[index])
        category = 'unresolved' if not sign else 'proved_for_v3' if favors_v3 else 'proved_for_v2'
        by_opening[category][row['result']] += 1
    assert len(rows) == 320 and len(draws) == 160
    paired = [sum(points)/2 for points in draws.values()]
    score = sum(paired)/len(paired)
    rng = random.Random(248073)
    bootstrap = sorted(sum(rng.choices(paired, k=len(paired)))/len(paired) for _ in range(10000))
    elo = lambda s: 400*math.log10(s/(1-s))
    lo, hi = bootstrap[249], bootstrap[9749]
    return {**summary, 'opening_draws':len(paired), 'distinct_opening_ids':len(set(openings)),
            'score':score, 'paired_score_ci95':[lo,hi], 'head_to_head_elo':round(elo(score),1),
            'elo_ci95':[round(elo(lo),1),round(elo(hi),1)],
            'by_opening_certificate':{key:dict(counts) for key,counts in by_opening.items()},
            'points_per_two_games':dict(sorted(Counter(sum(p) for p in draws.values()).items()))}


if __name__ == '__main__':
    path = ROOT / 'dist/data/v3/championship.csv'
    print(json.dumps(report(path),indent=2))
