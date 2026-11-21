// Called with the exact replay history already applied. Full root windows give
// comparable scores for all candidates, including those outside the playing band.
struct AnalysisRow {
 int edge, score, winner=-1, distance=-1;
 vector<int> pv;
 string end;
};
void printAnalysis(Search& search,int state,int turn,vector<int> ids,int quiet){
 vector<AnalysisRow> complete;
 int depth=0;
 search.epoch++; search.visits=0;
 for(int d=1;d<=search.depth;d++){
   vector<AnalysisRow> rows;
   for(int i:ids){
     auto m=graph[state].moves[i];int k=key(m.next,1-turn);
     vector<int> line;history[k]=1;
     int v=-search.score<true>(m.next,1-turn,d-1,-2*MATE,2*MATE,1,m.drop,m.drop?0:quiet+1,&line);
     history[k]=0;
     if(search.visits>search.limit)break;
     line.insert(line.begin(),10*m.x+m.y);
     rows.push_back({i,v,abs(v)>5000?(v>0?turn:1-turn):-1,-1,line,{}});
   }
   if(rows.size()!=ids.size())break;
   auto move=[&](const auto& r){return r.pv.front();};
   stable_sort(rows.begin(),rows.end(),[&](const auto& a,const auto& b){return a.score!=b.score?a.score>b.score:move(a)<move(b);});
   complete=rows;depth=d;ids.clear();for(const auto& r:rows)ids.push_back(r.edge);
   if(isSingle(state)||all_of(rows.begin(),rows.end(),[](const auto& r){return r.winner>=0;}))break;
 }
 int wanted=nominal[state].sign,budget=4000,pick=-1;
 if(!isSingle(state) && wanted && prove(state,turn,wanted,budget,&pick)){
   for(auto& r:complete)if(wanted<0 || r.edge==pick)r.winner=wanted>0?turn:1-turn;
 }
 auto tier=[&](const auto& r){return r.winner==turn?2:r.winner<0?1:0;};
 stable_sort(complete.begin(),complete.end(),[&](const auto& a,const auto& b){return tier(a)>tier(b);});
 for(auto& r:complete){
   auto seen=history;int s=state,t=turn,q=quiet;bool unique=true,fresh=false;
   auto count=[&](){int n=0;for(int i=0;i<graph[s].count;i++)n+=!seen[key(graph[s].moves[i].next,1-t)];return n;};
   for(int tap:r.pv){
     unique&=count()==1;bool found=false;
     for(int i=0;i<graph[s].count;i++){
       auto m=graph[s].moves[i];if(10*m.x+m.y!=tap || seen[key(m.next,1-t)])continue;
       s=m.next;t=1-t;fresh=m.drop;q=fresh?0:q+1;seen[key(s,t)]=1;found=true;break;
     }
     if(!found)throw runtime_error("illegal analysis variation");
   }
   if(!(s%H))r.end="clearance";
   else if(q>=QUIET_LIMIT)r.end="timeout";
   else if(!count())r.end="blockade";
   else{r.end=fresh && certified[s].sign?"proof frontier":"horizon";unique=false;}
   if(unique)r.distance=int(r.pv.size());
 }
 auto player=[](int t){return t<0?"null":t?"\"B\"":"\"A\"";};
 int winner=-1;
 if(!complete.empty() && complete[0].winner==turn)winner=turn;
 else if(!complete.empty() && all_of(complete.begin(),complete.end(),[&](const auto& r){return r.winner==1-turn;}))winner=1-turn;
 cout<<"{\"terminal\":null,\"turn\":"<<player(turn)<<",\"depth\":"<<depth<<",\"nodes\":"<<min(search.visits,search.limit)
     <<",\"budgetHit\":"<<(search.visits>search.limit?"true":"false")<<",\"proven\":"<<player(winner)
     <<",\"distance\":"<<(complete.empty()||complete.front().distance<0?"null":to_string(complete.front().distance))
     <<",\"recommended\":"<<(complete.empty()?"null":"\""+to_string(complete.front().pv.front())+"\"")<<",\"candidates\":[";
 for(size_t j=0;j<complete.size();j++){
   const auto& r=complete[j];if(j)cout<<',';
   cout<<"{\"move\":\""<<r.pv.front()<<"\",\"score\":"<<r.score<<",\"bound\":\"exact-at-depth\",\"proven\":"<<player(r.winner)
       <<",\"distance\":"<<(r.distance<0?"null":to_string(r.distance))<<",\"end\":\""<<r.end<<"\",\"pv\":[";
   for(size_t k=0;k<r.pv.size();k++){if(k)cout<<',';cout<<'\"'<<r.pv[k]<<'\"';}
   cout<<"]}";
 }
 cout<<"]}\n";
}
