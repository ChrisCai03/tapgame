// Build the browser's read-only tables directly from the two released engines.
// Run from the repository root. All multi-byte values are little endian.
#define TAPGAME_ENGINE_LIBRARY
#include "../v2/engine.cpp"

int main() {
    initialize();
    ifstream v1("model/values.txt"), v2("v2/values.txt");
    if (!v1 || !v2) return 1;
    buildEndgames();
    cout.write("TGS1", 4);
    auto put = [](int value) {
        uint16_t bits = static_cast<uint16_t>(value);
        cout.put(char(bits & 255));
        cout.put(char(bits >> 8));
    };
    for (int s = 0; s < N; ++s) {
        int a, b;
        if (!(v1 >> a) || !(v2 >> b)) {
            return 2;
        }
        put(a); put(b);
        put(nominal[s].sign); put(nominal[s].rank);
        put(certified[s].sign); put(certified[s].rank);
    }
    return cout ? 0 : 3;
}
