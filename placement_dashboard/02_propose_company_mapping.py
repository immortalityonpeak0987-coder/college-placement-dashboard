"""Step 2: propose merges for inconsistent company names (for human review)."""
from pathlib import Path
import difflib, re
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
df = pd.read_csv(ROOT / 'data/processed/placements_clean.csv')
SUF = r'\b(PVT|PRIVATE|LTD|LIMITED|LLP|INC|CORP|CORPORATION|CO)\b'
def key(s): return re.sub(r'[^A-Z0-9]', '', re.sub(SUF, '', re.sub(r'[^A-Z0-9 ]', ' ', s.upper())))

cnt = df['name of company'].value_counts()
g = {}
for n in cnt.index.tolist(): g.setdefault(key(n), []).append(n)
t1 = {k: v for k, v in g.items() if len(v) > 1}            # tier 1: formatting-only differences
keys, pairs = sorted(g), []
for i, a in enumerate(keys):                                 # tier 2: typo-like pairs (needs review)
    for b in keys[i + 1:]:
        if abs(len(a) - len(b)) <= 2 and a[:2] == b[:2] and len(a) >= 6:
            if difflib.SequenceMatcher(None, a, b).ratio() >= .92:
                pairs.append((g[a][0], g[b][0]))
rows = []
for v in t1.values():
    c = max(v, key=lambda x: cnt[x]); rows += [(x, c, 'tier1') for x in v if x != c]
rows += [(b, a, 'tier2-review') for a, b in pairs]
pd.DataFrame(rows, columns=['variant', 'canonical', 'tier']).to_csv(ROOT / 'data/processed/company_mapping_proposed.csv', index=False)
print('tier1 groups:', len(t1), '| tier2 pairs:', len(pairs), '| rows:', len(rows))
