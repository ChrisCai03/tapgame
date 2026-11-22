# Four-bot random-opening league

[Read the score matrix, Elo ratings and match records](https://tapgame-match-report.chris-cai.chatgpt.site/studio/league.html) · [Machine-readable results and complete traces](../dist/data/league/)

The four entrants are the released v2 and v1 engines, the original withdrawal-aware heuristic, and uniform random legal taps. Each of the six unordered pairs plays 2,000 games. At the beginning of the tournament, 1,000 opening IDs are sampled uniformly with replacement from 54,450 named full openings. Every pairing plays those exact draws twice. The boards and the named first player stay the same for each rematch and the engines swap seats. Every pairing therefore has 1,000 first-seat games and 1,000 second-seat games for each engine. This league uses a separate opening sample and policy seeds from the earlier 1,000-game v2–v1 check.

V2 uses its released 500,000-node budget, depth limit of 18 and early score band of 12. V1 uses its released 4,500 nodes and depth limit of 8. The match runner calls the original baseline implementations in `src/tap.cpp`. Random chooses uniformly among legal value-pairs, collapsing identical numbers. Heuristic takes an immediate win when available. Otherwise it prioritizes avoiding an immediate opposing win, then avoiding an opposing withdrawal, then withdrawing its own number. Ties are sampled uniformly. A bot wins by clearance or blockade. The referee checks for a draw after 20,000 consecutive taps without a withdrawal.

The match CSVs specify the first-listed bot's result. In each row, `bot_first` is 1 if that bot takes the first turn. A's and B's digits follow the named first player in `start`. The fields `pair` and `opening_id` identify the draw and exact opening. The independent Python verifier checks all games from their own starts, including repetition, timeout, withdrawal count, terminal reason, legal heuristic choices on either seat, and the seat swap. It also reconstructs the seeded draw and checks that every pairing followed it.

## Results

| Row bot | V2 | V1 | Heuristic | Random | Joint Elo (95% interval) |
| --- | ---: | ---: | ---: | ---: | ---: |
| V2 | — | 87.90% | 98.65% | 99.90% | 1,568 (1,482–1,663) |
| V1 | 12.10% | — | 99.00% | 99.90% | 1,241 (1,166–1,327) |
| Heuristic | 1.35% | 1.00% | — | 96.60% | 576 (537–624) |
| Random | 0.10% | 0.10% | 3.40% | — | 0 (fixed) |

Every game ended by clearance or blockade. V2 took 1,758 wins and 242 losses against V1. Both search engines beat Random 1,998 times. One of the two losses for each engine occurred on the same forced opening: Random had 777 and moved first against 333, so it cleared on tap five. [Replay the V2 loss in Studio](https://tapgame-match-report.chris-cai.chatgpt.site/studio/index.html?suite=league/v2-random&game=908)

V2’s score against Random alone gives a direct Elo difference of +1,200. Fitting all six pairings gives V2 +1,568 relative to Random, including the evidence from V2 beating V1 in 87.90% of their games. The observed percentages provide opponent-specific comparisons.

## Estimating relative strength

For bot i against bot j, the fitted expected score is

```text
p(i,j) = 1 / (1 + 10^((Rj - Ri)/400)).
```

We fix Random at zero, and maximize the joint Bradley–Terry log likelihood of the six observed match totals, counting a timeout draw as half a point to each bot. The direct Elo difference for a single pair is 400 log10(p / (1 − p)). It can differ from the global estimate because one rating per bot has to account for every opponent. The report shows the largest matchup discrepancy. Ratings describe this opening distribution, policy set and search budgets.

To measure sampling uncertainty, resample 1,000 opening draws with replacement and refit the ratings. Each draw contributes its two seat-swapped games in *all six* pairings. The reported 95% interval is the pair of empirical 2.5th and 97.5th percentiles of 2,000 fits. The random seed for this bootstrap is 381437.

## Reproduce the records

The reference run used GCC 14.2 with libstdc++ on Linux, Python 3.12, NumPy 2.3.5 and SciPy 1.17.0. Use the same C++ standard library for byte-for-byte reproduction of randomized tie breaks. Run from the repository root.

```sh
g++ -O3 -std=c++17 v2/engine.cpp -o engine2
python3 v2/league_report.py --run ./engine2 --directory /tmp/tapgame-league --workers 8
```

To recheck the committed records and regenerate their summary:

```sh
python3 v2/league_report.py
```

The opening seed is 774023. The seat-order seed is 808109. Within pairing k, game g (zero-based) uses policy seed 86000000 + 100000k + g. Pairings use combinations of the ordered roster [v2, v1, heuristic, random].
