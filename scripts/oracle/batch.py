"""Run the oracle over a JSON array of cases (keeps oracle.py untouched).
Big integers (microShares) are emitted as strings so JavaScript can read them exactly."""
import json
import sys

sys.path.insert(0, __file__.rsplit('/', 1)[0])
import oracle  # noqa: E402


def stringify_big(out):
    if isinstance(out, dict) and isinstance(out.get('investors'), dict):
        for v in out['investors'].values():
            if isinstance(v, dict) and 'microShares' in v:
                v['microShares'] = str(v['microShares'])
    return out


cases = json.load(open(sys.argv[1]))
print(json.dumps([stringify_big(oracle.run(c)) for c in cases], sort_keys=True))
