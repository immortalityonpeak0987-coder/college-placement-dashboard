"""Step 1: clean raw placement data (drop junk header rows, normalise text, remove duplicates, package -> LPA)."""
from pathlib import Path
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
RAW, OUT = ROOT / 'data/raw', ROOT / 'data/processed'
K = ['name of company', 'college name', 'region', 'year']

def norm_text(s):
    return s.astype(str).str.replace(r'\s+', ' ', regex=True).str.strip().str.upper()

def to_lpa(s):
    """'₹657,673/yr' -> 6.58 ; '/mo' -> x12 ; anything else (hourly, other currency) -> NaN"""
    s = s.astype(str)
    num = pd.to_numeric(s.str.replace(r'[^\d.]', '', regex=True), errors='coerce')
    annual = num.where(s.str.contains('/yr'), num.where(s.str.contains('/mo')) * 12)
    annual = annual.where(s.str.startswith('₹'))
    return (annual / 1e5).round(2)

pc = pd.read_csv(RAW / 'placement_companies.csv').drop(columns='Unnamed: 0')
v3 = pd.read_csv(RAW / 'variation_3.csv')
for d in (pc, v3):
    for c in K[:3]:
        d[c] = norm_text(d[c])
    d['year'] = d['year'].astype('int64')

n0 = len(pc)
pc = pc[pc['name of company'] != 'NAME OF COMPANY']          # header row leaked into data
n_hdr = n0 - len(pc)
pc = pc.drop_duplicates(K).reset_index(drop=True)
print(f'rows {n0} -> {len(pc)} (header junk {n_hdr}, duplicates {n0 - n_hdr - len(pc)})')

v3['package_lpa'] = to_lpa(v3['salary'])
df = pc.merge(v3.drop_duplicates(K)[K + ['package_lpa']], on=K, how='left', validate='1:1')
df.to_csv(OUT / 'placements_clean.csv', index=False)
print('saved', df.shape, '| package non-null:', df.package_lpa.notna().sum())
