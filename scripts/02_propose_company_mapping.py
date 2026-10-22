"""Step 2: propose merges for inconsistent company names (generated proposals for Tier-1 formatting and Tier-2 fuzzy matches)."""
from pathlib import Path
from collections import Counter
import csv
import difflib
import re

ROOT = Path(__file__).resolve().parents[1]
SUF = r'\b(PVT|PRIVATE|LTD|LIMITED|LLP|INC|CORP|CORPORATION|CO)\b'

def key(s):
    return re.sub(r'[^A-Z0-9]', '', re.sub(SUF, '', re.sub(r'[^A-Z0-9 ]', ' ', s.upper())))

def main():
    clean_path = ROOT / 'data/processed/placements_clean.csv'
    with open(clean_path, encoding='utf-8', errors='replace') as f:
        clean_rows = list(csv.DictReader(f))

    counts = Counter(r['name of company'] for r in clean_rows)
    order_of_appearance = list(dict.fromkeys(r['name of company'] for r in clean_rows))
    cnt_index = sorted(order_of_appearance, key=lambda x: -counts[x])

    g = {}
    for n in cnt_index:
        g.setdefault(key(n), []).append(n)

    t1 = {k: v for k, v in g.items() if len(v) > 1}  # tier 1: formatting-only differences
    keys, pairs = sorted(g), []
    for i, a in enumerate(keys):                      # tier 2: typo-like pairs (SequenceMatcher >= 0.92)
        for b in keys[i + 1:]:
            if abs(len(a) - len(b)) <= 2 and a[:2] == b[:2] and len(a) >= 6:
                if difflib.SequenceMatcher(None, a, b).ratio() >= 0.92:
                    pairs.append((g[a][0], g[b][0]))

    rows = []
    for v in t1.values():
        c = max(v, key=lambda x: counts[x])
        rows += [{'variant': x, 'canonical': c, 'tier': 'tier1'} for x in v if x != c]
    rows += [{'variant': b, 'canonical': a, 'tier': 'tier2-review'} for a, b in pairs]

    out_path = ROOT / 'data/processed/company_mapping_proposed.csv'
    with open(out_path, 'w', newline='', encoding='utf-8') as f:
        writer = csv.DictWriter(f, fieldnames=['variant', 'canonical', 'tier'])
        writer.writeheader()
        writer.writerows(rows)

    print(f'tier1 groups: {len(t1)} | tier2 pairs: {len(pairs)} | rows: {len(rows)}')

if __name__ == '__main__':
    main()
