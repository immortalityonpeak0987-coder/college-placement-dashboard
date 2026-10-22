"""Step 3: apply company-name mapping rules (with explicit RISKY exclusions and manual FIX dictionary) and re-deduplicate."""
from pathlib import Path
from collections import Counter
import csv

ROOT = Path(__file__).resolve().parents[1]
P = ROOT / 'data/processed'
K = ['name of company', 'college name', 'region', 'year']

# Explicit exclusion set: pairs in proposed mapping judged to be distinct companies or business units
RISKY = {
    'TUDIP TECHNOLOGIES', 'TULIP TECHNOLOGIES', 'ORACLE CGBU', 'ORACLE GBU', 'ORACLE (PGBU)',
    'LARSEN & TOUBRO IT', 'INFINITE COMPUTING SYSTEM', 'INFINITY COMPUTING SYSTEM',
    'AG TECHNOLOGIES', 'AGS-TECHNOLOGIES', 'ICERTIES', 'ICERTIS'
}

# Explicit manual corrections where raw frequency favoured a spelling typo as canonical
FIX = {
    'AUFKLREN': 'AUFKLAREN',
    'FLEXRONICS': 'FLEXTRONICS',
    'CAPEGEMINI INDIA': 'CAPGEMINI',
    'SUNGUARD': 'SUNGARD',
    'AMAZON WEB SERVICE': 'AMAZON WEB SERVICES',
    'BENTLEY SYSTEM': 'BENTLEY SYSTEMS',
    'ASPIRING MIND': 'ASPIRING MINDS',
    'THIRDWARE SOLUTION': 'THIRDWARE SOLUTIONS',
    'QSPIDER': 'QSPIDERS',
    'BYJU (THINK&LEARN)': "BYJU'S (THINK & LEARN)"
}

def main():
    with open(P / 'placements_clean.csv', encoding='utf-8', errors='replace') as f:
        clean_rows = list(csv.DictReader(f))
    with open(P / 'company_mapping_proposed.csv', encoding='utf-8', errors='replace') as f:
        proposed_rows = list(csv.DictReader(f))

    m_filtered = [r for r in proposed_rows if r['variant'] not in RISKY and r['canonical'] not in RISKY]

    p = {}  # union-find: collapse chains of variants
    def f(x):
        p.setdefault(x, x)
        while p[x] != x:
            p[x] = p[p[x]]
            x = p[x]
        return x

    for r in m_filtered:
        p[f(r['variant'])] = f(r['canonical'])

    counts = Counter(r['name of company'] for r in clean_rows)
    order_of_appearance = list(dict.fromkeys(r['name of company'] for r in clean_rows))
    cnt_index = sorted(order_of_appearance, key=lambda x: -counts[x])

    groups = {}
    for n in cnt_index:
        groups.setdefault(f(n), []).append(n)

    mapping = {}
    for g in groups.values():
        if len(g) > 1:
            c = max(g, key=lambda x: (counts[x], -len(x)))  # most frequent name wins
            for x in g:
                if x != c:
                    mapping[x] = c

    n_before = len(counts)
    rows0 = len(clean_rows)

    merged_rows = []
    for idx, r in enumerate(clean_rows):
        comp = mapping.get(r['name of company'], r['name of company'])
        comp = FIX.get(comp, comp)
        merged_rows.append((idx, comp, r['college name'], r['region'], r['year'], r['package_lpa']))

    # Sort by package_lpa ascending with empty strings last (preserving original index order for ties), then deduplicate on K
    def pkg_sort_key(item):
        pkg = item[5]
        if pkg == '':
            return (1, 0.0, item[0])
        return (0, float(pkg), item[0])

    sorted_for_dedup = sorted(merged_rows, key=pkg_sort_key)
    seen_k = set()
    deduped = []
    for item in sorted_for_dedup:
        k_tuple = (item[1], item[2], item[3], item[4])
        if k_tuple not in seen_k:
            seen_k.add(k_tuple)
            deduped.append(item)

    deduped.sort(key=lambda x: x[0])
    final_rows = [
        {
            'name of company': x[1],
            'college name': x[2],
            'region': x[3],
            'year': x[4],
            'package_lpa': x[5]
        }
        for x in deduped
    ]

    with open(P / 'placements_final.csv', 'w', newline='', encoding='utf-8') as f_out:
        writer = csv.DictWriter(f_out, fieldnames=K + ['package_lpa'])
        writer.writeheader()
        writer.writerows(final_rows)

    with open(P / 'company_mapping_applied.csv', 'w', newline='', encoding='utf-8') as f_map:
        writer = csv.DictWriter(f_map, fieldnames=['variant', 'canonical'])
        writer.writeheader()
        for var, can in mapping.items():
            writer.writerow({'variant': var, 'canonical': can})

    n_after = len(set(r['name of company'] for r in final_rows))
    pkg_non_null = sum(1 for r in final_rows if r['package_lpa'] != '')
    print(f'names merged: {len(mapping)} | unique companies {n_before} -> {n_after}')
    print(f'rows {rows0} -> {len(final_rows)} | dups 0 | package non-null {pkg_non_null}')

if __name__ == '__main__':
    main()
