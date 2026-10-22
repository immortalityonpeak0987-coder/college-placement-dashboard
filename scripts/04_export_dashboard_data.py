"""Step 4: compute dashboard numbers and reproducible data-quality audit metrics from the source files and write assets/data.js."""
from pathlib import Path
import csv
import importlib.util
import json
import re
import statistics

ROOT = Path(__file__).resolve().parents[1]

# Dynamically import RISKY and FIX rules from Step 3 script so audit counts are never hardcoded
spec = importlib.util.spec_from_file_location('merge_step', ROOT / 'scripts/03_merge_company_names.py')
merge_step = importlib.util.module_from_spec(spec)
spec.loader.exec_module(merge_step)
RISKY_SET = getattr(merge_step, 'RISKY', set())
FIX_DICT = getattr(merge_step, 'FIX', {})

def read_csv_with_schema(path):
    with open(path, encoding='utf-8', errors='replace') as f:
        reader = csv.DictReader(f)
        headers = [h if h != '' else 'Unnamed: 0' for h in (reader.fieldnames or [])]
        rows = list(reader)
    return headers, rows

def norm_text(s):
    return re.sub(r'\s+', ' ', str(s)).strip().upper()

def num_digits(s):
    return re.sub(r'[^\d.]', '', str(s))

def nice(s):
    return (
        s.title()
        .replace('Tcs', 'TCS')
        .replace('Zs ', 'ZS ')
        .replace('Ibm', 'IBM')
        .replace('L&T', 'L&T')
        .replace('Lti', 'LTI')
        .replace('Hp', 'HP')
        .replace('Hsbc', 'HSBC')
        .replace('Bnp ', 'BNP ')
        .replace('Gep', 'GEP')
        .replace('Ge ', 'GE ')
        .replace('Atos', 'Atos')
        .replace('Wns', 'WNS')
    )

