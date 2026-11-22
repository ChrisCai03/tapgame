// Exhaustive six-tap proof search from every fresh three-versus-three board.
// The second column of results allows a withdrawal into a certified fresh ending.
// Both searches ignore heuristic scores and learned weights.
#define TAPGAME_ENGINE_LIBRARY
#include "../v2/engine.cpp"

array<bool, N> visited{};

int outcome(int state, int turn, int remaining, bool allowCertificates, int* witness = nullptr) {
    if (state % H == 0) return -1;  // Previous mover cleared their last slot.
    bool allLose = true;
    const Board& board = graph[state];
    for (int i = 0; i < board.count; ++i) {
        const Move move = board.moves[i];
        const int k = key(move.next, 1-turn);
        if (visited[k]) continue;
        if (remaining == 0) return 0;  // Legal move at a nonterminal leaf.
        visited[k] = true;
        const int certificate = allowCertificates && move.drop ? certified[move.next].sign : 0;
        const int child = certificate ? certificate : outcome(move.next, 1-turn, remaining-1, allowCertificates);
        visited[k] = false;
        if (child == -1) {
            if (witness) *witness = 10 * move.x + move.y;
            return 1;
        }
        if (child == 0) allLose = false;
    }
    return allLose ? -1 : 0;  // Includes blockade when every tap was banned.
}

int main(int argc, char** argv) {
    bool binary = argc == 2 && string(argv[1]) == "--binary";
    if (argc > 1 && !binary) return 2;
    initialize();
    buildEndgames();
    if (!binary) cout << "mover,opponent,within_six,certified_two_ply\n";
    for (int a = 0; a < H; ++a) {
        if (live[a] != 3) continue;
        for (int b = 0; b < H; ++b) {
            if (live[b] != 3) continue;
            int root = a * H + b;
            visited[root] = true;
            int quickMove = 0, endgameMove = 0;
            int sign = outcome(root, 0, 6, false, &quickMove);
            int extended = outcome(root, 0, 2, true, &endgameMove);
            if (sign && extended && sign != extended) return 3;
            visited[root] = false;
            if (binary) {
                cout.put(char(sign > 0 ? 1 : sign < 0 ? 2 : extended > 0 ? 3 : extended < 0 ? 4 : 0));
                cout.put(char(sign ? quickMove : endgameMove));
                continue;
            }
            cout << packed(hands[a]) << ',' << packed(hands[b]) << ',' << sign << ',' << extended << '\n';
        }
    }
}
