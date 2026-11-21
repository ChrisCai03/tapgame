// Independent driver for the original v1 decision routine. Read entire games on stdin.
#define main archived_main
#include "../src/tap.cpp"
#undef main
#include <unordered_map>
#include <sstream>
int main(int argc,char** argv){
 if(argc!=2)throw runtime_error("audit_v1 v1-model");
 initialize();ifstream f(argv[1]);for(auto& b:graph)if(!(f>>b.value))throw runtime_error("bad model");
 unordered_map<string,int> book;int decisions=0,games=0;string line;
 while(getline(cin,line)){
   int first;string trace;istringstream row(line);row>>first>>trace;Player p(0);
   int s=opening,t=0,quiet=0;
   for(size_t j=0;j<trace.size();j+=2){
     p.seen[key(s,t)]=1;auto options=p.options(s,t);int selected=-1;
     for(auto i:options){auto m=graph[s].moves[i];if(m.x==trace[j]-'0'&&m.y==trace[j+1]-'0')selected=i;}
     if(selected<0)throw runtime_error("illegal recorded action");
     if(t==first){ // v2 first = 1 means v1 occupies seat 1
       string prefix=trace.substr(0,j);int best;
       if(j<64 && book.count(prefix))best=book.at(prefix);
       else{best=p.engine(s,t,options,quiet,8,4500);if(j<64)book[prefix]=best;}
       if(best!=selected)throw runtime_error("v1 differs from published engine");decisions++;
     }
     auto m=graph[s].moves[selected];quiet=m.drop?0:quiet+1;s=m.next;t^=1;
   }
   games++;
 }
 cout<<"Verified "<<decisions<<" archived v1 decisions in "<<games<<" games.\n";
}
