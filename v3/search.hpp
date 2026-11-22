// The phase graph uses named seats. Every edge into an already visited board
// is removed. Future repetitions are enforced by the proof and minimax searches.
struct V3Entry {int sign, move, guide, rank, value;};
struct V3 {
    array<V3Entry,N> book{};
    array<vector<uint16_t>,N> supports;
    array<int,N> supportMove{};
    vector<int> group[4][4];
    vector<int> pred[2*N];
    array<int,2*N> sign{}, rank{}, remaining{};
    array<int,N> hints{};
    int rootA=0,rootB=0,nodes=0,limit=500000,depth=32;
    bool context=false;
    array<int,2*N> resilience{}, sweep{};
    bool useRisk=false;
    // Approximate future superko pressure on positions without an attractor label.
    // A quiet tap can become unavailable later. A withdrawal always enters a new phase.
    void modelRisk(const vector<int>& states) {
        vector<int> unresolved;
        for(int id:states) {
            resilience[id]=sign[id]?sign[id]*(1000-min(350,4*rank[id])):book[id%N].value;
            if(!sign[id])unresolved.push_back(id);
        }
        for(int pass=0;pass<10;++pass) {
            for(int id:unresolved) {
                int s=id%N,t=id/N,n=0,floor=-1000;
                array<int,9> taps;
                for(int i=0;i<graph[s].count;++i) {
                    auto m=graph[s].moves[i];
                    if(history[key(m.next,1-t)])continue;
                    if(m.drop) {
                        int z=book[m.next].sign?-1000*book[m.next].sign:-book[m.next].value;
                        floor=max(floor,z);
                    } else taps[n++]=-resilience[(1-t)*N+m.next];
                }
                sort(taps.begin(),taps.begin()+n);
                for(int i=0;i<n;++i)if(taps[i]>floor)floor=(3*taps[i]+floor)/4;
                sweep[id]=floor*99/100;
            }
            for(int id:unresolved)resilience[id]=sweep[id];
        }
    }

