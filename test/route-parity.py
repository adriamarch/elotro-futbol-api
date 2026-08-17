#!/usr/bin/env python3
import re
from pathlib import Path

root=Path(__file__).resolve().parents[2]
main=(root/'worker/src/index.js').read_text()
sec=(root/'worker-secondary/src/index.js').read_text()
pat=re.compile(r'url\.pathname\.match\(/\\\^?\\/?api/([^/\\$\\(]+)')
# Robust fallback: collect literal /api paths appearing in route comparisons/regexes.
def routes(s):
    found=set()
    for m in re.finditer(r"['\"](/api/[^'\"]+)['\"]",s):
        x=m.group(1)
        x=re.sub(r'\\\\d\\+','{id}',x)
        if x.startswith('/api/'):
            found.add(x)
    return found
A=routes(main); B=routes(sec)
print(f'main literal routes: {len(A)}')
print(f'secondary literal routes: {len(B)}')
missing=sorted(A-B)
extra=sorted(B-A)
if missing:
    print('Missing in secondary:')
    print('\n'.join(missing))
if extra:
    print('Secondary-only:')
    print('\n'.join(extra))
if missing:
    raise SystemExit(1)
print('Route parity static check: OK')
