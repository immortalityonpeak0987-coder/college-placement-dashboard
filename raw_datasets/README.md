# Raw source files

Seven CSVs as received (unmodified). Row counts are data rows, excluding the header.

| File | Rows | What it is |
|---|---|---|
| `placement_companies.csv` | 3,098 | Master list: company, college, region, year (2014 to 2018). No package. **Used by the pipeline.** |
| `variation_1.csv` | 3,098 | Same records as the master list, but upper-cased. |
| `region_mumbai.csv` | 1,584 | Subset of the master (Mumbai, Navi Mumbai, Thane). |
| `region_pune.csv` | 1,213 | Subset of the master (Pune only; the master has more Pune rows). |
| `detailed_data.csv` | 462 | Subset of the master, with a numeric `Salary` column. Not used (disagrees with `variation_3.csv` on about 107 rows). |
| `variation_3.csv` | 463 | Same keys plus `salary` as text with units (`/yr`, `/mo`). **Used for package.** |
| `variation_2.csv` | 1,002 | Company-to-salary lookup only (no college or year). Not used. |

Known issues handled in `scripts/01_clean_data.py`: leaked header rows, duplicate records, inconsistent text casing/whitespace, mixed salary units.
