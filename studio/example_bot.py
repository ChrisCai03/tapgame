"""Minimal play-only TGEP/1 plug-in. Select the lexicographically first legal tap."""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))
from verify import options


def choose(position):
    start = position.get("start", dict(a=[1, 1, 1], b=[1, 1, 1], turn="A"))
    board = tuple(tuple(sorted(start[seat])) for seat in ("a", "b"))
    turn = int(start["turn"] == "B")
    seen = {board}
    quiet = 0
    trace = position.get("trace", "")
    if len(trace) % 2:
        raise ValueError("Incomplete tap")
    for i in range(0, len(trace), 2):
        if quiet >= 20000:
            raise ValueError("Trace continues past timeout")
        tap = tuple(map(int, trace[i:i+2]))
        board = options(board, turn, seen)[tap]
        seen.add(board)
        turn ^= 1
        quiet = 0 if sum(tap) == 10 else quiet + 1
    replies = options(board, turn, seen) if quiet < 20000 else {}
    if not replies:
        return {"move": None}
    x, y = min(replies)
    return {"move": f"{x}{y}"}


for line in sys.stdin:
    request_id = None
    try:
        req = json.loads(line)
        request_id = req["id"]
        if req["v"] != 1:
            raise ValueError("Unsupported version")
        if req["cmd"] == "hello":
            result = dict(protocol="TGEP", version=1, engine="First legal",
                          rulesets=["tap10-3-positional-v1"], commands=["hello", "choose"])
        elif req["cmd"] == "choose":
            result = choose(req.get("position", {}))
        else:
            raise ValueError("Unsupported command")
        reply = dict(v=1, id=request_id, ok=True, result=result)
    except (ValueError, KeyError, TypeError) as err:
        reply = dict(v=1, id=request_id, ok=False, error=dict(code="invalid_request", message=str(err)))
    print(json.dumps(reply), flush=True)
