import argparse,subprocess
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import numpy as np
p=argparse.ArgumentParser()
for name in ('exe','model','out'):p.add_argument(name,type=Path)
for name in ('games','seed','depth','explore'):p.add_argument(name,type=int)
a=p.parse_args()
def run(offset):
    cmd=[str(a.exe.resolve()),a.model,str(min(2000,a.games-offset)),str(a.seed+offset),str(a.depth),str(a.explore)]
    data=subprocess.check_output(cmd)
    return np.fromstring(data.decode(),sep=' ',dtype=np.int64).reshape(48400,4)
total=np.zeros((48400,4),dtype=np.int64)
with ThreadPoolExecutor(max_workers=8) as pool:
    for block in pool.map(run,range(0,a.games,2000)):total+=block
np.save(a.out,total)
print(a.out,total.sum(axis=0),flush=True)
