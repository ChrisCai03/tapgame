# Tapgame V3

[Play V3](https://tapgame-match-report.chris-cai.chatgpt.site/studio/index.html?play=v3&opening=random) · [Replay game 1 against V2](https://tapgame-match-report.chris-cai.chatgpt.site/studio/index.html?suite=v3/championship&game=1) · [Download all decisions](../dist/data/v3/championship.csv)

## How V3 chooses a tap

1. **Prove small games first.** A withdrawal permanently reduces the number of live digits. From that moment, no board played before the withdrawal can recur. V3 builds its table from two live digits up to six, checking winning strategies against every legal opponent reply and using already certified results after a withdrawal.
2. **Reuse proofs during play.** For each strategy, the book records the quiet tap targets needed by the winning side up to the next withdrawal. If any of those boards already occurred, that certificate may be unusable. Otherwise the winning side can still play its strategy, and the opponent's legal replies can only have decreased. A clock guard reserves enough taps to reach the next withdrawal or finish. The independent verifier checks all 13,934 live entries and their support sets.
3. **Account for the actual game.** After a quiet tap, V3 removes historical boards from the graph for the current live-digit counts and works backward from blockades and certified exits. During proof search and alpha–beta it also bans boards newly visited in the variation. A graph label becomes a proof only after the strategy survives legal reply checks. In positions with at most five live digits, ten additional sweeps estimate how vulnerable the remaining choices are to future repetition bans.
4. **Search the unresolved choices.** Iterative-deepening alpha–beta uses 500,000 main nodes and a depth target of 32 taps. Where exactly one move avoids an established loss, V3 can extend the line. Evaluation combines a discounted minimax table with 8% uniform move noise, V2's frozen self-play values, and the current graph estimates. One-on-one lines run to their actual end. V3 picks deterministically. The limits apply per decision and exclude graph preparation, separate proof checks and forced one-on-one continuations.

## Proven fresh positions

| Total live digits | Certified positions |
| ---: | ---: |
| 2 | 81 |
| 3 | 810 |
| 4 | 3,793 |
| 5 | 6,343 |
| 6 | 2,907 |

The 27,225 three-against-three starts are ordered by who moves first, counting each player's digits as an unordered hand. V3 proves 2,787 first-player wins and 120 second-player wins, including 126 newly classified openings. The usual all-ones start remains unresolved. Exact strategy certificates and the strength benchmark answer different questions.

## Held-out championship

| V3 seat | Games | Wins | Draws | Losses | Win rate |
| --- | ---: | ---: | ---: | ---: | ---: |
| Either | 320 | 218 | 0 | 102 | 68.13% |
| First | 160 | 146 | 0 | 14 | 91.25% |
| Second | 160 | 72 | 0 | 88 | 45.00% |

The frozen challenger played all 160 random opening draws twice, switching seats. V3 swept 60 pairs, split 98 and lost both games twice. The paired 95% bootstrap score interval is 64.06%–72.19%, equivalent to a head-to-head advantage of 132 Elo (100–166). This comparison uses each bot's released settings.

Both bots converted all 18 openings whose winners V3 had already certified when they held the winning seat. On the other 142 draws, V3 won 200 games and lost 84. The independent referee verified all 320 traces, including 161 clearances and 159 blockades. [Match summary](../dist/data/v3/results.json)

On 384 identical positions sampled from the earlier V2–V1 league, V3 used 46.0 ms of native CPU time per decision on average and V2 used 17.4 ms (2.65×). Each engine ran the same batch three times, with median batch time and startup subtracted. Device, compiler and position mix affect these figures. To repeat the timing on Linux or macOS, run `python3 v3/timing.py /path/to/v2 /path/to/v3`.

## Build and reproduce

Run these commands in the repository root. The shipped book is ready to use.

```sh
g++ -O3 -std=c++17 v3/engine.cpp -o /tmp/tap-v3
printf '42 - A123456\n' | /tmp/tap-v3 choose model/values.txt v2/values.txt 500000 12 32
node studio/engine.mjs --engine v3
```

The native example asks V3 for a tap as the player holding 1, 2, 3 against 4, 5, 6. The Node process accepts TGEP/1 JSON lines on stdin. The native match runner accepts V3, V2, V1, heuristic and random in either seat. It fixes V2’s depth and node cap at the released settings. Use the released V2 opening band of 12 to reproduce the championship.

```sh
g++ -O3 -std=c++17 v3/book.cpp -o /tmp/tap-book
/tmp/tap-book > /tmp/v3-rebuilt.bin
cmp /tmp/v3-rebuilt.bin dist/studio/assets/v3.bin
TAPGAME_V3=/tmp/tap-v3 node --test tests/v3.test.mjs
python3 v2/tournament.py /tmp/tap-v3 model/values.txt v2/values.txt /tmp/championship.csv 320 715013 97427000 500000 12 4 --depth 32 --opening-seed 905517 --players v3 v2
cmp /tmp/championship.csv dist/data/v3/championship.csv
python3 v3/report.py
```
