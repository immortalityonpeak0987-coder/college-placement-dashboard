"""Step 3: apply the reviewed company-name mapping and re-deduplicate."""
from pathlib import Path
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
P = ROOT / 'data/processed'
df = pd.read_csv(P / 'placements_clean.csv')
m = pd.read_csv(P / 'company_mapping_proposed.csv')

# Pairs reviewed manually and judged to be DIFFERENT companies/divisions -> not merged
RISKY = {'TUDIP TECHNOLOGIES', 'TULIP TECHNOLOGIES', 'ORACLE CGBU', 'ORACLE GBU', 'ORACLE (PGBU)',
         'LARSEN & TOUBRO IT', 'INFINITE COMPUTING SYSTEM', 'INFINITY COMPUTING SYSTEM',
         'AG TECHNOLOGIES', 'AGS-TECHNOLOGIES', 'ICERTIES', 'ICERTIS'}
m = m[~(m.variant.isin(RISKY) | m.canonical.isin(RISKY))]

p = {}                                                       # union-find: collapse chains of variants
def f(x):
    p.setdefault(x, x)
    while p[x] != x:
        p[x] = p[p[x]]; x = p[x]
    return x
for a, b in zip(m.variant, m.canonical): p[f(a)] = f(b)

cnt = df['name of company'].value_counts()
groups = {}
for n in cnt.index: groups.setdefault(f(n), []).append(n)
mapping = {}
for g in groups.values():
    if len(g) > 1:
        c = max(g, key=lambda x: (cnt[x], -len(x)))          # most frequent name wins
        mapping.update({x: c for x in g if x != c})

# frequency picked a typo as canonical in a few groups -> corrected by hand
FIX = {'AUFKLREN': 'AUFKLAREN', 'FLEXRONICS': 'FLEXTRONICS', 'CAPEGEMINI INDIA': 'CAPGEMINI', 'SUNGUARD': 'SUNGARD',
       'AMAZON WEB SERVICE': 'AMAZON WEB SERVICES', 'BENTLEY SYSTEM': 'BENTLEY SYSTEMS', 'ASPIRING MIND': 'ASPIRING MINDS',
       'THIRDWARE SOLUTION': 'THIRDWARE SOLUTIONS', 'QSPIDER': 'QSPIDERS', 'BYJU (THINK&LEARN)': "BYJU'S (THINK & LEARN)"}
n_before, rows0 = df['name of company'].nunique(), len(df)
df['name of company'] = df['name of company'].replace(mapping).replace(FIX)

K = ['name of company', 'college name', 'region', 'year']
df = (df.sort_values('package_lpa', na_position='last').drop_duplicates(K).sort_index().reset_index(drop=True))
df.to_csv(P / 'placements_final.csv', index=False)
pd.Series(mapping, name='canonical').rename_axis('variant').to_csv(P / 'company_mapping_applied.csv')
print('names merged:', len(mapping), '| unique companies', n_before, '->', df['name of company'].nunique())
print('rows', rows0, '->', len(df), '| dups', df.duplicated(K).sum(), '| package non-null', df.package_lpa.notna().sum())
