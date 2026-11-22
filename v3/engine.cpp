#define TAPGAME_ENGINE_LIBRARY
#include "../v2/engine.cpp"
#include "search.hpp"

// choose and match-start use the frozen v2 command-line wire format.
int main(int argc,char** argv) {
    if(argc<7)throw runtime_error("MODE v1-values v2-values nodes band depth [left right]");
    initialize();buildEndgames();
    ifstream old(argv[2]),updated(argv[3]);
    for(int i=0;i<N;++i)if(!(old>>graph[i].value) || !(updated>>value2[i]))throw runtime_error("missing tables");
    static V3 bot;
    bot.load("dist/studio/assets/v3.bin");
    Search previous;
    previous.limit=500000;previous.depth=18;
    bot.limit=stoi(argv[4]);bot.depth=stoi(argv[6]);
    const int band=stoi(argv[5]);string mode=argv[1];
    if(bot.limit<16 || bot.limit>2000000 || bot.depth<1 || bot.depth>32 || band<0)
        throw runtime_error("expected nodes 16..2000000, depth 1..32, and nonnegative V2 band");
    bool match=mode=="match-start";
    if(!match && mode!="choose")throw runtime_error("use choose or match-start");
    string left=argc>7?argv[7]:"v3",right=argc>8?argv[8]:"v2";
    if(match)cout<<"game,seed,bot_first,result,reason,taps,withdrawals,trace,start\n";
    for(string line;getline(cin,line);) {
        istringstream in(line);string prefix="-",start="A111111";unsigned seed;int id=0,first=1;
        if(match){if(!(in>>id>>seed>>first>>start) || (first!=0 && first!=1))throw runtime_error("invalid schedule");}
        else{if(!(in>>seed))throw runtime_error("missing seed");in>>prefix>>start;}
        if(start.size()!=7 || (start[0]!='A' && start[0]!='B') || start.find_first_not_of("0123456789",1)!=string::npos)throw runtime_error("invalid start");
        auto hand=[&](int j){return handId[packed({start[j]-'0',start[j+1]-'0',start[j+2]-'0'})];};
        int t=start[0]=='B',s=key(hand(1)*H+hand(4),t),side=first?t:1-t,quiet=0,drops=0,winner=-1;
        if(!s)throw runtime_error("empty board");
        if(match && (live[s/H]!=3 || live[s%H]!=3))throw runtime_error("match-start expects three live numbers per seat");
        if(prefix=="-")prefix.clear();
        string trace,reason;Player p(seed);history.fill(0);
        for(;;) {
            history[key(s,t)]=p.seen[key(s,t)]=1;
            if(!(s/H) || !(s%H)){winner=!(s/H)?t:1-t;reason="cleared";break;}
            if(quiet>=QUIET_LIMIT){reason="timeout";break;}
            auto opts=p.options(s,t);
            if(opts.empty()){winner=1-t;reason="blocked";break;}
            int pick=-1;
            if(trace.size()<prefix.size()) {
                for(int i:opts){auto m=graph[s].moves[i];if(trace.size()+1<prefix.size() && prefix[trace.size()]==char('0'+m.x) && prefix[trace.size()+1]==char('0'+m.y))pick=i;}
                if(pick<0)throw runtime_error("illegal replay");
            } else {
                const string& policy=!match||t==side?left:right;
                if(policy=="v3")pick=bot.choose(s,t,opts,quiet);
                else if(policy=="v2"){auto pool=previous.candidates(s,t,opts,trace.size()/2,band,quiet);pick=pool.size()==1?pool.front():p.randomChoice(pool);}
                else if(policy=="v1")pick=p.engine(s,t,opts,quiet,8,4500);
                else if(policy=="heuristic")pick=p.heuristic(s,t,opts);
                else if(policy=="random")pick=p.randomChoice(opts);
                else throw runtime_error("unknown engine");
                if(!match){auto m=graph[s].moves[pick];cout<<m.x<<" "<<m.y<<'\n';break;}
            }
            auto m=graph[s].moves[pick];trace+=char('0'+m.x);trace+=char('0'+m.y);
            quiet=m.drop?0:quiet+1;drops+=m.drop;s=m.next;t^=1;
        }
        if(match)cout<<id<<","<<seed<<","<<first<<","<<(winner<0?"draw":winner==side?"win":"loss")<<","<<reason<<","<<trace.size()/2<<","<<drops<<","<<trace<<","<<start<<"\n";
        else if(!reason.empty()){if(trace.size()!=prefix.size())throw runtime_error("moves past terminal");cout<<"game over\n";}
    }
}
