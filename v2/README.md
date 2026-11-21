# Tapgame v2

V2 plays the original modulo-10, three-number positional-superko game. Both players begin with three 1s. A move that repeats the two named players’ sorted triples is forbidden regardless of turn. A player wins by clearing all their numbers or by leaving the other player without a legal tap. The timeout is 20,000 consecutive taps, or 10,000 two-tap rounds, without a withdrawal.

## Play the released bot

Run these commands from the archive root with a C++17 compiler.

```sh
g++ -O3 -std=c++17 v2/engine.cpp -o engine2
echo '42 1112' | ./engine2 choose model/values.txt v2/values.txt 500000 12 18
```

The first input number seeds v2's move selection. The optional second field is the history from the opening, two digits per tap (own tapping value, opponent's value). Omit the history for the initial position. Each output gives the selected pair. The caller can submit multiple independent lines to the same process. In match mode the engine reads game number, policy seed and a v2-first flag (1/0) for each game.

## Training

Generation 1 uses two copies of the frozen v1 evaluation table and depth-three alpha–beta with 17% random exploration. Generation 2 uses the first newly fitted table on both sides, depth four and 13% exploration. Each generation plays 40,000 full games under superko, capped at 1,000 main search calls per decision. Within each generation, every tenth seed is reserved for game-level validation. The final model is fitted to both generations’ training partitions. Training and tournament seeds are disjoint.

Training aggregates outcome counts by board, then pools positions related by multiplying all digit values by 1, 3, 7 or 9 modulo 10. All four maps preserve addition, withdrawal and board equality. The 107 features consist of the 26 v1 board features plus 81 products of own and opposing nonzero-digit counts. A 96/48-unit ReLU network is fitted to empirical values with square-root visitation weights. Predictions are averaged over the four symmetries. State-specific empirical outcomes are shrunk toward that learned estimate using 80 pseudo-observations in the augmented count scale. The final table adds ordinary-game outcome and live-number difference. No game result from the final matches is used in training, configuration selection or move choice.

## Search

The engine solves a forced one-on-one sequence in the actual history. To construct endgame tables, it works upward in the number of live numbers. Within each phase it computes candidate win/loss labels by backward propagation, treating withdrawals with an already certified smaller-phase result as exits. A recursive checker verifies a decreasing-rank strategy in a fresh superko history, covering all opposing replies and at least one winning continuation. A truncated or failed check supplies no certificate. A fresh phase begins on each withdrawal. Earlier phases can never recur. The table therefore gives a decisive search score after such an exit; in an ongoing phase, nominal labels are ordering/evaluation hints, and a winning root strategy is checked against the current history before being used directly. Table ranks order proofs; they do not claim optimal mate distances.

Within each decision the engine reuses a previously successful move as an ordering hint, with full history checks at each node. The deepest completed iterative-deepening alpha–beta pass supplies the move. During the opening (first 20 taps), v2 draws uniformly among root moves within 12 evaluation points of the best score. Thereafter it breaks exact ties uniformly. A decisive search score disables the near-best allowance. A certified root move is taken directly. Repeated identical full game prefixes can reuse the exact same list of eligible moves in the tournament runner. V1 uses its original published C++ decision routine, original weights, original deterministic tie handling and its 8-tap / 4,500-node limits.

## Reproduce

The source archive includes both frozen models, the interim model, the original game/engine code, compressed per-board counts for both generations, training and referee scripts, configuration selection results and metadata. Python 3.12, NumPy 2.3.5, scikit-learn 1.8.0 and libstdc++ were used. The released score tables eliminate any floating-point retraining variance when reproducing the matches.

```sh
g++ -O3 -std=c++17 src/tap.cpp -o tap1
g++ -O3 -std=c++17 v2/selfplay.cpp -o selfplay
g++ -O3 -std=c++17 v2/engine.cpp -o engine2
./tap1 features > features.csv
export OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1
python v2/generate.py ./selfplay model/values.txt g1.npy 40000 11000000 3 17
python v2/fit.py features.csv v2/generation1.txt g1.npy
python v2/generate.py ./selfplay v2/generation1.txt g2.npy 40000 12000000 4 13
python v2/fit.py features.csv v2/values.txt g1.npy g2.npy
mkdir -p dist/data
python v2/tournament.py ./engine2 model/values.txt v2/values.txt dist/data/v2-v1.csv 5000 882347 45000000 500000 12 8 --depth 18
python v2/tournament.py ./engine2 model/values.txt v2/values.txt dist/data/v2-equal.csv 500 67121 22400000 4500 12 4 --depth 8
python v2/tournament.py ./engine2 model/values.txt v2/values.txt dist/data/v2-equal-nodes.csv 500 67121 22400000 4500 12 2 --depth 18
python v2/report.py
```

Six development configurations use the same independently shuffled seats (seed 47301) and 160 policy seeds starting at 21300000. Highest pilot match score wins, breaking ties toward fewer nodes and then shallower depth. The frozen main tournament shuffles precisely 2,500 first-seat and 2,500 second-seat entries. Its game seed controls only move sampling. All 5,000 games start at the genuine opening; no forced/random prefix is added. The two 500-game diagnostic schedules share their seat assignments and seeds. Main-node budgets omit forced-line and proof-checking work and are not an equal-time standard.

An independent Python implementation also enumerates fresh one-versus-one and one-versus-two games. To cross-check the C++ table and replay v1's own decision routine on every main-tournament v1 turn:

```sh
./engine2 small-table model/values.txt v2/values.txt > small.csv
python v2/check_fresh.py small.csv
g++ -O3 -std=c++17 v2/audit_v1.cpp -o audit_v1
python -c "import csv; [print(r['bot_first'],r['trace']) for r in csv.DictReader(open('dist/data/v2-v1.csv'))]" | ./audit_v1 model/values.txt
```
