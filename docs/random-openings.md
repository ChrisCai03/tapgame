# Random openings and forced wins

[Draw a random opening in Tapgame Studio](https://tapgame-match-report.chris-cai.chatgpt.site/studio/index.html?opening=random)

Choose **Play → Random opening** to play with your current seat assignments, or **New study → Draw random opening** to inspect or edit the draw. The first player and both hands are drawn anew. Each player gets three live numbers. The opening starts a fresh repetition history. The opening number below the outcome estimate links to that exact board and turn.

## The draw

There are 165 sorted triples with repetition from digits 1–9. Each triple is equally probable, including triples such as 111 and 123. The two players' hands are independent and each seat has a 50% chance to start. This gives 54,450 equally likely named starts. With hands ordered as (mover, opponent), there are 27,225 strategic starts. A random-start game can begin at any of them, irrespective of reachability from 111 vs 111.

Opening IDs run from 0 through 54,449. Enumerate triples in ascending lexicographic order with zero-based indices. For indices i and j of A's and B's triples, the ID is 2 × (165i + j) plus 1 if B moves first. A study export includes the actual hands and first player. The tournament records include the ID, hands, first player, pair number, policy seed and every tap.

## Which openings are solved?

These counts apply to a fresh position at tap zero, with positional superko, clearance, blockade and the usual 10,000-round timeout.

| Outcome established | Starts ordered by mover and opponent |
| --- | ---: |
| First player can force a win | 2,681 |
| Second player can force a win | 100 |
| Unresolved by these searches | 24,444 |
| Total | 27,225 |

**A five-tap win.** Give A three 3s and B three 7s, with A to move. On each turn the only value-pair adds to ten. A withdraws on taps 1, 3 and 5. B withdraws on taps 2 and 4. Every tap changes the number of live slots, so it always gives a fresh board. The same proof works for three copies of any digit x against three copies of 10 − x. [Play opening 27040](https://tapgame-match-report.chris-cai.chatgpt.site/studio/index.html?opening=27040)

**A second-player win.** Give A 111 and B 189, with A to move. Against A's possible taps 1+1, 1+8, and 1+9, B can reply 8+2, 1+9, and 9+1 respectively. Each reply withdraws one of B's numbers and reaches an endgame certified as losing for A. [Inspect opening 86](https://tapgame-match-report.chris-cai.chatgpt.site/studio/index.html?opening=86)

**The usual 111 vs 111 opening remains unresolved.** The play percentages in Studio describe specific policies. A forced-win label requires a strategy that covers every legal opposing reply. After the first tap, consult the live analysis, which uses the current history.

## How the proofs were obtained

The [enumerator](../studio/opening_proofs.cpp) starts from each full board with only the root in the repetition history. It accepts a win when at least one legal move leads to a certified opponent loss and accepts a loss only when every legal move leads to a certified opponent win. A nonterminal position at the search horizon is unknown.

The first pass searches six taps, counting clearance and blockade as exact outcomes. It proves 17 first-player wins. The second searches two taps and also accepts the released engine's verified endgame results immediately after a withdrawal. At that point neither player can return to any board from the phase with more live numbers. The number of distinct boards with fixed live counts after a withdrawal is at most 165 × 45, below the 20,000-tap timeout. The combined table holds an outcome for 2,781 starts and a winning first tap for each certified first-player win. The table is used for study only. The released bots still select their own moves.

Rebuild the proof table and compare it byte for byte:

```sh
g++ -O3 -std=c++17 studio/opening_proofs.cpp -o opening-proofs
./opening-proofs --binary > opening-proofs.bin
cmp opening-proofs.bin dist/studio/assets/opening-proofs.bin
./opening-proofs > opening-proofs.csv
```

## Released bots on random openings

The tournament draws 500 openings with replacement. Each is played twice, swapping which bot controls each seat for the second game. Policy seeds differ in the two games. V1 uses its released 4,500-node, depth-8 search and v2 uses its released 500,000-node, depth-18 search. Opening randomization changes the starting state. The value tables and playing algorithms are frozen.

| V2 seat | Games | V2 wins | Timeout draws | V2 losses | V2 win rate |
| --- | ---: | ---: | ---: | ---: | ---: |
| First | 500 | 485 | 0 | 15 | 97.0% |
| Second | 500 | 387 | 0 | 113 | 77.4% |
| Combined | 1,000 | 872 | 0 | 128 | 87.2% |

The independent referee replayed all 1,000 traces, including 114 wins by clearance and 886 by blockade. A separate regression check compared the released and updated v2 decisions on 120 opening boards at full budget. All 120 choices agreed.

[Replay the first game in Studio](https://tapgame-match-report.chris-cai.chatgpt.site/studio/index.html?suite=random-openings-v2-v1&game=1) · [Download all traces](../dist/data/random-openings-v2-v1.csv)

Reproduce the match and check every trace with the independent Python referee:

```sh
g++ -O3 -std=c++17 v2/engine.cpp -o engine2
python3 v2/tournament.py ./engine2 model/values.txt v2/values.txt random-openings.csv 1000 473037 65000000 500000 12 8 --depth 18 --opening-seed 20261123
python3 tools/verify.py --random-openings random-openings.csv
```
