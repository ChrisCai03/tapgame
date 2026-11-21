#define main archived_main
#include "../src/tap.cpp"
#undef main
#include <unordered_map>
#include <sstream>
// Positions are expressed from the moving player's perspective; history keys retain named seats.
struct Claim{int sign=0,rank=0;};
array<Claim,N> nominal,certified;
array<int,N> value2,phaseCount;
array<unsigned char,N> history{};
bool isSingle(int s){return live[s/H]==1 && live[s%H]==1;}
int forced(int s,int t,int ply,int quiet=0,vector<int>* line=nullptr){
 if(s%H==0)return -MATE+ply;
 if(quiet>=QUIET_LIMIT)return 0;
 auto m=graph[s].moves[0];int k=key(m.next,t^1);
 if(history[k])return -MATE+ply;
 if(line)line->push_back(10*m.x+m.y);
 history[k]=1;int value=-forced(m.next,t^1,ply+1,m.drop?0:quiet+1,line);history[k]=0;return value;
}
// Verify a rank-decreasing strategy in the real history. An exhausted budget yields unknown.
bool prove(int s,int t,int wanted,int& budget,int* bestMove=nullptr){
 if(--budget<0)return false;
 if(s%H==0)return wanted<0;
 if(isSingle(s)){
   if(bestMove)*bestMove=0;
   return (forced(s,t,0)>0)==(wanted>0);
 }
 auto claim=nominal[s];
 if(claim.sign!=wanted)return false;
 auto& g=graph[s];
 for(int i=0;i<g.count;i++){
   auto m=g.moves[i];int k=key(m.next,t^1);if(history[k])continue;
   bool ok;
   if(m.drop)ok=certified[m.next].sign==-wanted;
   else if(nominal[m.next].rank>=claim.rank)ok=false;
   else{
     history[k]=1;ok=prove(m.next,t^1,-wanted,budget);history[k]=0;
   }
   if(wanted>0 && ok){if(bestMove)*bestMove=i;return true;}
   if(wanted<0 && !ok)return false;
 }
 return wanted<0;
}
void buildEndgames(){
 for(int s=0;s<N;s++){
   phaseCount[s]=live[s/H]+live[s%H];
   if(s%H==0)certified[s]=nominal[s]={-1,0};
   else if(isSingle(s)){
     history[s]=1;int z=forced(s,0,0);history[s]=0;
     certified[s]=nominal[s]={z>0?1:-1,MATE-abs(z)};
   }
 }
 for(int phase=3;phase<=5;phase++){
   vector<int> states;for(int s=0;s<N;s++)if(s/H && s%H && phaseCount[s]==phase)states.push_back(s);
   for(int rank=1;;rank++){
     vector<pair<int,int>> updates;
     for(int s:states)if(!nominal[s].sign){
       bool win=false,lose=true;
       for(int i=0;i<graph[s].count;i++){
         auto m=graph[s].moves[i];auto c=m.drop?certified[m.next]:nominal[m.next];
         win|=c.sign<0;lose&=c.sign>0;
       }
       if(win||lose)updates.push_back({s,win?1:-1});
     }
     if(updates.empty())break;
     for(auto [s,sign]:updates)nominal[s]={sign,rank};
   }
   for(int s:states)if(nominal[s].sign){
     int budget=4000;history[s]=1;
     if(prove(s,0,nominal[s].sign,budget))certified[s]=nominal[s];
     history[s]=0;
   }
 }
}
struct Search{
 int visits=0,limit=18000,depth=13,epoch=0;
 array<int,N> stamp{},hint{};
 int eval(int s)const{return value2[s]+nominal[s].sign*260;}
 template<bool Record=false>
 int score(int s,int t,int remaining,int alpha,int beta,int ply,bool fresh,int quiet,vector<int>* line=nullptr){
   if constexpr(Record)line->clear();
   if(++visits>limit)return 0;
   if(s%H==0)return -MATE+ply;
   if(quiet>=QUIET_LIMIT)return 0;
   if(isSingle(s))return forced(s,t,ply,quiet,Record?line:nullptr);
   if(fresh && certified[s].sign)return certified[s].sign*(8000-ply-certified[s].rank);
   auto& g=graph[s];array<pair<int,int>,9> order;int n=0;
   for(int i=0;i<g.count;i++){
     auto m=g.moves[i];if(history[key(m.next,t^1)])continue;
     if(m.next%H==0 || (m.drop && certified[m.next].sign<0)){
       if constexpr(Record)line->push_back(10*m.x+m.y);
       return m.next%H==0?MATE-ply-1:8000-ply-1-certified[m.next].rank;
     }
     int priority=eval(m.next)-20*m.drop;
     if(stamp[s]==epoch && hint[s]==i)priority-=2000;
     order[n++]={priority,i};
   }
   if(!n)return -MATE+ply;
   if(remaining==0)return eval(s)-6*(g.count-n);
   sort(order.begin(),order.begin()+n);
   int best=-2*MATE,pick=order[0].second;
   for(int j=0;j<n;j++){
     int i=order[j].second;auto m=g.moves[i];int k=key(m.next,t^1);
     vector<int> reply;
     history[k]=1;int v=-score<Record>(m.next,t^1,remaining-1,-beta,-alpha,ply+1,m.drop,m.drop?0:quiet+1,Record?&reply:nullptr);history[k]=0;
     if(visits>limit)return 0;
     if(v>best){
       best=v;pick=i;
       if constexpr(Record){line->assign(1,10*m.x+m.y);line->insert(line->end(),reply.begin(),reply.end());}
     }
     alpha=max(alpha,v);if(alpha>=beta)break;
   }
   stamp[s]=epoch;hint[s]=pick;return best;
 }
 vector<int> candidates(int s,int t,vector<int> ids,int ply,int band,int quiet){
   if(ids.size()==1)return ids;
   if(nominal[s].sign>0){
     int checks=4000,pick=-1;
     if(prove(s,t,1,checks,&pick) && find(ids.begin(),ids.end(),pick)!=ids.end())return {pick};
   }
   epoch++;visits=0;vector<int> completed{ids.front()};
   int tol=ply<20?band:0;
   for(int d=1;d<=depth;d++){
     vector<pair<int,int>> scored;int best=-2*MATE;
     for(int i:ids){
       auto m=graph[s].moves[i];int k=key(m.next,t^1);
       history[k]=1;int z=-score(m.next,t^1,d-1,-2*MATE,-best+tol+1,1,m.drop,m.drop?0:quiet+1);history[k]=0;
       if(visits>limit)return completed;
       scored.push_back({z,i});best=max(best,z);
     }
     stable_sort(scored.begin(),scored.end(),[](auto a,auto b){return a.first>b.first;});
     completed.clear();ids.clear();
     for(auto [z,i]:scored){ids.push_back(i);if(z>=best-(abs(best)>5000?0:tol))completed.push_back(i);}
     if(abs(best)>5000)break;
   }
   return completed;
 }
};
#include "analysis.hpp"

