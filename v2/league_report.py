"""Replay the random-opening round robin, fit joint Elo, and bootstrap opening pairs."""
import argparse
import csv
import itertools
import json
import math
import random
import subprocess
import sys
from pathlib import Path

import numpy as np
from scipy.special import expit

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
from verify import verify_openings

BOTS = ["v2", "v1", "heuristic", "random"]
PAIRS = list(itertools.combinations(range(len(BOTS)), 2))
DESIGN = (np.eye(4)[[i for i, j in PAIRS]] - np.eye(4)[[j for i, j in PAIRS]])[:, :3]
ELO_SCALE = 400 / math.log(10)
GAMES = 2000
OPENING_SEED, SEAT_SEED, POLICY_SEED = 774023, 808109, 86000000
BOOTSTRAP_SEED, REPLICATES = 381437, 2000


def fit(points):
    # One row per matchup. A draw contributes half a point to each opponent.
    reachable = np.eye(len(BOTS), dtype=bool)
    for k, (i,j) in enumerate(PAIRS):
        reachable[i,j] = points[k] > 0
        reachable[j,i] = points[k] < GAMES
    for k in range(len(BOTS)):
        reachable |= reachable[:,k,None] & reachable[k,None,:]
    if not reachable.all():
        raise ArithmeticError("No finite joint Elo maximum for this outcome graph")
    log_strength = np.zeros(3)
    for _ in range(60):
        p = expit(DESIGN @ log_strength)
        err = DESIGN.T @ (points - GAMES * p)
        if abs(err).max() < 1e-8:
            break
        information = DESIGN.T @ ((GAMES * p * (1-p))[:, None] * DESIGN)
        log_strength += np.linalg.solve(information, err)
    else:
        raise ArithmeticError("The Elo fit did not converge")
    return np.r_[log_strength * ELO_SCALE, 0.0]


def direct_elo(p):
    return ELO_SCALE * math.log(p / (1-p)) if 0 < p < 1 else None


def run_games(engine, directory, workers):
    directory.mkdir(parents=True, exist_ok=True)
    for k, (i,j) in enumerate(PAIRS):
        first, second = BOTS[i], BOTS[j]
        subprocess.run([sys.executable, str(ROOT/"v2/tournament.py"), str(engine.resolve()),
                        str(ROOT/"model/values.txt"), str(ROOT/"v2/values.txt"),
                        str(directory/f"{first}-{second}.csv"), str(GAMES), str(SEAT_SEED),
                        str(POLICY_SEED+k*100000), "500000", "12", str(workers),
                        "--depth", "18", "--opening-seed", str(OPENING_SEED),
                        "--players", first, second], check=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--directory",type=Path, default=ROOT/"dist/data/league")
    parser.add_argument("--run",type=Path,metavar="ENGINE",help="play all games before verification")
    parser.add_argument("--workers",type=int,default=8)
    args = parser.parse_args()
    directory = args.directory.resolve()
    if args.run:
        run_games(args.run, directory, args.workers)
    opening_rng = random.Random(OPENING_SEED)
    draws = [opening_rng.randrange(54450) for _ in range(GAMES // 2)]
    seats = [0, 1] * (GAMES // 2)
    random.Random(SEAT_SEED).shuffle(seats)
    next_pair = [0, 0]
    pair_at = []
    for seat in seats:
        next_pair[seat] += 1
        pair_at.append(next_pair[seat])
    blocks = np.zeros((GAMES//2, len(PAIRS)))
    matches = []
    for k, (i, j) in enumerate(PAIRS):
        first, second = BOTS[i], BOTS[j]
        path = directory / f"{first}-{second}.csv"
        stats = verify_openings(path, first, second)
        with path.open() as f:
            rows = list(csv.DictReader(f))
        assert len(rows) == GAMES
        for game, row in enumerate(rows):
            pair = int(row["pair"]) - 1
            assert int(row["game"]) == game+1 and int(row["pair"]) == pair_at[game]
            assert int(row["opening_id"]) == draws[pair]
            assert int(row["seed"]) == POLICY_SEED + k*100000 + game
            assert int(row["bot_first"]) == seats[game]
            blocks[pair, k] += {"win":1, "draw":0.5, "loss":0}[row["result"]]
        observed = blocks[:, k].sum() / GAMES
        matches.append(dict(first=first, second=second, all=stats["all"], firstSeat=stats["first"],
                            secondSeat=stats["second"], score=observed,
                            direct_elo=direct_elo(observed)))
    totals = blocks.sum(axis=0)
    rating = fit(totals)
    rng = np.random.default_rng(BOOTSTRAP_SEED)
    samples = np.array([fit(blocks[rng.integers(len(blocks),size=len(blocks))].sum(axis=0))
                        for _ in range(REPLICATES)])
    low, high = np.percentile(samples, [2.5,97.5], axis=0)
    ratings = {bot:dict(elo=round(rating[i],2), low=round(low[i],2), high=round(high[i],2))
               for i,bot in enumerate(BOTS)}
    for k,(i,j) in enumerate(PAIRS):
        matches[k]["fitted_score"] = float(expit((rating[i]-rating[j]) / ELO_SCALE))
    result = dict(opening_seed=OPENING_SEED, seat_seed=SEAT_SEED, policy_seed=POLICY_SEED,
                  bootstrap_seed=BOOTSTRAP_SEED, replicates=REPLICATES, draws=len(draws),
                  distinct_named_starts=len(set(draws)), games=GAMES*len(PAIRS), ratings=ratings,
                  matches=matches)
    (directory/"results.json").write_text(json.dumps(result, indent=2)+"\n")
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
