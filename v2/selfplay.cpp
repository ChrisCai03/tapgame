// Reuse the v1 legal-move generator and search for two generations of training opponents.
#define main archived_main
#include "../src/tap.cpp"
#undef main
int main(int argc,char**argv){
 if(argc!=6)throw runtime_error("selfplay values games seed depth exploration_percent");
 initialize();ifstream weights(argv[1]);for(auto& b:graph)if(!(weights>>b.value))throw runtime_error("bad scores");
 int count=stoi(argv[2]),depth=stoi(argv[4]),explore=stoi(argv[5]);unsigned start=stoul(argv[3]);
 array<array<int,4>,N> stats{}; // Training visits, score sum, held-out visits, score sum.
 for(int g=0;g<count;g++){
   Player p(start+g);int s=opening,t=0,quiet=0,winner=-1;vector<pair<int,int>> path;
   for(;;){
     p.seen[key(s,t)]=1;if(! (s%H)){winner=1-t;break;}
     if(quiet==QUIET_LIMIT)break;
     auto ids=p.options(s,t);if(ids.empty()){winner=1-t;break;}
     path.push_back({s,t});shuffle(ids.begin(),ids.end(),p.rng);
     int i=uniform_int_distribution<int>(0,99)(p.rng)<explore?p.randomChoice(ids):p.engine(s,t,ids,quiet,depth,1000);
     auto m=graph[s].moves[i];quiet=m.drop?0:quiet+1;s=m.next;t^=1;
   }
   int bucket=((start+g)%10==0)?2:0;
   for(auto [position,side]:path){auto& a=stats[position];a[bucket]++;a[bucket+1]+=(winner<0?0:side==winner?1:-1);}
 }
 for(auto a:stats)cout<<a[0]<<" "<<a[1]<<" "<<a[2]<<" "<<a[3]<<"\n";
}
