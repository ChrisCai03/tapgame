"""Fit decisive outcomes on games 0–41999, calibrate on 42000–50999, test on 51000–59999."""
import json, sys
from pathlib import Path
import numpy as np
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.linear_model import LogisticRegression
d = np.loadtxt(sys.argv[1], delimiter=',')
assert len(d) == 60000 and np.array_equal(d[:, 0], np.arange(len(d)))
x, y = d[:,1:-1], d[:,-1]
train, cal, test = (d[:,0]<42000), ((d[:,0]>=42000)&(d[:,0]<51000)), d[:,0]>=51000
decisive = y != 0
model = HistGradientBoostingClassifier(max_iter=100, max_leaf_nodes=15, learning_rate=.09,
    l2_regularization=2, early_stopping=False, random_state=9027)
model.fit(x[train & decisive], y[train & decisive]>0)
scale = LogisticRegression(C=1e3).fit(model.decision_function(x[cal & decisive])[:,None], y[cal & decisive]>0)
# Standalone, interpreter-independent export. Training features are always finite.
trees = []
for layer in model._predictors:
    trees.append([[-1,float(n['value'])] if n['is_leaf'] else
                  [int(n['feature_idx']),float(n['num_threshold']),int(n['left']),int(n['right'])]
                  for n in layer[0].nodes])
# A pooled Jeffreys-smoothed draw frequency; no position-specific draw calibration is claimed.
draw = (int((y[train]==0).sum())+.5)/(train.sum()+1)
p = scale.predict_proba(model.decision_function(x[test])[:,None])[:,1]*(1-draw)
ps = np.column_stack((p,np.repeat(draw,test.sum()),1-draw-p))
observed = (y[test,None] == np.array([1,0,-1]))
base_rate = np.array([(y[train]==val).mean() for val in [1,0,-1]])
bins=[]
for lo in np.arange(0,1,.1):
    subset=(p>=lo)&(p<lo+.1)
    if subset.any(): bins.append(dict(n=int(subset.sum()),pred=round(float(p[subset].mean()),5),actual=round(float(observed[subset,0].mean()),5)))
metadata=dict(policy='Guided 15% vs Guided 15%',sample='One uniformly sampled pre-move position per complete game from the standard opening.',
    training=int(train.sum()),calibration=int(cal.sum()),test=int(test.sum()),draws=int((y==0).sum()),
    testBrier=float(np.mean(np.sum((ps-observed)**2,axis=1))),constantBrier=float(np.mean(np.sum((base_rate-observed)**2,axis=1))),
    bins=bins, trainingDraws=int((y[train]==0).sum()))
obj=dict(base=float(model._baseline_prediction.item()),slope=float(scale.coef_.item()),intercept=float(scale.intercept_.item()),draw=float(draw),trees=trees,metadata=metadata)
dest=Path(__file__).resolve().parents[1]/'dist/studio/assets/wdl.json'
dest.write_text(json.dumps(obj,separators=(',',':'))+'\n')
print(json.dumps(metadata))
