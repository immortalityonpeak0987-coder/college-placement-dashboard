"""Step 1: clean raw placement data (drop junk header rows, normalise text, remove duplicates, package -> LPA)."""
from pathlib import Path
import csv
import re

ROOT = Path(__file__).resolve().parents[1]
RAW, OUT = ROOT / 'data/raw', ROOT / 'data/processed'
K = ['name of company', 'college name', 'region', 'year']

def norm_text(s):
    return re.sub(r'\s+', ' ', str(s)).strip().upper()

def to_lpa_val(s):
    """'₹657,673/yr' -> '6.58' ; '/mo' -> x12 ; anything else (hourly, other currency) -> ''"""
    s = str(s).strip()
    if not s.startswith('₹'):
        return ''
    num_str = re.sub(r'[^\d.]', '', s)
    try:
        num = float(num_str)
    except ValueError:
        return ''
    if '/yr' in s:
        annual = num
    elif '/mo' in s:
        annual = num * 12.0
    else:
        return ''
    return str(round(annual / 1e5, 2))

def main():
    OUT.mkdir(parents=True, exist_ok=True)
    with open(RAW / 'placement_companies.csv', encoding='utf-8', errors='replace') as f:
        pc_raw = list(csv.DictReader(f))
    with open(RAW / 'variation_3.csv', encoding='utf-8', errors='replace') as f:
        v3_raw = list(csv.DictReader(f))

    v3_lookup = {}
    for r in v3_raw:
        key = (
            norm_text(r['name of company']),
            norm_text(r['college name']),
            norm_text(r['region']),
            int(float(r['year']))
        )
        if key not in v3_lookup:
            v3_lookup[key] = to_lpa_val(r['salary'])

    n0 = len(pc_raw)
    pc_no_hdr = []
    for r in pc_raw:
        comp = norm_text(r['name of company'])
        if comp != 'NAME OF COMPANY':
            pc_no_hdr.append((
                comp,
                norm_text(r['college name']),
                norm_text(r['region']),
                int(float(r['year']))
            ))
    n_hdr = n0 - len(pc_no_hdr)

    seen = set()
    clean_rows = []
    for k in pc_no_hdr:
        if k not in seen:
            seen.add(k)
            clean_rows.append({
                'name of company': k[0],
                'college name': k[1],
                'region': k[2],
                'year': str(k[3]),
                'package_lpa': v3_lookup.get(k, '')
            })

    print(f'rows {n0} -> {len(clean_rows)} (header junk {n_hdr}, duplicates {n0 - n_hdr - len(clean_rows)})')

    out_path = OUT / 'placements_clean.csv'
    with open(out_path, 'w', newline='', encoding='utf-8') as f:
        writer = csv.DictWriter(f, fieldnames=K + ['package_lpa'])
        writer.writeheader()
        writer.writerows(clean_rows)

    pkg_non_null = sum(1 for r in clean_rows if r['package_lpa'] != '')
    print(f'saved ({len(clean_rows)}, 5) | package non-null: {pkg_non_null}')

if __name__ == '__main__':
    main()
