# Tapgame Engine Protocol, version 1

TGEP lets the same workbench run a browser engine, a C++ binary, or a bot written in another language. The GUI owns the game record, including variations. Each request supplies a complete position so an engine can analyze a branch, undo a tap, or switch seats without synchronizing mutable board state.

## Run it

From the repository root with Node.js 20 or newer:

```sh
node studio/server.mjs
```

Open the loopback URL printed in the terminal. All five built-in policies run in browser workers. For external engines, register local executables in a JSON file. The included configuration connects the original C++ v2 through an adapter, v1 through a Node process, and a minimal Python example:

```sh
g++ -std=c++17 -O3 v2/engine.cpp -o engine2
node studio/server.mjs --engines studio/engines.example.json
```

Choose each seat in **Play**. Engines that advertise analysis also appear under **Settings**. **Start play** alternates the two seats until the game ends. For a human seat, the GUI waits for a tap. **Play one engine tap** advances once. **Pause play** returns control immediately. The hosted workbench runs the built-in policies on the visitor's device. The loopback companion adds access to programs installed on that computer.

## Transport and discovery

- **Process transport.** Exchange one UTF-8 JSON object per line on standard input and standard output. Flush each reply. Write logs to standard error. The bridge keeps a process alive, serializes its requests, and checks reply IDs. It applies a 30-second timeout to each external request. After failure, the next request may start a new process.
- **Browser transport.** A dedicated module worker receives and posts the same envelopes as structured objects. Separate workers handle interactive search, play, background scans and rollouts. Stale results are discarded. The host can terminate a worker to cancel work.
- **Local GUI bridge.** `GET /tgep/engines` lists registered IDs. `POST /tgep/engine/ID` exchanges one request and response. Only the loopback server exposes this interface. Engine commands are argument arrays in the operator's configuration file. All processes run with the repository root as their working directory.
- **Negotiation.** The host sends `hello` and requires version 1, ruleset `tap10-3-positional-v1` and the `choose` capability. A play-only engine needs just `hello` and `choose`. Hosts may ignore additional fields. A new move encoding or different ruleset requires explicit negotiation.

An entry for a new bot has three fields:

```json
{"id":"first-legal","name":"First legal","argv":["python3","studio/example_bot.py"]}
```

The configuration file is an array of these entries. IDs use 1–40 lowercase letters, digits, underscores or hyphens.

## Envelopes

A request has `v`, `id` (string or integer), and `cmd`. Every reply echoes the ID and version. Each stdout line is one object.

```json
{"v":1,"id":"h1","cmd":"hello"}
{"v":1,"id":"h1","ok":true,"result":{"protocol":"TGEP","version":1,"engine":"First legal","rulesets":["tap10-3-positional-v1"],"commands":["hello","choose"]}}
{"v":1,"id":2,"cmd":"choose","position":{"trace":""},"seed":42}
{"v":1,"id":2,"ok":true,"result":{"move":"11"}}
```

An error reply has the form `{"v":1,"id":2,"ok":false,"error":{"code":"invalid_request","message":"Incomplete tap"}}`. A parser may return a null ID for malformed JSON. Serve the next valid request normally.

## Positions and moves

```json
{"start":{"a":[1,1,1],"b":[1,1,1],"turn":"A"},"trace":"1112"}
```

Each pair of trace digits is one tap. The first digit is the mover's value and the second is the opponent's value. Here A taps 1 with 1, changing their own number to 2, and B then adds A's 2 to B's 1. Digits denote values, so identical numbers give a single arithmetic choice.

Omit `start` for the standard opening. A custom start has two triples of integers from 0 to 9 and a named seat to move. Zero is a withdrawn slot. Sort each triple independently. Include the start in the history, even for a setup. Replay the trace to reconstruct the named-board history and the count of quiet taps. A repeated board is illegal regardless of who would move next. A fresh setup and the same digits reached by play can have different legal moves.

At termination check clearance first, then timeout after 20,000 consecutive taps without withdrawal, then blockade if the mover has no legal tap. Each withdrawal resets the counter. The winner is the player who cleared or the opponent of the blocked mover. A terminal result uses `{"winner":"A","reason":"blockade"}`, `{"winner":"B","reason":"clearance"}`, or `{"winner":null,"reason":"timeout"}` with the appropriate seat.

## Commands

