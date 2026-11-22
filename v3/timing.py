"""Measure native CPU cost on the same archived positions (Linux or macOS)."""
import argparse
import csv
import resource
import statistics
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def child_cpu():
    usage = resource.getrusage(resource.RUSAGE_CHILDREN)
    return usage.ru_utime + usage.ru_stime


def run(executable, depth, requests):
    before = child_cpu()
    command = [executable, 'choose', 'model/values.txt', 'v2/values.txt',
               '500000', '12', str(depth)]
    result = subprocess.run(command, input=''.join(requests), text=True,
                            stdout=subprocess.PIPE, check=True, cwd=ROOT)
    if len(result.stdout.splitlines()) != len(requests):
        raise ValueError('Engine did not answer every request.')
    return child_cpu() - before


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('v2', type=Path)
    parser.add_argument('v3', type=Path)
    args = parser.parse_args()
    with (ROOT / 'dist/data/league/v2-v1.csv').open() as f:
        games = list(csv.DictReader(f))
    requests = []
    for i in range(384):
        row = games[(71*i+17) % len(games)]
        ply = int(row['taps']) * ((137*i) % 991) // 991
        trace = row['trace'][:2*ply] or '-'
        requests.append(f"17 {trace} {row['start']}\n")
    for name, exe, depth in [('V2', args.v2, 18), ('V3', args.v3, 32)]:
        exe = exe.resolve()
        startup = statistics.median(run(exe, depth, []) for _ in range(3))
        batches = [run(exe, depth, requests)-startup for _ in range(3)]
        print(f'{name}: {1000*statistics.median(batches)/len(requests):.2f} CPU ms per move')
