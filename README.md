# Tapgame

Two playable C++17 bots for the three-number finger addition game. Both use iterative-deepening alpha–beta search and position values learned from self-play. The frozen tables are included, so playing requires only a C++ compiler.

## Analysis workbench

[Open Tapgame Studio](https://tapgame-match-report.chris-cai.chatgpt.site/studio/index.html) · [Study the three-tap blockade in game 1](https://tapgame-match-report.chris-cai.chatgpt.site/studio/index.html?game=1&tap=268)

Review the 23,000 archived games, inspect legal and banned taps, follow ranked continuations and keep alternative lines. Click an arithmetic pair on the board to play it. The editor can start a fresh study from a custom board and either seat. The workbench supports human play, engine matches, evaluation graphs, an instant policy-specific W/D/L estimate and seeded simulations from the current history.

Draw a random opening in Play or New study. The opening number lets you share the same hands and starting player. At tap zero, Studio shows any known forced win and its winning first tap when the mover can force the result. [Draw an opening](https://tapgame-match-report.chris-cai.chatgpt.site/studio/index.html?opening=random) · [Proven openings and random-start benchmark](docs/random-openings.md)

The GUI and independent engines communicate through TGEP/1. The same JSON messages work in a browser worker and over a process's standard input/output. To run the workbench locally with Node.js 20 or newer, use:

```sh
node studio/server.mjs
```

To add a C++, Python or other executable, use the [protocol and engine registration guide](docs/engine-protocol.md). No training or package installation is required for the built-in bots.

## Rules

Each player starts with three live numbers. The standard opening gives everyone three ones. The random-opening option draws two sorted triples from digits 1–9 and chooses who starts. On your turn, choose one of your live numbers and one of your opponent's. Replace your chosen number with their sum modulo 10. Withdraw it permanently if the sum ends in zero. The opponent's number stays in place.

A tap is illegal if it recreates any previous board, including the opening. To compare boards, sort each player's numbers and keep the two players distinct. The player to move is ignored when comparing boards.

You win by withdrawing your last number or by leaving your opponent with no legal tap. The tournament referee checks for clearance first, then a timeout draw after 20,000 consecutive taps (10,000 two-tap rounds) without a withdrawal, then a win by blockade.

## Ask v2 for a move

Run from the repository root:

```sh
g++ -O3 -std=c++17 v2/engine.cpp -o engine2
printf '42\n42 1112\n' | ./engine2 choose model/values.txt v2/values.txt 500000 12 18
```

Each input line contains a random seed and an optional history. Each pair of history digits names the moving value and the opponent's value, in that order. The example requests moves at the opening and after the taps (1,1), (1,2). The engine prints one legal pair per request at these positions. The last three arguments set the main search node budget, opening score tolerance, and depth limit in taps.

## Algorithms and measured strength

V1 searches up to eight taps with a budget of 4,500 main nodes per decision. V2 adds history-checked endgame proofs, move ordering, and a symmetry-averaged evaluator trained on 72,000 games across two generations, with 8,000 more held out. Its released settings allow 18 taps and 500,000 main nodes.

| Match | Games | Wins | Timeout draws | Losses |
| --- | ---: | ---: | ---: | ---: |
| V1 vs. random | 2,000 | 2,000 | 0 | 0 |
| V1 vs. heuristic | 2,000 | 2,000 | 0 | 0 |
| V2 vs. v1, random openings at released settings | 1,000 | 872 | 0 | 128 |
| V2 vs. v1, released settings, standard opening | 5,000 | 4,738 | 0 | 262 |
| V2 vs. v1, both limited to 4,500 nodes and depth 8 | 500 | 238 | 0 | 262 |
| V2 vs. v1, both limited to 4,500 nodes, v2 depth 18 | 500 | 404 | 0 | 96 |

Wins are from the first-listed bot's perspective. Each v2 match randomized starting player with balanced seats. The 94.76% result uses each version's released search budget. Forced lines and proof checks are outside the main-node count.

[Four-bot random-opening league and Elo ratings](https://tapgame-match-report.chris-cai.chatgpt.site/studio/league.html) · [Round-robin methods and reproduction](docs/random-opening-league.md)

[Version 1 training and baselines](docs/v1.md) · [Version 2 training, search and reproduction commands](v2/README.md) · [Game-by-game traces and summaries](dist/data/)

## Verify the match records

Replay the archived games with the independent Python referee:

```sh
python3 tools/verify.py
python3 v2/report.py
```