#ifndef TAPGAME_ENGINE_LIBRARY
int main(int argc,char**argv){
 if(argc<4)throw runtime_error("v2 MODE v1-values v2-values ...");
 initialize();ifstream old(argv[2]),updated(argv[3]);
 for(int s=0;s<N;s++)if(!(old>>graph[s].value)||!(updated>>value2[s]))throw runtime_error("model missing");
 buildEndgames();Search v2;
 string mode=argv[1];
 if(mode=="small-table"){
   for(int s=0;s<N;s++)if(s/H && s%H && phaseCount[s]<=3){
     for(int a:{s/H,s%H}){for(int x:hands[a])cout<<x;cout<<",";}
     cout<<certified[s].sign<<"\n";
   }
   return 0;
 }
 if(mode=="info"){
   for(int k=2;k<=5;k++){int known=0,total=0;for(int s=0;s<N;s++)if(s/H&&s%H&&phaseCount[s]==k){total++;known+=certified[s].sign!=0;}cout<<k<<" "<<known<<" "<<total<<"\n";}return 0;
 }
 if(mode!="match" && mode!="choose" && mode!="analyze")throw runtime_error("unknown mode");
 if(argc<6)throw runtime_error("supply node limit and early score band");
 v2.limit=stoi(argv[4]);int band=stoi(argv[5]);
 if(argc>6)v2.depth=stoi(argv[6]);
 unordered_map<string,vector<int>> cache[2]; // exact opening-prefix memo; past the opening search directly
 if(mode=="match")cout<<"game,seed,bot_first,result,reason,taps,withdrawals,trace\n";
 string line;
 while(getline(cin,line)){
   int id=0,first=1;unsigned seed=0;string given;istringstream in(line);
   if(mode=="match"){if(!(in>>id>>seed>>first))throw runtime_error("invalid schedule");}
   else{in>>seed>>given;}
   int side=1-first,t=0,quiet=0,s=opening,drops=0,plies=0,winner=-1;string reason,trace;
   bool custom=false;
   if(mode!="match"){
     string start;
     if(given=="-")given.clear();
     if(in>>start){
       if(start.size()!=7 || (start[0]!='A' && start[0]!='B') ||
          start.find_first_not_of("0123456789",1)!=string::npos)throw runtime_error("invalid start");
       auto hand=[&](int j){return handId[packed({start[j]-'0',start[j+1]-'0',start[j+2]-'0'})];};
       t=(start[0]=='B');s=key(hand(1)*H+hand(4),t);
       if(!s)throw runtime_error("both seats cleared");
       custom=true;
     }
   }
   Player p(seed);history.fill(0);
   for(;;){
     history[key(s,t)]=p.seen[key(s,t)]=1;
     if(!(s/H) || !(s%H)){winner=!(s/H)?t:1-t;reason="cleared";break;}
     if(quiet>=QUIET_LIMIT){reason="timeout";break;}
     auto opts=p.options(s,t);if(opts.empty()){reason="blocked";winner=1-t;break;}
     int pick=-1;
     if(mode!="match" && trace.size()<given.size()){
       for(auto i:opts){auto m=graph[s].moves[i];if(trace.size()+1<given.size() && m.x==given[trace.size()]-'0'&&m.y==given[trace.size()+1]-'0')pick=i;}
       if(pick<0)throw runtime_error("illegal prefix");
     }else{
       if(mode=="analyze"){printAnalysis(v2,s,t,opts,quiet);break;}
       bool newBot=mode=="choose"||t==side;
       auto& memory=cache[newBot];vector<int> choices;
       auto found=custom?memory.end():memory.find(trace);
       if(found!=memory.end())choices=found->second;
       else{
         choices=newBot?v2.candidates(s,t,opts,plies,band,quiet):vector<int>{p.engine(s,t,opts,quiet,8,4500)};
         if(!custom && plies<32 && memory.size()<150000)memory.emplace(trace,choices);
       }
       pick=choices.size()==1?choices.front():p.randomChoice(choices);
       if(mode=="choose"){auto m=graph[s].moves[pick];cout<<m.x<<" "<<m.y<<"\n";break;}
     }
     auto m=graph[s].moves[pick];trace+=char('0'+m.x);trace+=char('0'+m.y);plies++;
     quiet=m.drop?0:quiet+1;drops+=m.drop;s=m.next;t^=1;
   }
   if(mode=="match")cout<<id<<","<<seed<<","<<first<<","<<(winner<0?"draw":winner==side?"win":"loss")<<","<<reason<<","<<plies<<","<<drops<<","<<trace<<"\n";
   else if(!reason.empty()){if(trace.size()!=given.size())throw runtime_error("prefix continues past game end");if(mode=="analyze")cout<<"{\"terminal\":{\"winner\":"<<(winner<0?"null":winner?"\"B\"":"\"A\"")<<",\"reason\":\""<<(reason=="cleared"?"clearance":reason=="blocked"?"blockade":"timeout")<<"\"},\"candidates\":[],\"recommended\":null,\"depth\":0,\"nodes\":0}\n";
     else cout<<"game over\n";}
 }
}
#endif
