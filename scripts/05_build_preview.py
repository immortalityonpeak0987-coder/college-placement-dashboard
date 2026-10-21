"""Step 5 (optional): static PNG preview of the three charts for the README."""
from pathlib import Path
import pandas as pd
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

ROOT = Path(__file__).resolve().parents[1]
d = pd.read_csv(ROOT / 'data/processed/placements_final.csv')
p = d.dropna(subset=['package_lpa'])
BLUE, ORANGE, GREY = '#2E6FD8', '#F28E2B', '#B8BEC9'
plt.rcParams.update({'axes.spines.top': False, 'axes.spines.right': False})

reg = p.groupby('region').package_lpa.agg(n='count', avg='mean', median='median').sort_values('avg')
co = (d.groupby('name of company').agg(records=('year', 'size'), colleges=('college name', 'nunique'))
        .sort_values(['records', 'colleges'], ascending=False).head(10).iloc[::-1])
yr = d.groupby('year').agg(placements=('year', 'size'), colleges=('college name', 'nunique'))
fix = lambda s: s.str.title().str.replace('Tcs', 'TCS').str.replace('Zs ', 'ZS ')

fig = plt.figure(figsize=(16, 10))
gs = fig.add_gridspec(2, 2, height_ratios=[1, .85], hspace=.42, wspace=.28)
a1 = fig.add_subplot(gs[0, 0])
a1.barh(fix(reg.index.to_series()), reg['avg'], color=BLUE, height=.55, label='Average')
a1.scatter(reg['median'], fix(reg.index.to_series()), color=ORANGE, s=110, zorder=3, label='Median (typical)')
a1.set_title('Average package by region (LPA)', loc='left', fontweight='bold'); a1.legend(frameon=False)
a2 = fig.add_subplot(gs[0, 1])
a2.barh(fix(co.index.to_series()), co['records'], color=BLUE)
a2.set_title('Most frequently recurring companies', loc='left', fontweight='bold')
a3 = fig.add_subplot(gs[1, :])
a3.bar([f'{y}\n({c} colleges in data)' for y, c in zip(yr.index, yr.colleges)], yr.placements, color=GREY, width=.55)
a3.set_title('Placements per year (growth mostly reflects more colleges reporting)', loc='left', fontweight='bold')
fig.savefig(ROOT / 'docs/dashboard-preview.png', dpi=110, bbox_inches='tight', facecolor='white')
print('saved')
