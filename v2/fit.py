"""Fit on aggregated game outcomes with exact modular symmetry augmentation."""
import argparse,itertools,json
from pathlib import Path
import numpy as np
from sklearn.neural_network import MLPRegressor
from sklearn.preprocessing import StandardScaler
p=argparse.ArgumentParser()
p.add_argument('features',type=Path);p.add_argument('output',type=Path);p.add_argument('inputs',nargs='+',type=Path);a=p.parse_args()
f=np.loadtxt(a.features,delimiter=',',skiprows=1)[:,1:]
triples=list(itertools.combinations_with_replacement(range(10),3))
index={t:i for i,t in enumerate(triples)}
n=len(triples)
ids=np.arange(n*n)
maps=[]
for unit in (1,3,7,9):
    perm=np.array([index[tuple(sorted(v*unit%10 for v in t))] for t in triples])
    maps.append(perm[ids//n]*n+perm[ids%n])
raw=sum(np.load(path) for path in a.inputs)
aug=sum(raw[m,:2] for m in maps)
# Relative digit pairs describe the opponent's responses to each tapping value.
cross=np.stack([f[:,x]*f[:,10+y] for x in range(1,10) for y in range(1,10)],axis=1)
features=np.hstack([f,cross])
seen=aug[:,0]>0
weights=np.sqrt(aug[seen,0])
x=StandardScaler().fit(features[seen],sample_weight=weights).transform(features).astype('float32')
y=(aug[seen,1]/aug[seen,0]).astype('float32')
model=MLPRegressor(hidden_layer_sizes=(96,48),random_state=7741,batch_size=256,learning_rate_init=.0015)
for _ in range(42):model.partial_fit(x[seen],y,sample_weight=weights/weights.mean())
prediction=np.clip(model.predict(x),-1,1)
prediction=sum(prediction[m] for m in maps)/4
# Smooth the symmetry-pooled observed outcome toward the learned estimate.
v=(aug[:,1]+80*prediction)/(aug[:,0]+80)
scores=np.rint(550*v+170*f[:,24]+18*(f[:,21]-f[:,20])).astype(int)
a.output.parent.mkdir(parents=True,exist_ok=True);np.savetxt(a.output,scores,fmt='%d')
w,s=raw[:,2],raw[:,3]
brier=float(np.sum(w*(1+v*v)-2*s*v)/(4*w.sum()))
info=dict(train_positions=int(raw[:,0].sum()),heldout_positions=int(w.sum()),board_features=107,augmented_boards=int(seen.sum()),heldout_brier=brier)
a.output.with_suffix('.json').write_text(json.dumps(info,indent=2));print(info,flush=True)