def main():
    _, raw_pc = read_csv_with_schema(ROOT / 'data/raw/placement_companies.csv')
    _, clean_rows = read_csv_with_schema(ROOT / 'data/processed/placements_clean.csv')
    _, final_rows = read_csv_with_schema(ROOT / 'data/processed/placements_final.csv')
    _, proposed_map = read_csv_with_schema(ROOT / 'data/processed/company_mapping_proposed.csv')
    _, applied_map = read_csv_with_schema(ROOT / 'data/processed/company_mapping_applied.csv')

    # Dynamically audit all 7 raw CSV files
    _, v3_rows = read_csv_with_schema(ROOT / 'data/raw/variation_3.csv')
    _, dd_rows = read_csv_with_schema(ROOT / 'data/raw/detailed_data.csv')
    _, v2_rows = read_csv_with_schema(ROOT / 'data/raw/variation_2.csv')

    # Compute exact discrepancy between detailed_data.csv and variation_3.csv
    v3_key_salary = {}
    for r in v3_rows:
        k = (norm_text(r['name of company']), norm_text(r['college name']), norm_text(r['region']), int(float(r['year'])))
        if k not in v3_key_salary:
            v3_key_salary[k] = num_digits(r['salary'])

    dd_key_salary = {}
    dd_raw_disagreements = 0
    for r in dd_rows:
        k = (norm_text(r['name of company']), norm_text(r['college name']), norm_text(r['region']), int(float(r['year'])))
        sal = num_digits(r['Salary'])
        if k not in dd_key_salary:
            dd_key_salary[k] = sal
        if v3_key_salary.get(k) != sal:
            dd_raw_disagreements += 1

    dd_unique_key_disagreements = sum(1 for k, sal in dd_key_salary.items() if v3_key_salary.get(k) != sal)

    # Audit variation_2.csv non-INR or hourly entries
    v2_non_inr_or_hourly = [
        f"{r['name of company'].strip()} ({r['salary'].strip()})"
        for r in v2_rows
        if not r['salary'].strip().startswith('₹') or '/hr' in r['salary']
    ]

    # Audit header junk and duplicate counts from actual files
    hdr_junk = sum(1 for r in raw_pc if norm_text(r['name of company']) == 'NAME OF COMPANY')
    exact_dups_removed = len(raw_pc) - hdr_junk - len(clean_rows)
    post_merge_dups_removed = len(clean_rows) - len(final_rows)

    clean_unique_companies = len(set(r['name of company'].strip() for r in clean_rows if r['name of company'].strip()))
    final_unique_companies = len(set(r['name of company'].strip() for r in final_rows if r['name of company'].strip()))

    # Audit proposed vs excluded vs applied mappings
    tier1_proposed = sum(1 for r in proposed_map if r.get('tier') == 'tier1')
    tier2_proposed = sum(1 for r in proposed_map if r.get('tier') == 'tier2-review')
    excluded_proposed_rows = [
        r for r in proposed_map if r['variant'] in RISKY_SET or r['canonical'] in RISKY_SET
    ]

    # Valid package rows in final dataset
    pkg_rows = [r for r in final_rows if r['package_lpa'].strip() != '']

    # Regions summary
    regions_map = {}
    for r in pkg_rows:
        reg = r['region'].strip()
        regions_map.setdefault(reg, []).append(float(r['package_lpa']))

    regions_summary = []
    for reg, vals in regions_map.items():
        regions_summary.append({
            'name': nice(reg),
            'rawName': reg,
            'avg': round(statistics.mean(vals), 2),
            'median': round(statistics.median(vals), 2),
            'min': round(min(vals), 2),
            'max': round(max(vals), 2),
            'n': len(vals)
        })
    regions_summary.sort(key=lambda x: x['avg'], reverse=True)

    # Companies summary (top 10)
    comp_stats = {}
    for r in final_rows:
        c = r['name of company'].strip()
        entry = comp_stats.setdefault(c, {'records': 0, 'colleges': set()})
        entry['records'] += 1
        entry['colleges'].add(r['college name'].strip())

    top_companies = sorted(
        [{'name': nice(c), 'rawName': c, 'records': v['records'], 'colleges': len(v['colleges'])} for c, v in comp_stats.items()],
        key=lambda x: (x['records'], x['colleges']),
        reverse=True
    )[:10]

    # Years summary
    yr_stats = {}
    for r in final_rows:
        y = int(r['year'])
        entry = yr_stats.setdefault(y, {'placements': 0, 'colleges': set()})
        entry['placements'] += 1
        entry['colleges'].add(r['college name'].strip())

    years_summary = [
        {'year': y, 'placements': yr_stats[y]['placements'], 'colleges': len(yr_stats[y]['colleges'])}
        for y in sorted(yr_stats.keys())
    ]

    # Compact canonical records for full interactive filtering
    colleges_list = sorted(set(r['college name'].strip() for r in final_rows if r['college name'].strip()))
    regions_list = sorted(set(r['region'].strip() for r in final_rows if r['region'].strip()))
    col_idx = {c: i for i, c in enumerate(colleges_list)}
    reg_idx = {r: i for i, r in enumerate(regions_list)}

    compact_rows = []
    for r in final_rows:
        c_name = r['name of company'].strip()
        c_col = col_idx[r['college name'].strip()]
        c_reg = reg_idx[r['region'].strip()]
        c_yr = int(r['year'])
        c_pkg = round(float(r['package_lpa']), 2) if r['package_lpa'].strip() else None
        compact_rows.append([c_name, c_col, c_reg, c_yr, c_pkg])

    # Build dynamic raw files audit inventory
    raw_file_specs = [
        ('placement_companies.csv', 'Primary Master Source', f'Master placement/recruiter list. Computed audit: {hdr_junk} leaked header rows ("NAME OF COMPANY") and {exact_dups_removed} exact duplicate rows removed in Step 1.'),
        ('variation_3.csv', 'Primary Package Source', f'Selected for salary join because values include explicit currency and unit suffixes (₹/yr and ₹/mo); yields {len(pkg_rows)} matched package records.'),
        ('variation_1.csv', 'Audited / Redundant', 'Upper-cased duplicate of placement_companies.csv without index column.'),
        ('region_mumbai.csv', 'Audited Subset', 'Regional subset covering Mumbai, Navi Mumbai, and Thane.'),
        ('region_pune.csv', 'Audited Subset', 'Partial Pune subset (master file contains more Pune rows).'),
        ('detailed_data.csv', 'Excluded (Discrepancy)', f'Unitless numeric Salary column; disagrees with variation_3.csv on {dd_unique_key_disagreements} deduplicated keys ({dd_raw_disagreements} raw rows) due to row-shift misalignment.'),
        ('variation_2.csv', 'Excluded (No Keys)', f'Company-to-salary lookup lacking college and year keys; contains {len(v2_non_inr_or_hourly)} non-INR/hourly entries ({", ".join(v2_non_inr_or_hourly)}).')
    ]

    raw_files_info = []
    for fname, disposition, note in raw_file_specs:
        hdrs, r_list = read_csv_with_schema(ROOT / 'data/raw' / fname)
        raw_files_info.append({
            'file': fname,
            'rows': len(r_list),
            'columns': ', '.join(hdrs),
            'status': disposition,
            'note': note
        })

    # Build reproducible examples from actual mapping files & rules
    applied_by_canonical = {}
    for r in applied_map:
        applied_by_canonical.setdefault(r['canonical'], []).append(r['variant'])

    sample_merges = []
    for can_target, rule_type, desc in [
        ('L&T INFOTECH', 'Generated Proposal (Tier-1 & Tier-2)', 'Consolidated punctuation and corporate suffix variants across campus drives.'),
        ('CAPGEMINI', 'Generated Proposal + FIX Dictionary', 'Merged spelling variants and corrected high-frequency typo (CAPEGEMINI INDIA -> CAPGEMINI).'),
        ('TATA CONSULTANCY SERVICES', 'Generated Proposal (Tier-1 Suffix)', 'Normalized corporate suffix while keeping distinct from specialized tracks.'),
        ("BYJU'S (THINK & LEARN)", 'Manual FIX Dictionary Rule', 'Standardized punctuation and spacing via explicit FIX dictionary in 03_merge_company_names.py.'),
        ('AMAZON WEB SERVICES', 'Manual FIX Dictionary Rule', 'Corrected singular typo (AMAZON WEB SERVICE) via explicit FIX dictionary.')
    ]:
        variants = applied_by_canonical.get(can_target, [])
        for k_fix, v_fix in FIX_DICT.items():
            if v_fix == can_target and k_fix not in variants:
                variants.append(k_fix)
        if variants:
            sample_merges.append({
                'variant': ' / '.join(sorted(variants)[:4]),
                'canonical': can_target,
                'type': rule_type,
                'reason': desc
            })

    # Include explicit RISKY exclusion pairs computed from proposed_map
    for r in excluded_proposed_rows:
        sample_merges.append({
            'variant': f"{r['variant']} vs {r['canonical']}",
            'canonical': 'EXCLUDED (Kept Separate)',
            'type': f"Explicit RISKY Exclusion ({r['tier']})",
            'reason': 'Filtered out by RISKY set in 03_merge_company_names.py to prevent merging distinct organizations or business units.'
        })

    # Expected baseline validation vs observed results
    expected_baselines = [
        {'metric': 'Raw master records (placement_companies.csv)', 'key': 'raw_records', 'expected': 3098, 'observed': len(raw_pc)},
        {'metric': 'Records after initial cleaning (placements_clean.csv)', 'key': 'clean_records', 'expected': 2767, 'observed': len(clean_rows)},
        {'metric': 'Final canonical records (placements_final.csv)', 'key': 'final_records', 'expected': 2749, 'observed': len(final_rows)},
        {'metric': 'Distinct canonical companies', 'key': 'distinct_companies', 'expected': 1753, 'observed': final_unique_companies},
        {'metric': 'Distinct engineering colleges', 'key': 'distinct_colleges', 'expected': 27, 'observed': len(colleges_list)},
        {'metric': 'Records with valid package (LPA)', 'key': 'valid_packages', 'expected': 399, 'observed': len(pkg_rows)}
    ]
    for item in expected_baselines:
        item['diff'] = item['observed'] - item['expected']
        item['matches'] = item['diff'] == 0

    data = {
        'kpis': {
            'records': len(final_rows),
            'companies': final_unique_companies,
            'colleges': len(colleges_list),
            'packages': len(pkg_rows)
        },
        'pipeline': {
            'raw': len(raw_pc),
            'clean': len(clean_rows),
            'final': len(final_rows),
            'headerJunk': hdr_junk,
            'exactDuplicatesRemoved': exact_dups_removed,
            'postMergeDuplicatesRemoved': post_merge_dups_removed,
            'companiesBeforeMerge': clean_unique_companies,
            'companiesAfterMerge': final_unique_companies,
            'mappingsProposed': len(proposed_map),
            'tier1Proposed': tier1_proposed,
            'tier2Proposed': tier2_proposed,
            'excludedProposedPairs': len(excluded_proposed_rows),
            'riskySetSize': len(RISKY_SET),
            'mappingsApplied': len(applied_map),
            'manualFixes': len(FIX_DICT),
            'detailedDataKeyDisagreements': dd_unique_key_disagreements,
            'detailedDataRawDisagreements': dd_raw_disagreements,
            'variation2NonInrOrHourly': len(v2_non_inr_or_hourly)
        },
        'validationBaselines': expected_baselines,
        'regions': regions_summary,
        'companies': top_companies,
        'years': years_summary,
        'collegesList': colleges_list,
        'regionsList': regions_list,
        'rows': compact_rows,
        'rawFiles': raw_files_info,
        'sampleMerges': sample_merges
    }

    # Write ONLY to the single canonical assets/data.js
    dest = ROOT / 'assets/data.js'
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text('window.DASHBOARD_DATA = ' + json.dumps(data, separators=(',', ':')) + ';\n', encoding='utf-8')

    mismatches = [b for b in expected_baselines if not b['matches']]
    print(json.dumps(data['kpis']), json.dumps(data['pipeline']))
    if mismatches:
        print('WARNING - Baseline discrepancies detected:', json.dumps(mismatches))
    else:
        print('All 6 baseline validation targets matched observed values (0 discrepancies).')

if __name__ == '__main__':
    main()
