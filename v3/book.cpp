// Make fresh-position proofs and a bounded evaluator for all hand configurations.
#define TAPGAME_ENGINE_LIBRARY
#include "../v2/engine.cpp"

struct Entry {
    int sign = 0, move = 0, guide = 0, rank = 0, value = 0;
};
array<Entry, N> book;
array<bool, N> path;

int edgeSign(const Move& m) {
    return m.drop ? book[m.next].sign : book[m.next].guide;
}

// A return of zero means the search frontier was unresolved. No heuristic can
// certify a move. After a withdrawal every earlier board has more live digits.
int verify(int s, int t, int depth, int& budget, bool ranked, int& witness) {
    if (s % H == 0) return -1;
    if (--budget < 0) return 0;
    const auto& g = graph[s];
    bool unknown = false;
    // Try nominally winning children first at an OR node.
    for (int order = 0; order < 2; ++order) {
        for (int i = 0; i < g.count; ++i) {
            auto m = g.moves[i];
            const int k = key(m.next, 1-t);
            if (path[k] || (edgeSign(m) < 0) != (order == 0)) continue;
            if (depth == 0) return 0;
            int child = 0;
            if (m.drop) child = book[m.next].sign;
            else if (!ranked || (book[m.next].guide && book[m.next].rank < book[s].rank)) {
                path[k] = true;
                int unused = 0;
                child = verify(m.next, 1-t, depth-1, budget, ranked, unused);
                path[k] = false;
            }
            if (child == -1) { witness = 10*m.x+m.y; return 1; }
            if (!child) unknown = true;
            if (budget < 0) return 0;
        }
    }
    return unknown ? 0 : -1;
}

void phaseBook(int phase) {
    vector<int> states;
    for (int s = 0; s < N; ++s)
        if (s/H && s%H && phaseCount[s] == phase) states.push_back(s);
    for (int rank = 1;; ++rank) {
        vector<pair<int,int>> updates;
        for (int s : states) if (!book[s].guide) {
            bool win = false, lose = true;
            for (int i = 0; i < graph[s].count; ++i) {
                int reply = edgeSign(graph[s].moves[i]);
                win |= reply < 0;
                lose &= reply > 0;
            }
            if (win || lose) updates.push_back({s,win ? 1 : -1});
        }
        if (updates.empty()) break;
        for (auto [s,sign] : updates) { book[s].guide = sign; book[s].rank = rank; }
    }
    int known = 0;
    for (int s : states) {
        auto& b = book[s];
        path[s] = true;
        if (phase == 2) {
            b.sign = certified[s].sign;
            if (b.sign > 0) b.move = 10*graph[s].moves[0].x+graph[s].moves[0].y;
        } else {
            int budget = 18000;
            if (b.guide) b.sign = verify(s, 0, 128, budget, true, b.move);
            for (int depth : {4,8,14}) {
                if (b.sign) break;
                budget = 7000;
                b.sign = verify(s, 0, depth, budget, false, b.move);
            }
            if (certified[s].sign) {
                if (b.sign && b.sign != certified[s].sign) throw runtime_error("inconsistent proof");
                if (!b.sign) {
                    b.sign = certified[s].sign;
                    if (b.sign > 0) {
                        int i=-1, oldBudget=4000;
                        history[s]=1;
                        if (!prove(s,0,1,oldBudget,&i) || i<0) throw runtime_error("missing v2 witness");
                        history[s]=0;
                        b.move = 10*graph[s].moves[i].x+graph[s].moves[i].y;
                    }
                }
            }
        }
        path[s] = false;
        known += b.sign != 0;
    }
    cerr << "Live digits " << phase << ": " << known << " / " << states.size() << " proven\n";
}

// Discounted minimax with a small chance of a uniformly random tap at either
// seat. Permanent exits use exact fresh outcomes when available. The resulting
// values rank unresolved choices and never carry a proof flag.
void estimate() {
    array<double,N> v{}, following{};
    for (int round=0; round<240; ++round) {
        for (int s=0; s<N; ++s) {
            const auto& g=graph[s];
            if (!g.count) {following[s]=s%H ? 1 : -1;continue;}
            double best=-2, sum=0;
            for (int i=0;i<g.count;++i) {
                auto m=g.moves[i];
                double z=m.drop && book[m.next].sign ? -book[m.next].sign : -v[m.next];
                best=max(best,z); sum+=z;
            }
            following[s]=0.988*(0.92*best+0.08*sum/g.count);
        }
        v.swap(following);
    }
    for (int s=0;s<N;++s) book[s].value=lround(1000*v[s]);
}
// Construct a sufficient support for a strategy. Only quiet targets that
// the winner must land on can be invalidated by an older board history.
bool supportProof(int s, int t, int wanted, int depth, int& budget, bool ranked,
                  vector<uint16_t>& support, int& witness) {
    if (s%H==0) return wanted<0;
    if (--budget<0) return false;
    const auto& g=graph[s];
    for(int order=0;order<2;++order) for(int i=0;i<g.count;++i) {
        auto m=g.moves[i];int k=key(m.next,1-t);
        if(path[k] || (edgeSign(m)<0)!=(order==0))continue;
        if(depth==0)return false;
        vector<uint16_t> sub;
        bool ok=false;
        if(m.drop)ok=book[m.next].sign==-wanted;
        else if(!ranked || (book[m.next].guide && book[m.next].rank<book[s].rank)) {
            int unused=0;
            path[k]=true;
            ok=supportProof(m.next,1-t,-wanted,depth-1,budget,ranked,sub,unused);
            path[k]=false;
        }
        if(wanted>0 && ok) {
            if(!m.drop)sub.push_back(k);
            support.swap(sub);witness=10*m.x+m.y;
            return true;
        }
        if(wanted<0 && !ok)return false;
        if(wanted<0)support.insert(support.end(),sub.begin(),sub.end());
        if(budget<0)return false;
    }
    return wanted<0;
}
void put16(int i){cout.put(char(i&255));cout.put(char((unsigned(i)>>8)&255));}
void writeSupports() {
    int valid=0,unconditional=0,totalKeys=0;
    for(int s=0;s<N;++s) {
        bool ok=false;int witness=0;
        vector<uint16_t> support;
        if(book[s].sign && s/H && s%H) {
            path[s]=true;
            for(auto [depth,ranked] : {pair<int,bool>{128,true},{4,false},{8,false},{14,false},{128,false}}) {
                support.clear();
                int budget=24000;
                ok=supportProof(s,0,book[s].sign,depth,budget,ranked,support,witness);
                if(ok)break;
            }
            path[s]=false;
        }
        if(!ok){put16(65535);continue;}
        sort(support.begin(),support.end());
        support.erase(unique(support.begin(),support.end()),support.end());
        if(binary_search(support.begin(),support.end(),s))throw runtime_error("root in proof support");
        put16(support.size());put16(witness);
        for(auto k:support)put16(k);
        valid++;unconditional+=support.empty();totalKeys+=support.size();
    }
    cerr<<"Supports: "<<valid<<", unconditional: "<<unconditional<<", total keys: "<<totalKeys<<"\n";
}
int main() {
    initialize(); buildEndgames();
    for (int s=0;s<N;++s) if (s%H==0) book[s].sign=-1;
    for (int phase=2;phase<=6;++phase) phaseBook(phase);
    estimate();
    cout.write("TGV3",4);
    for (auto b : book) {
        for (int i : {b.sign,b.move,b.guide,b.rank,b.value}) {
            cout.put(char(i&255)); cout.put(char((unsigned(i)>>8)&255));
        }
    }
    writeSupports();
}