    void load(const string& file) {
        ifstream f(file, ios::binary);
        char head[4];
        if (!f.read(head,4) || string(head,4)!="TGV3") throw runtime_error("missing v3 proof book: "+file);
        for (auto& b : book) for (int* v : {&b.sign,&b.move,&b.guide,&b.rank,&b.value}) {
            int lo=f.get(),hi=f.get();
            if (hi<0) throw runtime_error("short v3 book");
            *v=lo+256*hi-(hi>=128?65536:0);
        }
        auto get16=[&](){int lo=f.get(),hi=f.get();if(hi<0)throw runtime_error("short proof support");return lo+256*hi;};
        for(int s=0;s<N;++s) {
            int length=get16();supportMove[s]=-1;
            if(length==65535)continue;
            supportMove[s]=get16();
            for(int i=0;i<length;++i)supports[s].push_back(get16());
        }
        for(int t=0;t<2;++t) for(int s=0;s<N;++s) if(s/H && s%H) {
            int named=key(s,t);
            group[live[named/H]][live[named%H]].push_back(t*N+s);
            for(int i=0;i<graph[s].count;++i) {
                auto m=graph[s].moves[i];
                if(!m.drop) pred[(1-t)*N+m.next].push_back(t*N+s);
            }
        }
    }
    int supported(int s,int t,int quiet,int maxSize=64) const {
        if(supportMove[s]<0 || quiet+128>=QUIET_LIMIT || int(supports[s].size())>maxSize)return 0;
        for(int k:supports[s])if(history[key(k,t)])return 0;
        return book[s].sign;
    }
    bool samePhase(int s,int t) const {
        int k=key(s,t);
        return live[k/H]==rootA && live[k%H]==rootB;
    }
    void prepare(int root,int turn,int quiet) {
        int named=key(root,turn);
        rootA=live[named/H];rootB=live[named%H];
        context=quiet>0;useRisk=context && rootA+rootB<=5;
        hints.fill(-1);
        if(!context)return;
        vector<int> queue;
        const auto& states=group[rootA][rootB];
        for(int id:states) {
            int s=id%N,t=id/N,open=0;
            bool win=false;
            for(int i=0;i<graph[s].count;++i) {
                auto m=graph[s].moves[i];
                if(history[key(m.next,1-t)])continue;
                if(m.drop && book[m.next].sign<0)win=true;
                if(!m.drop || book[m.next].sign<=0)++open;
            }
            sign[id]=win?1:open?0:-1;rank[id]=1;remaining[id]=open;
            if(sign[id])queue.push_back(id);
        }
        for(size_t i=0;i<queue.size();++i) {
            int id=queue[i];
            if(history[key(id%N,id/N)])continue;
            for(int parent:pred[id]) if(!sign[parent]) {
                if(sign[id]<0 || --remaining[parent]==0) {
                    sign[parent]=-sign[id];rank[parent]=rank[id]+1;
                    queue.push_back(parent);
                }
            }
        }
        if(useRisk)modelRisk(states);
    }
    int strategy(int s,int t,int wanted,int& budget,int* chosen=nullptr) {
        if(--budget<0)return false;
        int id=t*N+s;
        const auto& g=graph[s];
        for(int i=0;i<g.count;++i) {
            auto m=g.moves[i];int k=key(m.next,1-t);
            if(history[k])continue;
            int child=(1-t)*N+m.next;
            bool ok=false;
            if(m.drop)ok=book[m.next].sign==-wanted;
            else if(sign[child]==-wanted && rank[child]<rank[id]) {
                history[k]=1;ok=strategy(m.next,1-t,-wanted,budget);history[k]=0;
            }
            if(ok && wanted>0){if(chosen)*chosen=i;return true;}
            if(!ok && wanted<0)return false;
        }
        return wanted<0;
    }
    int eval(int s,int t) const {
        const auto& b=book[s];
        bool active=context && samePhase(s,t);
        int result=active?sign[t*N+s]:b.guide;
        int distance=active?rank[t*N+s]:b.rank;
        return (active && useRisk?resilience[t*N+s]:b.value)+value2[s]/4+result*(1600-min(400,distance*3));
    }
    int search(int s,int t,int d,int alpha,int beta,int ply,bool fresh,int quiet) {
        if(++nodes>limit)return 0;
        if(s%H==0)return -MATE+ply;
        if(quiet>=QUIET_LIMIT)return 0;
        if(isSingle(s))return forced(s,t,ply,quiet);
        int claim=fresh?book[s].sign:supported(s,t,quiet);
        if(claim)return claim*(8000-ply-min(250,book[s].rank));
        const auto& g=graph[s];array<pair<int,int>,9> order;int n=0,safe=0,delay=0;
        for(int i=0;i<g.count;++i) {
            auto m=g.moves[i];
            if(history[key(m.next,1-t)])continue;
            if(m.next%H==0)return MATE-ply-1;
            int outcome=m.drop?book[m.next].sign:supported(m.next,1-t,quiet+1);
            if(outcome<0)return 8000-ply-1-min(250,book[m.next].rank);
            safe+=outcome==0;
            if(outcome>0)delay=max(delay,min(250,book[m.next].rank));
            int p=eval(m.next,1-t)+(outcome>0?6000:0);
            if(hints[s]==i)p-=12000;
            order[n++]={p,i};
        }
        if(!n)return -MATE+ply;
        if(!safe)return -8000+ply+1+delay;
        const bool extend=safe==1 && ply<depth+16;
        if(!d && !extend)return eval(s,t)-12*(g.count-n);
        sort(order.begin(),order.begin()+n);
        int best=-20000,chosen=-1;
        for(int j=0;j<n;++j) {
            int i=order[j].second;auto m=g.moves[i];int k=key(m.next,1-t);
            history[k]=1;
            int score=-search(m.next,1-t,extend?d:d-1,-beta,-alpha,ply+1,m.drop,m.drop?0:quiet+1);
            history[k]=0;
            if(nodes>limit)return 0;
            if(score>best){best=score;chosen=i;}
            alpha=max(alpha,score);
            if(alpha>=beta)break;
        }
        hints[s]=chosen;
        return best;
    }
    int choose(int s,int t,vector<int> moves,int quiet) {
        if(moves.size()==1)return moves.front();
        if(!quiet && book[s].sign>0) {
            for(int i:moves)if(10*graph[s].moves[i].x+graph[s].moves[i].y==book[s].move)return i;
        }
        if(quiet && supported(s,t,quiet,N)>0) {
            for(int i:moves)if(10*graph[s].moves[i].x+graph[s].moves[i].y==supportMove[s])return i;
        }
        prepare(s,t,quiet);
        int id=t*N+s, chosen=-1,budget=12000;
        if(context && sign[id]>0 && quiet+rank[id]<QUIET_LIMIT && strategy(s,t,1,budget,&chosen))return chosen;
        nodes=0;
        chosen=moves.front();
        for(int d=1;d<=depth;++d) {
            int best=-20000;
            vector<pair<int,int>> rows;
            for(int i:moves) {
                auto m=graph[s].moves[i];int k=key(m.next,1-t);
                history[k]=1;
                int val=-search(m.next,1-t,d-1,-20000,-best,1,m.drop,m.drop?0:quiet+1);
                history[k]=0;
                if(nodes>limit)return chosen;
                rows.push_back({val,i});
                best=max(best,val);
            }
            stable_sort(rows.begin(),rows.end(),[](auto a,auto b){return a.first>b.first;});
            for(size_t i=0;i<moves.size();++i)moves[i]=rows[i].second;
            chosen=moves.front();
            if(abs(best)>5000)break;
        }
        return chosen;
    }
};