| Command | Result and convention |
| --- | --- |
| `hello` | Engine name, version, supported rulesets and command list. |
| `choose` | One legal two-digit move. Return `move:null` on a finished game. The host adjudicates the board. An optional unsigned 32-bit `seed` controls sampling for this request. |
| `analyze` | One row per distinct legal tap, a recommended move, completed common depth, main nodes, optional proof and optional exact forced distance. All candidate scores favor the **side to move**. |
| `inspect` | Board, named turn, ply, quiet count, legal taps and repetition bans. Each banned tap has its earliest `repeatPly`, with the root at 0. |
| `evaluate` | `wdl:{A,draw,B,source}`, summing to one, and the model's policy pairing. A terminal or fully forced outcome is exact. |
| `timeline` | An array of A's win estimates at the root and after every recorded tap. |
| `simulate` | Empirical A/draw/B counts and termination counts from the supplied position. Choose `policyA`, `policyB`, `games` and `seed`. Built-in IDs are `v1`, `v2`, `guided`, `heuristic` and `random`. |

For `choose` and `analyze`, `limits:{"nodes":36000,"depth":13}` requests up to 36,000 main nodes and a 13-tap horizon. The built-in engines support 16–2,000,000 main nodes and depth 1–32. One-on-one lines and proof work are outside the main-node budget. V2's released playing limits are 500,000 and 18. V1's are 4,500 and 8. `choose` uses playing move order and, for v2, its near-best opening band. `analyze` searches all root candidates with full windows to compare them at the deepest iteration completed for **every** candidate. These modes can recommend different moves.

A real analysis request with a short forced continuation:

```json
{"v":1,"id":3,"cmd":"analyze","position":{"start":{"a":[0,0,9],"b":[0,0,1],"turn":"A"},"trace":""}}
```

The required nonterminal result fields in this case are:

```json
{"turn":"A","terminal":null,"depth":1,"nodes":1,"budgetHit":false,"recommended":"91","proven":"A","distance":1,"candidates":[{"move":"91","score":9999,"bound":"exact-at-depth","proven":"A","distance":1,"end":"clearance","pv":["91"]}]}
```

The `pv` begins with the candidate and lists legal taps in chronological order. The GUI replays every line against its own history. A bound is `exact-at-depth`, `lower`, or `upper`. An exact-at-depth evaluation may still be a heuristic estimate. `proven` names a winning seat only when the engine has established the outcome with the current history. A null value means unknown. `end` identifies a search horizon, a proof frontier at a certified endgame, or a terminal reason. A certified position can end a line before the game ends. `distance` is reported only when every remaining tap is forced through termination. A terminal analysis returns an empty candidate list, a null recommendation, the named result and zero depth and nodes.

The host validates moves and continuations. An external engine is responsible for the truth of its own numerical evaluations and proof claims. To test a process, pipe the example requests into `node studio/engine.mjs --engine v2`. The native C++ executable also accepts `analyze` directly, with the same command-line arguments as `choose`.

## Probabilities and empirical checks

The default instant forecast is for **Guided 15% playing itself**. This policy uses v2's evaluation table, immediate tactical checks and 15% uniform exploration. A position with a forced continuation to termination uses the exact result for every policy. The graph retains A's perspective on both players' turns. Switch to **Engine score** to compute the selected analysis engine's evaluation throughout the active line.

For training, one pre-move position is sampled uniformly from each of 60,000 independent seeded games at the standard opening. A gradient-boosted classifier fits decisive results on 42,000 games using board and history features. Logistic calibration uses 9,000 different games. On the remaining 9,000, the learned component's three-outcome Brier score is 0.3386, against 0.5001 for constant training frequencies (unscaled sum of squared class errors, lower is better). All games were decisive. The model uses a pooled Jeffreys-smoothed draw frequency of 0.5 / 42,001. The data cannot establish position-specific draw probabilities. Arbitrary setups and positions under stronger policies can have a different distribution.

**Simulate this position** runs the selected pair from the exact current history. The panel reports W/D/L, completed sample size and Wilson intervals. V1 and v2 use their released search settings. Simulations that reach a deterministic suffix will share it. Seeds reproduce runs, including runs split into batches.

To regenerate the assets, run from the repository root:

```sh
g++ -O3 -std=c++17 studio/export_tables.cpp -o export_tables
./export_tables > dist/studio/assets/tables.bin
node studio/sample-wdl.mjs 60000 wdl-samples.csv
OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=2 python3 studio/fit-wdl.py wdl-samples.csv
```

Only the last command requires NumPy and scikit-learn. Both frozen assets are tracked. To run the checks with the native engine and optional calibration data:

```sh
g++ -O3 -std=c++17 v2/engine.cpp -o engine2
TAPGAME_NATIVE=./engine2 node --test tests/*.test.mjs
TAPGAME_NATIVE=./engine2 TAPGAME_WDL_SAMPLES=wdl-samples.csv node --test tests/*.test.mjs
```

The suite replays all 10,000 archived records, compares fresh endgame labels, compares browser and native search results, and plays complete games over the process bridge. Set `TAPGAME_FROZEN` to an original v2 executable to compare against its playing decisions. The self-contained Python play-only example is in [studio/example_bot.py](../studio/example_bot.py).
