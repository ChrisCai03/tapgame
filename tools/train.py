"""Fit a compact self-play value model and export a lookup table for match play."""
import argparse
import json
from pathlib import Path
import numpy as np
from sklearn.neural_network import MLPRegressor
from sklearn.preprocessing import StandardScaler

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("features",type=Path)
    parser.add_argument("examples",type=Path)
    parser.add_argument("out",type=Path)
    args=parser.parse_args()
    raw=np.loadtxt(args.features,delimiter=",",skiprows=1)
    assert np.array_equal(raw[:,0],np.arange(48400))
    features=raw[:,1:]
    games,states,labels=np.loadtxt(args.examples,delimiter=",",skiprows=1,dtype=np.int32).T
    split=int((games.max()+1)*0.9)
    test=games>=split
    train_idx=np.flatnonzero(~test)
    scale=StandardScaler().fit(features[states[train_idx]])
    x=scale.transform(features).astype(np.float32)
    model=MLPRegressor(hidden_layer_sizes=(48,24),random_state=20261122,batch_size=512,
                       learning_rate_init=0.002,shuffle=True,max_iter=1)
    rng=np.random.default_rng(3201)
    for _ in range(8):
        idx=rng.permutation(train_idx)
        model.partial_fit(x[states[idx]],labels[idx].astype(np.float32))
    prediction=np.clip(model.predict(x),-1,1)
    scores=np.rint(380*prediction+180*features[:,24]+25*(features[:,21]-features[:,20])).astype(int)
    args.out.mkdir(parents=True,exist_ok=True)
    np.savetxt(args.out/'values.txt',scores,fmt='%d')
    info=dict(training_games=int(split),validation_games=int(games.max()+1-split),
              train_positions=int(len(train_idx)),validation_positions=int(test.sum()),
              validation_brier=float(np.mean(((prediction[states[test]]-labels[test])/2)**2)),
              epochs=8)
    (args.out/'training.json').write_text(json.dumps(info,indent=2))
    print(info)
if __name__=='__main__':main()
