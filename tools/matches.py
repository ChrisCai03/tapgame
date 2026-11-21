"""Run independent, seat-balanced shards and merge them in game-number order."""
import argparse
import csv
import subprocess
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("engine",type=Path)
    parser.add_argument("model",type=Path)
    parser.add_argument("output",type=Path)
    args=parser.parse_args()
    args.output.mkdir(parents=True,exist_ok=True)
    def shard(job):
        baseline,offset=job
        seed=(3100000 if baseline=="random" else 5200000)+offset
        command=[str(args.engine.resolve()),"match","250",str(seed),baseline,str(args.model)]
        result=subprocess.run(command,check=True,capture_output=True,text=True)
        rows=list(csv.DictReader(result.stdout.splitlines()))
        assert len(rows)==250
        for row in rows:row["game"]=int(row["game"])+offset
        return baseline,rows
    records={"random":[],"heuristic":[]}
    with ThreadPoolExecutor(max_workers=8) as pool:
        for baseline,rows in pool.map(shard,[(b,i) for i in range(0,2000,250) for b in records]):
            records[baseline].extend(rows)
    for baseline,rows in records.items():
        with (args.output/(baseline+".csv")).open("w",newline="") as f:
            w=csv.DictWriter(f,fieldnames=list(rows[0]));w.writeheader();w.writerows(rows)
if __name__=="__main__":main()
