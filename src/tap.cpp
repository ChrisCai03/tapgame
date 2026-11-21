// Three-number positional-superko finger game. Build with C++17.
#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <fstream>
#include <iostream>
#include <queue>
#include <random>
#include <stdexcept>
#include <string>
#include <vector>
using namespace std;
constexpr int H=220, N=H*H, MATE=10000, QUIET_LIMIT=20000;
struct Move {int next,x,y; bool drop;};
struct Board {array<Move,9> moves{}; int count=0, drops=0, ordinary=0, distance=0, value=0;};
array<Board,N> graph;
array<array<int,3>,H> hands;
array<int,H> live;
int handId[1000], opening;
int packed(array<int,3> a){sort(a.begin(),a.end());return a[0]*100+a[1]*10+a[2];}
int key(int state,int turn){return turn ? state%H*H+state/H : state;}
void initialize(){
 int id=0;
 for(int a=0;a<10;a++)for(int b=a;b<10;b++)for(int c=b;c<10;c++){
   hands[id]={a,b,c};handId[100*a+10*b+c]=id;live[id]=(a>0)+(b>0)+(c>0);id++;
 }
 opening=handId[111]*(H+1);
 vector<vector<int>> predecessors(N);vector<int> left(N);queue<int> q;
 for(int s=0;s<N;s++){
   int a=s/H,b=s%H;auto& g=graph[s];
   if(!a || !b){g.ordinary=b?1:-1;q.push(s);continue;}
   for(int i=0;i<3;i++){
    int x=hands[a][i];if(!x || (i && x==hands[a][i-1]))continue;
    for(int j=0;j<3;j++){
     int y=hands[b][j];if(!y || (j && y==hands[b][j-1]))continue;
     auto next=hands[a];next[i]=(x+y)%10;
     Move m{b*H+handId[packed(next)],x,y,next[i]==0};
     g.moves[g.count++]=m;g.drops+=m.drop;predecessors[m.next].push_back(s);
    }
   }
   left[s]=g.count;
 }
 while(!q.empty()){
   int s=q.front();q.pop();
   for(int p:predecessors[s]){
     auto& g=graph[p];if(g.ordinary)continue;
     if(graph[s].ordinary<0 || --left[p]==0){
       g.ordinary=-graph[s].ordinary;g.distance=graph[s].distance+1;q.push(p);
     }
   }
 }
 for(int s=0;s<N;s++){
   auto& g=graph[s];g.value=100*(live[s%H]-live[s/H])+g.ordinary*240+20*(g.drops>0)+g.count;
 }
}
struct Player{
 array<unsigned char,N> seen{};mt19937 rng;
 int nodes=0,budget=0;bool stopped=false;
 explicit Player(unsigned seed):rng(seed){}
 bool legal(int s,int turn)const{return !seen[key(s,turn)];}
 int single(int s,int t,int ply,int quiet){ // exactly one legal arithmetic choice per turn
   if(s%H==0)return -MATE+ply;
   auto m=graph[s].moves[0];int k=key(m.next,1-t);
   if(seen[k])return -MATE+ply;
   if(m.next%H==0)return MATE-ply-1;
   if(quiet+1>=QUIET_LIMIT)return 0;
   seen[k]=1;int score=-single(m.next,1-t,ply+1,quiet+1);seen[k]=0;return score;
 }
 int search(int s,int t,int d,int alpha,int beta,int ply,int quiet){
   if(++nodes>budget){stopped=true;return 0;}
   if(! (s%H))return -MATE+ply;
   if(quiet>=QUIET_LIMIT)return 0;
   if(live[s/H]==1 && live[s%H]==1)return single(s,t,ply,quiet);
   auto& g=graph[s];array<pair<int,int>,9> order;int n=0;
   for(int i=0;i<g.count;i++){
      auto m=g.moves[i];if(!legal(m.next,1-t))continue;
      if(m.next%H==0)return MATE-ply-1;
      order[n++]={graph[m.next].value-12*int(m.drop),i};
   }
   if(n==0)return -MATE+ply;
   if(d==0)return g.value-3*(g.count-n);
   sort(order.begin(),order.begin()+n);
   int best=-2*MATE;
   for(int i=0;i<n;i++){
      auto m=g.moves[order[i].second];int k=key(m.next,1-t);seen[k]=1;
      int score=-search(m.next,1-t,d-1,-beta,-alpha,ply+1,m.drop?0:quiet+1);seen[k]=0;
      if(stopped)return 0;
      best=max(best,score);alpha=max(alpha,score);if(alpha>=beta)break;
   }
   return best;
 }
 vector<int> options(int s,int t)const{
    vector<int> out;for(int i=0;i<graph[s].count;i++)if(legal(graph[s].moves[i].next,1-t))out.push_back(i);
    return out;
 }
 int randomChoice(const vector<int>& ids){return ids[uniform_int_distribution<int>(0,int(ids.size())-1)(rng)];}
 int heuristic(int s,int t,const vector<int>& choices){
    vector<int> ties;int best=-1;
    for(int i:choices){
      auto m=graph[s].moves[i];auto& reply=graph[m.next];bool danger=false,canWin=false;int legalReplies=0;
      for(int j=0;j<reply.count;j++){
        auto r=reply.moves[j];if(!legal(r.next,t))continue;
        legalReplies++;danger|=r.drop;canWin|=(r.next%H==0);
      }
      int grade=(!legalReplies || m.next%H==0)?10:4*!canWin+2*!danger+int(m.drop);
      if(grade>best){best=grade;ties.clear();}if(grade==best)ties.push_back(i);
    }
    return randomChoice(ties);
 }
 int engine(int s,int t,vector<int> ids,int quiet,int depth,int limit){
    if(ids.size()==1)return ids[0];
    nodes=0;stopped=false;budget=limit;
    stable_sort(ids.begin(),ids.end(),[&](int i,int j){return graph[graph[s].moves[i].next].value<graph[graph[s].moves[j].next].value;});
    int chosen=ids.front();
    for(int d=1;d<=depth;d++){
      int best=-2*MATE,pick=chosen;
      for(int i:ids){
        auto m=graph[s].moves[i];int k=key(m.next,1-t);seen[k]=1;
        int v=-search(m.next,1-t,d-1,-2*MATE,-best,1,m.drop?0:quiet+1);seen[k]=0;
        if(stopped)return chosen;
        if(v>best){best=v;pick=i;}
      }
      chosen=pick;
      if(abs(best)>MATE/2)break;
      rotate(ids.begin(),find(ids.begin(),ids.end(),chosen),find(ids.begin(),ids.end(),chosen)+1);
    }
    return chosen;
 }
};
int main(int argc,char**argv){
 if(argc<2)return 1;
 initialize();string mode=argv[1];
 if(mode=="features"){
   cout<<"state";for(int i=0;i<26;i++)cout<<",x"<<i;cout<<"\n";
   for(int s=0;s<N;s++){
     cout<<s;
     for(int p:{s/H,s%H})for(int v=0;v<10;v++)cout<<","<<count(hands[p].begin(),hands[p].end(),v);
     auto& g=graph[s];cout<<","<<live[s/H]<<","<<live[s%H]<<","<<g.count<<","<<g.drops<<","<<g.ordinary<<","<<min(40,g.distance)<<"\n";
   }
   return 0;
 }
 if(mode=="choose"){ // Supply a replay string of (own digit, opponent digit) pairs on stdin.
    if(argc!=3)throw runtime_error("choose values.txt");
    ifstream f(argv[2]);for(auto& g:graph)if(!(f>>g.value))throw runtime_error("invalid model");
    Player player(0);string trace;getline(cin,trace);int state=opening,turn=0,quiet=0;
    player.seen[key(state,turn)]=1;
    if(trace.size()%2)throw runtime_error("incomplete move");
    for(size_t j=0;j<trace.size();j+=2){
       bool found=false;
       if(quiet>=QUIET_LIMIT)throw runtime_error("game ended");
       for(int i:player.options(state,turn)){
         auto m=graph[state].moves[i];
         if(m.x!=trace[j]-'0' || m.y!=trace[j+1]-'0')continue;
         quiet=m.drop?0:quiet+1;state=m.next;turn=1-turn;player.seen[key(state,turn)]=1;
         found=true;break;
       }
       if(!found)throw runtime_error("illegal replay");
    }
    auto choices=player.options(state,turn);
    if(choices.empty() || quiet>=QUIET_LIMIT){cout<<"game over\n";return 0;}
    auto m=graph[state].moves[player.engine(state,turn,choices,quiet,8,4500)];
    cout<<m.x<<" "<<m.y<<"\n";return 0;
 }
 if((mode!="train" && mode!="match")||argc<5)throw runtime_error("train|match count seed baseline [values]");
 int games=stoi(argv[2]);unsigned master=stoul(argv[3]);string baseline=argv[4];bool train=mode=="train";
 if(!train){
    if(argc<6)throw runtime_error("missing model scores");
    ifstream f(argv[5]);int val;for(int i=0;i<N;i++){
      if(!(f>>val)||abs(val)>1000)throw runtime_error("invalid value table");graph[i].value=val;
    }
    cout<<"game,seed,bot_first,result,reason,taps,withdrawals,trace\n";
 }else cout<<"game,state,target\n";
 for(int g=0;g<games;g++){
   unsigned seed=master+g;Player p(seed);int s=opening,t=0,quiet=0,winner=-1,plies=0,drops=0;
   string trace,reason;vector<pair<int,int>> training;
   while(true){
     p.seen[key(s,t)]=1;
     if(s%H==0){winner=1-t;reason="cleared";break;}
     if(quiet>=QUIET_LIMIT){reason="timeout";break;}
     auto opts=p.options(s,t);
     if(opts.empty()){winner=1-t;reason="blocked";break;}
     int pick;
     if(train){
       training.push_back({s,t});
       if(uniform_int_distribution<int>(0,99)(p.rng)<18)pick=p.randomChoice(opts);
       else {shuffle(opts.begin(),opts.end(),p.rng);pick=p.engine(s,t,opts,quiet,2,200);}
     }else if(t==g%2)pick=p.engine(s,t,opts,quiet,8,4500);
     else if(baseline=="random")pick=p.randomChoice(opts);
     else if(baseline=="heuristic")pick=p.heuristic(s,t,opts);
     else throw runtime_error("unknown baseline");
     auto m=graph[s].moves[pick];trace+=char('0'+m.x);trace+=char('0'+m.y);
     quiet=m.drop?0:quiet+1;drops+=m.drop;s=m.next;t=1-t;plies++;
   }
   if(train){
     for(auto [state,side]:training)cout<<g<<","<<state<<","<<(winner<0?0:(side==winner?1:-1))<<"\n";
   }else cout<<g+1<<","<<seed<<","<<(g%2==0)<<","<<(winner<0?"draw":(winner==g%2?"win":"loss"))<<","<<reason<<","<<plies<<","<<drops<<","<<trace<<"\n";
 }
}
