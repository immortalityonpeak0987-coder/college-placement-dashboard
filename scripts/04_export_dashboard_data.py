"""Step 4: compute dashboard numbers from the final dataset and write assets/data.js for the website."""
from pathlib import Path
import json
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
raw = pd.read_csv(ROOT / 'data/raw/placement_companies.csv')
clean = pd.read_csv(ROOT / 'data/processed/placements_clean.csv')
d = pd.read_csv(ROOT / 'data/processed/placements_final.csv')
p = d.dropna(subset=['package_lpa'])

def nice(s):
    return s.title().replace('Tcs', 'TCS').replace('Zs ', 'ZS ')

reg = p.groupby('region').package_lpa.agg(n='count', avg='mean', median='median').round(2).sort_values('avg', ascending=False)
co = (d.groupby('name of company').agg(records=('year', 'size'), colleges=('college name', 'nunique'))
        .sort_values(['records', 'colleges'], ascending=False).head(10))
yr = d.groupby('year').agg(placements=('year', 'size'), colleges=('college name', 'nunique'))

data = {
  'kpis': {'records': len(d), 'companies': int(d['name of company'].nunique()),
           'colleges': int(d['college name'].nunique()), 'packages': len(p)},
  'pipeline': {'raw': len(raw), 'clean': len(clean), 'final': len(d)},
  'regions': [{'name': nice(i), 'avg': float(r.avg), 'median': float(r['median']), 'n': int(r.n)} for i, r in reg.iterrows()],
  'companies': [{'name': nice(i), 'records': int(r.records), 'colleges': int(r.colleges)} for i, r in co.iterrows()],
  'years': [{'year': int(i), 'placements': int(r.placements), 'colleges': int(r.colleges)} for i, r in yr.iterrows()],
}
(ROOT / 'assets/data.js').write_text('window.DASHBOARD_DATA = ' + json.dumps(data, indent=1) + ';\n')
print(json.dumps(data['kpis']), json.dumps(data['pipeline']))
