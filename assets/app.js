/**
 * Campus Placement Intelligence — Mumbai & Pune (2014–2018)
 * Authoritative Analytical Computation Layer, State Controller & Chart.js Engine
 */
(function () {
  'use strict';

  const RAW_DATA = window.DASHBOARD_DATA || {};
  const SITE_CONFIG = window.SITE || {};

  // Helper: Format company/college/region display names cleanly
  const ACRONYMS = new Set([
    'TCS', 'IBM', 'HP', 'HSBC', 'BNP', 'GEP', 'GE', 'WNS', 'LTI', 'L&T',
    'JSW', 'NSDL', 'NSE', 'NSEIT', 'KPIT', 'CMC', 'IDBI', 'HDFC', 'ICICI',
    'ubs', 'UBS', 'QAD', 'ADP', 'SAP', 'ZTE', 'TIAA', 'VF', 'VVF', 'EY', 'PWC',
    'MIT', 'COEP', 'VJTI', 'PICT', 'AIT', 'VIT', 'HOC', 'SMT', 'IIFL', 'GIC'
  ]);

  function formatDisplayName(raw) {
    if (!raw) return '';
    return String(raw)
      .trim()
      .split(/\s+/)
      .map((word) => {
        const clean = word.replace(/[^A-Z0-9&]/gi, '');
        if (ACRONYMS.has(clean.toUpperCase())) {
          return word.toUpperCase();
        }
        if (word.toUpperCase() === 'PVT.' || word.toUpperCase() === 'PVT') return 'Pvt.';
        if (word.toUpperCase() === 'LTD.' || word.toUpperCase() === 'LTD') return 'Ltd.';
        return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
      })
      .join(' ')
      .replace(/\bTcs\b/g, 'TCS')
      .replace(/\bZs\b/g, 'ZS')
      .replace(/\bIbm\b/g, 'IBM')
      .replace(/\bByju's\b/gi, "Byju's");
  }

  // Hydrate canonical records from window.DASHBOARD_DATA.rows
  const COLLEGES_LIST = RAW_DATA.collegesList || [];
  const REGIONS_LIST = RAW_DATA.regionsList || ['MUMBAI', 'NAVI MUMBAI', 'PUNE', 'THANE'];
  const ALL_YEARS = [2014, 2015, 2016, 2017, 2018];

  const CANONICAL_RECORDS = Object.freeze(
    (RAW_DATA.rows || []).map((tuple, idx) => {
      const rawCompany = String(tuple[0] || '').trim();
      const rawCollege = String(COLLEGES_LIST[tuple[1]] || '').trim();
      const rawRegion = String(REGIONS_LIST[tuple[2]] || '').trim();
      const year = Number(tuple[3]);
      const rawPkg = tuple[4];
      const pkg =
        rawPkg !== null && rawPkg !== undefined && rawPkg !== '' && Number.isFinite(Number(rawPkg)) && Number(rawPkg) > 0
          ? Number(rawPkg)
          : null;

      return Object.freeze({
        id: idx + 1,
        company: rawCompany,
        companyDisplay: formatDisplayName(rawCompany),
        college: rawCollege,
        collegeDisplay: formatDisplayName(rawCollege),
        region: rawRegion,
        regionDisplay: formatDisplayName(rawRegion),
        year: Number.isFinite(year) ? year : null,
        pkg: pkg
      });
    })
  );

  // Statistical utilities (strictly on valid finite numbers, never converting null to 0)
  function calcStats(values) {
    const valid = values.filter((v) => typeof v === 'number' && Number.isFinite(v) && v > 0).sort((a, b) => a - b);
    const n = valid.length;
    if (n === 0) {
      return { n: 0, avg: null, median: null, min: null, max: null, q1: null, q3: null, iqr: null };
    }
    const sum = valid.reduce((acc, v) => acc + v, 0);
    const avg = sum / n;
    const quantile = (arr, q) => {
      const pos = (arr.length - 1) * q;
      const base = Math.floor(pos);
      const rest = pos - base;
      if (arr[base + 1] !== undefined) {
        return arr[base] + rest * (arr[base + 1] - arr[base]);
      }
      return arr[base];
    };
    const median = quantile(valid, 0.5);
    const q1 = quantile(valid, 0.25);
    const q3 = quantile(valid, 0.75);
    return {
      n,
      avg: Number(avg.toFixed(2)),
      median: Number(median.toFixed(2)),
      min: Number(valid[0].toFixed(2)),
      max: Number(valid[n - 1].toFixed(2)),
      q1: Number(q1.toFixed(2)),
      q3: Number(q3.toFixed(2)),
      iqr: Number((q3 - q1).toFixed(2))
    };
  }

  // Application State
  const state = {
    activeSection: 'overview', // 'overview' | 'salary' | 'recruiters' | 'trends' | 'quality'
    theme: localStorage.getItem('cpi_theme') || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'),
    filters: {
      years: new Set(), // empty means all years
      regions: new Set(), // empty means all regions
      college: 'ALL',
      search: '',
      pkgOnly: false
    },
    overviewCompanyRankBy: 'records', // 'records' | 'colleges'
    recruiterChartRankBy: 'records', // 'records' | 'colleges'
    recruiterTable: {
      sortBy: 'records', // 'records' | 'colleges' | 'name' | 'avgPkg' | 'yearsSpan'
      sortDir: 'desc',
      page: 1,
      pageSize: 15,
      tableSearch: '',
      expandedCompany: null
    },
    collegeSalarySortBy: 'median' // 'median' | 'avg' | 'pkgCount' | 'totalRecords'
  };

  // Authoritative Filtering & Analytical Computation Layer
  function computeAnalytics() {
    const { years, regions, college, search, pkgOnly } = state.filters;
    const normSearch = search.trim().toUpperCase();

    const filteredRows = CANONICAL_RECORDS.filter((r) => {
      if (years.size > 0 && !years.has(r.year)) return false;
      if (regions.size > 0 && !regions.has(r.region)) return false;
      if (college !== 'ALL' && r.college !== college) return false;
      if (pkgOnly && r.pkg === null) return false;
      if (normSearch.length > 0) {
        const matchComp = r.company.includes(normSearch);
        const matchCol = r.college.includes(normSearch);
        if (!matchComp && !matchCol) return false;
      }
      return true;
    });

    const totalRecords = filteredRows.length;
    const companySet = new Set();
    const collegeSet = new Set();
    const regionSet = new Set();
    const pkgValues = [];

    for (let i = 0; i < totalRecords; i++) {
      const r = filteredRows[i];
      if (r.company) companySet.add(r.company);
      if (r.college) collegeSet.add(r.college);
      if (r.region) regionSet.add(r.region);
      if (r.pkg !== null) pkgValues.push(r.pkg);
    }

    const pkgRecords = pkgValues.length;
    const missingPkgRecords = totalRecords - pkgRecords;
    const pkgCoveragePct = totalRecords > 0 ? Number(((pkgRecords / totalRecords) * 100).toFixed(1)) : 0;
    const overallSalaryStats = calcStats(pkgValues);

    // Regional Aggregation
    const regionOrder = ['MUMBAI', 'PUNE', 'NAVI MUMBAI', 'THANE'];
    const regionMap = {};
    regionOrder.forEach((reg) => {
      regionMap[reg] = {
        rawName: reg,
        name: formatDisplayName(reg),
        totalRecords: 0,
        pkgValues: [],
        companies: new Set(),
        colleges: new Set()
      };
    });

    filteredRows.forEach((r) => {
      if (!regionMap[r.region]) {
        regionMap[r.region] = {
          rawName: r.region,
          name: r.regionDisplay,
          totalRecords: 0,
          pkgValues: [],
          companies: new Set(),
          colleges: new Set()
        };
      }
      const entry = regionMap[r.region];
      entry.totalRecords += 1;
      entry.companies.add(r.company);
      entry.colleges.add(r.college);
      if (r.pkg !== null) entry.pkgValues.push(r.pkg);
    });

    const regionalStats = Object.values(regionMap)
      .map((entry) => {
        const st = calcStats(entry.pkgValues);
        const cov = entry.totalRecords > 0 ? Number(((st.n / entry.totalRecords) * 100).toFixed(1)) : 0;
        return {
          rawName: entry.rawName,
          name: entry.name,
          totalRecords: entry.totalRecords,
          pkgRecords: st.n,
          missingPkgRecords: entry.totalRecords - st.n,
          coveragePct: cov,
          distinctCompanies: entry.companies.size,
          distinctColleges: entry.colleges.size,
          avg: st.avg,
          median: st.median,
          min: st.min,
          max: st.max,
          q1: st.q1,
          q3: st.q3,
          iqr: st.iqr,
          smallSample: st.n > 0 && st.n < 10,
          noData: st.n === 0
        };
      })
      .sort((a, b) => (b.avg || -1) - (a.avg || -1));

    // Salary Distribution Histogram Bins
    const salaryBins = [
      { label: '< 3.0 LPA', min: 0, max: 3.0, count: 0 },
      { label: '3.0 – 4.5 LPA', min: 3.0, max: 4.5, count: 0 },
      { label: '4.5 – 6.0 LPA', min: 4.5, max: 6.0, count: 0 },
      { label: '6.0 – 8.0 LPA', min: 6.0, max: 8.0, count: 0 },
      { label: '8.0 – 12.0 LPA', min: 8.0, max: 12.0, count: 0 },
      { label: '12.0+ LPA', min: 12.0, max: Infinity, count: 0 }
    ];
    pkgValues.forEach((v) => {
      for (let i = 0; i < salaryBins.length; i++) {
        const b = salaryBins[i];
        if (v >= b.min && v < b.max) {
          b.count += 1;
          break;
        }
      }
    });

    // College-level Salary & Coverage Breakdown
    const collegeMap = {};
    filteredRows.forEach((r) => {
      let cEntry = collegeMap[r.college];
      if (!cEntry) {
        cEntry = {
          rawName: r.college,
          name: r.collegeDisplay,
          region: r.regionDisplay,
          totalRecords: 0,
          companies: new Set(),
          years: new Set(),
          pkgValues: []
        };
        collegeMap[r.college] = cEntry;
      }
      cEntry.totalRecords += 1;
      cEntry.companies.add(r.company);
      if (r.year) cEntry.years.add(r.year);
      if (r.pkg !== null) cEntry.pkgValues.push(r.pkg);
    });

    const collegeStats = Object.values(collegeMap).map((c) => {
      const st = calcStats(c.pkgValues);
      return {
        rawName: c.rawName,
        name: c.name,
        region: c.region,
        totalRecords: c.totalRecords,
        distinctCompanies: c.companies.size,
        yearsCount: c.years.size,
        pkgRecords: st.n,
        coveragePct: c.totalRecords > 0 ? Number(((st.n / c.totalRecords) * 100).toFixed(1)) : 0,
        avg: st.avg,
        median: st.median,
        min: st.min,
        max: st.max
      };
    });

    // Company / Recruiter Aggregation
    const companyMap = {};
    filteredRows.forEach((r) => {
      let comp = companyMap[r.company];
      if (!comp) {
        comp = {
          rawName: r.company,
          name: r.companyDisplay,
          records: 0,
          colleges: new Set(),
          regions: new Set(),
          years: new Set(),
          pkgValues: [],
          details: []
        };
        companyMap[r.company] = comp;
      }
      comp.records += 1;
      comp.colleges.add(r.collegeDisplay);
      comp.regions.add(r.regionDisplay);
      if (r.year) comp.years.add(r.year);
      if (r.pkg !== null) comp.pkgValues.push(r.pkg);
      comp.details.push({
        college: r.collegeDisplay,
        region: r.regionDisplay,
        year: r.year,
        pkg: r.pkg
      });
    });

    const companiesAll = Object.values(companyMap).map((c) => {
      const st = calcStats(c.pkgValues);
      const yrs = Array.from(c.years).sort((a, b) => a - b);
      return {
        rawName: c.rawName,
        name: c.name,
        records: c.records,
        collegesCount: c.colleges.size,
        collegesList: Array.from(c.colleges).sort(),
        regionsList: Array.from(c.regions).sort(),
        yearsList: yrs,
        yearsSpan: yrs.length > 1 ? `${yrs[0]}–${yrs[yrs.length - 1]} (${yrs.length} yrs)` : yrs.length === 1 ? `${yrs[0]}` : '—',
        yearsCount: yrs.length,
        pkgCount: st.n,
        avgPkg: st.avg,
        medianPkg: st.median,
        maxPkg: st.max,
        details: c.details.sort((a, b) => b.year - a.year || a.college.localeCompare(b.college))
      };
    });

    const topByRecords = [...companiesAll]
      .sort((a, b) => b.records - a.records || b.collegesCount - a.collegesCount || a.name.localeCompare(b.name))
      .slice(0, 10);

    const topByColleges = [...companiesAll]
      .sort((a, b) => b.collegesCount - a.collegesCount || b.records - a.records || a.name.localeCompare(b.name))
      .slice(0, 10);

    // Yearly Aggregation (2014–2018)
    const activeYearsList = years.size > 0 ? ALL_YEARS.filter((y) => years.has(y)) : ALL_YEARS;
    const yearlyStats = activeYearsList.map((yr) => {
      const yrRows = filteredRows.filter((r) => r.year === yr);
      const yrCols = new Set(yrRows.map((r) => r.college));
      const yrRegs = new Set(yrRows.map((r) => r.region));
      const yrComps = new Set(yrRows.map((r) => r.company));
      const yrPkgs = yrRows.filter((r) => r.pkg !== null).map((r) => r.pkg);
      const st = calcStats(yrPkgs);
      return {
        year: yr,
        records: yrRows.length,
        collegesCount: yrCols.size,
        regionsCount: yrRegs.size,
        companiesCount: yrComps.size,
        pkgRecords: st.n,
        coveragePct: yrRows.length > 0 ? Number(((st.n / yrRows.length) * 100).toFixed(1)) : 0,
        shareOfTotalPct: totalRecords > 0 ? Number(((yrRows.length / totalRecords) * 100).toFixed(1)) : 0,
        avgPkg: st.avg,
        medianPkg: st.median,
        minPkg: st.min,
        maxPkg: st.max,
        smallSample: st.n > 0 && st.n < 10
      };
    });

    // Dynamic Descriptive Observations (strictly derived from current filtered data)
    const observations = [];
    const reliableRegions = regionalStats.filter((r) => r.pkgRecords >= 10);
    if (reliableRegions.length > 0) {
      const byMedian = [...reliableRegions].sort((a, b) => b.median - a.median);
      const topMed = byMedian[0];
      const gap = Number((topMed.avg - topMed.median).toFixed(2));
      observations.push({
        label: 'Regional Package Benchmark',
        text: `Among regions with ≥10 salary observations, ${topMed.name} records the highest median package at ${topMed.median.toFixed(2)} LPA (mean ${topMed.avg.toFixed(2)} LPA across n=${topMed.pkgRecords} records; mean exceeds median by ${gap > 0 ? '+' : ''}${gap.toFixed(2)} LPA due to upper-tail packages).`
      });
    } else if (pkgRecords > 0) {
      observations.push({
        label: 'Limited Salary Sample',
        text: `Current selection contains ${pkgRecords} package observations (median ${overallSalaryStats.median.toFixed(2)} LPA, mean ${overallSalaryStats.avg.toFixed(2)} LPA). No single region meets the n≥10 threshold for regional median comparison.`
      });
    } else {
      observations.push({
        label: 'No Package Observations',
        text: `None of the ${totalRecords.toLocaleString('en-IN')} filtered records contain salary information. Reset the package or college filter to inspect LPA metrics.`
      });
    }

    if (topByColleges.length > 0) {
      const topRec = topByColleges[0];
      const top3Names = topByRecords.slice(0, 3).map((c) => `${c.name} (${c.records})`).join(', ');
      observations.push({
        label: 'Recruiter Footprint Concentration',
        text: `${topRec.name} appears across the widest campus footprint (${topRec.collegesCount} distinct colleges, ${topRec.records} placement records). Top recurring recruiters by record count in this view: ${top3Names}.`
      });
    }

    const activeNonZeroYears = yearlyStats.filter((y) => y.records > 0);
    if (activeNonZeroYears.length > 0) {
      const peakYr = [...activeNonZeroYears].sort((a, b) => b.records - a.records)[0];
      observations.push({
        label: 'Reporting Coverage & Sample Scope',
        text: `Year ${peakYr.year} accounts for ${peakYr.records.toLocaleString('en-IN')} of ${totalRecords.toLocaleString('en-IN')} records (${peakYr.shareOfTotalPct}%) across ${peakYr.collegesCount} reporting colleges. Package data is present for ${pkgRecords.toLocaleString('en-IN')} records (${pkgCoveragePct}% coverage).`
      });
    }

    return {
      filteredRows,
      kpis: {
        totalRecords,
        distinctCompanies: companySet.size,
        distinctColleges: collegeSet.size,
        distinctRegions: regionSet.size,
        pkgRecords,
        missingPkgRecords,
        pkgCoveragePct,
        salaryStats: overallSalaryStats
      },
      regionalStats,
      salaryBins,
      collegeStats,
      companiesAll,
      topByRecords,
      topByColleges,
      yearlyStats,
      observations
    };
  }

  // Formatters
  const fmtInt = (n) => (n === null || n === undefined ? '—' : Number(n).toLocaleString('en-IN'));
  const fmtLpa = (n) => (n === null || n === undefined || !Number.isFinite(n) ? 'No data' : `${Number(n).toFixed(2)} LPA`);
  const fmtPct = (n) => (n === null || n === undefined || !Number.isFinite(n) ? '0.0%' : `${Number(n).toFixed(1)}%`);

  // Chart instances registry to prevent memory leaks or duplicate canvases
  const chartRegistry = {};
  function destroyChart(id) {
    if (chartRegistry[id]) {
      chartRegistry[id].destroy();
      delete chartRegistry[id];
    }
  }

  function isChartJsAvailable() {
    return typeof window.Chart === 'function';
  }

  function setChartContainerState(canvasId, status, message) {
    const canvas = document.getElementById(canvasId);
    if (!canvas || !canvas.parentElement) return null;
    const parent = canvas.parentElement;
    let fallbackEl = parent.querySelector('.chart-fallback-msg');
    if (status === 'ready') {
      canvas.style.display = 'block';
      if (fallbackEl) fallbackEl.remove();
      return canvas;
    }
    canvas.style.display = 'none';
    if (!fallbackEl) {
      fallbackEl = document.createElement('div');
      fallbackEl.className = 'chart-fallback-msg';
      fallbackEl.style.cssText =
        'display:flex;align-items:center;justify-content:center;height:100%;padding:20px;text-align:center;color:var(--muted);font-size:0.84rem;border:1px dashed var(--line-strong);border-radius:6px;background:var(--surface-subtle);';
      parent.appendChild(fallbackEl);
    }
    fallbackEl.textContent = message;
    return null;
  }

  function getThemeTokens() {
    const s = getComputedStyle(document.documentElement);
    return {
      ink: s.getPropertyValue('--ink').trim() || '#0F172A',
      muted: s.getPropertyValue('--muted').trim() || '#475569',
      line: s.getPropertyValue('--line').trim() || '#E2E8F0',
      surface: s.getPropertyValue('--surface').trim() || '#FFFFFF',
      teal: s.getPropertyValue('--accent').trim() || '#0D9488',
      tealSoft: s.getPropertyValue('--accent-soft').trim() || 'rgba(13, 148, 136, 0.18)',
      amber: s.getPropertyValue('--amber').trim() || '#D97706',
      slateBar: s.getPropertyValue('--slate-bar').trim() || '#94A3B8'
    };
  }

  // Custom Chart.js plugin for clean value labels at ends of bars
  const valueLabelPlugin = {
    id: 'cpiValueLabels',
    afterDatasetsDraw(chart, _args, pluginOptions) {
      if (!pluginOptions || !pluginOptions.enabled) return;
      const { ctx } = chart;
      const tokens = getThemeTokens();
      ctx.save();
      ctx.fillStyle = tokens.ink;
      ctx.font = '600 11px "JetBrains Mono", monospace';
      ctx.textBaseline = 'middle';

      chart.data.datasets.forEach((dataset, dsIndex) => {
        const meta = chart.getDatasetMeta(dsIndex);
        if (meta.hidden) return;
        meta.data.forEach((element, index) => {
          const rawVal = dataset.data[index];
          if (rawVal === null || rawVal === undefined || Number.isNaN(rawVal)) return;
          const formatted = pluginOptions.formatter ? pluginOptions.formatter(rawVal, dsIndex, index) : String(rawVal);
          if (!formatted) return;
          if (chart.options.indexAxis === 'y') {
            ctx.textAlign = 'left';
            ctx.fillText(formatted, element.x + 6, element.y);
          } else {
            ctx.textAlign = 'center';
            ctx.fillText(formatted, element.x, element.y - 8);
          }
        });
      });
      ctx.restore();
    }
  };

  // Render Overview Charts
  function renderOverviewCharts(analytics) {
    if (!isChartJsAvailable()) {
      ['chartOverviewRegion', 'chartOverviewCompanies', 'chartOverviewTrend', 'chartOverviewCoverage'].forEach((id) =>
        setChartContainerState(id, 'unavailable', 'Chart visualization unavailable: Chart.js library could not be loaded. KPI cards, tables, filters, and CSV exports remain active.')
      );
      return;
    }
    const tokens = getThemeTokens();
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    Chart.defaults.font.family = '"Public Sans", system-ui, sans-serif';
    Chart.defaults.color = tokens.muted;

    // Chart 1: Regional Salary Comparison (Horizontal Grouped Bar)
    destroyChart('chartOverviewRegion');
    const validRegions = analytics.regionalStats.filter((r) => r.pkgRecords > 0);
    const c1Canvas =
      validRegions.length > 0
        ? setChartContainerState('chartOverviewRegion', 'ready')
        : setChartContainerState('chartOverviewRegion', 'empty', 'No package data available for the selected filters.');
    if (c1Canvas && validRegions.length > 0) {
      chartRegistry['chartOverviewRegion'] = new Chart(c1Canvas, {
        type: 'bar',
        data: {
          labels: validRegions.map((r) => `${r.name} (n=${r.pkgRecords})`),
          datasets: [
            {
              label: 'Average Package (LPA)',
              data: validRegions.map((r) => r.avg),
              backgroundColor: tokens.teal,
              borderRadius: 4,
              barPercentage: 0.78,
              categoryPercentage: 0.72
            },
            {
              label: 'Median Package (LPA)',
              data: validRegions.map((r) => r.median),
              backgroundColor: tokens.amber,
              borderRadius: 4,
              barPercentage: 0.78,
              categoryPercentage: 0.72
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: reducedMotion ? false : { duration: 250 },
          indexAxis: 'y',
          layout: { padding: { right: 48, top: 4 } },
          scales: {
            x: {
              beginAtZero: true,
              grid: { color: tokens.line },
              border: { display: false },
              ticks: { color: tokens.muted },
              title: { display: true, text: 'Package (LPA — Lakhs Per Annum)', color: tokens.muted, font: { size: 11, weight: '600' } }
            },
            y: {
              grid: { display: false },
              border: { display: false },
              ticks: { color: tokens.ink, font: { weight: '600', size: 12 } }
            }
          },
          plugins: {
            legend: { position: 'bottom', labels: { color: tokens.ink, boxWidth: 12, padding: 14 } },
            cpiValueLabels: { enabled: true, formatter: (v) => Number(v).toFixed(2) },
            tooltip: {
              callbacks: {
                label: (ctx) => `${ctx.dataset.label}: ${Number(ctx.raw).toFixed(2)} LPA`,
                afterBody: (items) => {
                  const reg = validRegions[items[0].dataIndex];
                  const lines = [
                    `Valid package records: ${reg.pkgRecords} of ${reg.totalRecords} (${reg.coveragePct}% coverage)`,
                    `Observed range: ${reg.min.toFixed(2)} – ${reg.max.toFixed(2)} LPA`
                  ];
                  if (reg.smallSample) lines.push('Note: Small sample size (n < 10); interpret with caution.');
                  return lines;
                }
              }
            }
          }
        },
        plugins: [valueLabelPlugin]
      });
    }

    // Chart 2: Top 10 Recruiting Companies (with Criterion Selector)
    destroyChart('chartOverviewCompanies');
    const c2Canvas = document.getElementById('chartOverviewCompanies');
    const rankBy = state.overviewCompanyRankBy;
    const topCompList = rankBy === 'colleges' ? analytics.topByColleges : analytics.topByRecords;
    if (c2Canvas && topCompList.length > 0) {
      chartRegistry['chartOverviewCompanies'] = new Chart(c2Canvas, {
        type: 'bar',
        data: {
          labels: topCompList.map((c) => (c.name.length > 24 ? c.name.slice(0, 22) + '…' : c.name)),
          datasets: [
            {
              label: rankBy === 'colleges' ? 'Distinct Colleges Represented' : 'Placement / Recruiter Records',
              data: topCompList.map((c) => (rankBy === 'colleges' ? c.collegesCount : c.records)),
              backgroundColor: tokens.teal,
              borderRadius: 4,
              barPercentage: 0.72
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: reducedMotion ? false : { duration: 250 },
          indexAxis: 'y',
          layout: { padding: { right: 42, top: 4 } },
          scales: {
            x: {
              beginAtZero: true,
              grid: { color: tokens.line },
              border: { display: false },
              ticks: { color: tokens.muted, precision: 0 },
              title: {
                display: true,
                text: rankBy === 'colleges' ? 'Number of Distinct Engineering Colleges' : 'Number of Placement Records',
                color: tokens.muted,
                font: { size: 11, weight: '600' }
              }
            },
            y: {
              grid: { display: false },
              border: { display: false },
              ticks: { color: tokens.ink, font: { weight: '600', size: 11 } }
            }
          },
          plugins: {
            legend: { display: false },
            cpiValueLabels: { enabled: true, formatter: (v) => fmtInt(v) },
            tooltip: {
              callbacks: {
                title: (items) => topCompList[items[0].dataIndex].name,
                label: (ctx) => {
                  const item = topCompList[ctx.dataIndex];
                  return [
                    `Placement records: ${item.records}`,
                    `Colleges represented: ${item.collegesCount}`,
                    `Active years: ${item.yearsSpan}`,
                    item.pkgCount > 0 ? `Median package: ${item.medianPkg.toFixed(2)} LPA (n=${item.pkgCount})` : 'Package data: Not reported'
                  ];
                }
              }
            }
          }
        },
        plugins: [valueLabelPlugin]
      });
    }

    // Chart 3: Historical Reporting Trend (2014–2018) with Dual Non-Misleading Scales
    destroyChart('chartOverviewTrend');
    const c3Canvas = document.getElementById('chartOverviewTrend');
    const yrList = analytics.yearlyStats;
    if (c3Canvas && yrList.length > 0) {
      chartRegistry['chartOverviewTrend'] = new Chart(c3Canvas, {
        type: 'bar',
        data: {
          labels: yrList.map((y) => `${y.year} (${y.collegesCount} ${y.collegesCount === 1 ? 'college' : 'colleges'})`),
          datasets: [
            {
              type: 'bar',
              label: 'Placement Records (Left Axis)',
              data: yrList.map((y) => y.records),
              backgroundColor: yrList.map((y) => (y.year === 2018 ? tokens.teal : tokens.slateBar)),
              borderRadius: 4,
              maxBarThickness: 64,
              yAxisID: 'yRecords',
              order: 2
            },
            {
              type: 'line',
              label: 'Distinct Reporting Colleges (Right Axis)',
              data: yrList.map((y) => y.collegesCount),
              borderColor: tokens.amber,
              backgroundColor: tokens.amber,
              borderWidth: 2.5,
              pointRadius: 4,
              pointHoverRadius: 6,
              tension: 0.2,
              yAxisID: 'yColleges',
              order: 1
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: reducedMotion ? false : { duration: 250 },
          layout: { padding: { top: 18 } },
          scales: {
            x: {
              grid: { display: false },
              border: { display: false },
              ticks: { color: tokens.ink, font: { weight: '600', size: 12 } }
            },
            yRecords: {
              type: 'linear',
              position: 'left',
              beginAtZero: true,
              grid: { color: tokens.line },
              border: { display: false },
              ticks: { color: tokens.muted, precision: 0 },
              title: { display: true, text: 'Placement / Recruiter Records', color: tokens.muted, font: { size: 11, weight: '600' } }
            },
            yColleges: {
              type: 'linear',
              position: 'right',
              beginAtZero: true,
              suggestedMax: 30,
              grid: { drawOnChartArea: false },
              border: { display: false },
              ticks: { color: tokens.amber, precision: 0 },
              title: { display: true, text: 'Reporting Colleges Count', color: tokens.amber, font: { size: 11, weight: '600' } }
            }
          },
          plugins: {
            legend: { position: 'bottom', labels: { color: tokens.ink, boxWidth: 12, padding: 14 } },
            cpiValueLabels: {
              enabled: true,
              formatter: (v, dsIdx) => (dsIdx === 0 ? fmtInt(v) : '')
            },
            tooltip: {
              callbacks: {
                afterBody: (items) => {
                  const yObj = yrList[items[0].dataIndex];
                  return [
                    `Share of filtered records: ${yObj.shareOfTotalPct}%`,
                    `Distinct companies: ${fmtInt(yObj.companiesCount)}`,
                    `Package coverage: ${yObj.pkgRecords} records (${yObj.coveragePct}%)`
                  ];
                }
              }
            }
          }
        },
        plugins: [valueLabelPlugin]
      });
    }

    // Chart 4: Package-Data Coverage by Region (Stacked Horizontal Bar)
    destroyChart('chartOverviewCoverage');
    const c4Canvas = document.getElementById('chartOverviewCoverage');
    const activeRegs = analytics.regionalStats.filter((r) => r.totalRecords > 0);
    if (c4Canvas && activeRegs.length > 0) {
      chartRegistry['chartOverviewCoverage'] = new Chart(c4Canvas, {
        type: 'bar',
        data: {
          labels: activeRegs.map((r) => `${r.name} (${r.coveragePct}%)`),
          datasets: [
            {
              label: 'With Verified Package (LPA)',
              data: activeRegs.map((r) => r.pkgRecords),
              backgroundColor: tokens.teal,
              borderRadius: 4
            },
            {
              label: 'Package Unreported / Missing',
              data: activeRegs.map((r) => r.missingPkgRecords),
              backgroundColor: tokens.line,
              borderRadius: 4
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: reducedMotion ? false : { duration: 250 },
          indexAxis: 'y',
          scales: {
            x: {
              stacked: true,
              beginAtZero: true,
              grid: { color: tokens.line },
              border: { display: false },
              ticks: { color: tokens.muted, precision: 0 },
              title: { display: true, text: 'Total Placement Records by Disclosure Status', color: tokens.muted, font: { size: 11, weight: '600' } }
            },
            y: {
              stacked: true,
              grid: { display: false },
              border: { display: false },
              ticks: { color: tokens.ink, font: { weight: '600', size: 12 } }
            }
          },
          plugins: {
            legend: { position: 'bottom', labels: { color: tokens.ink, boxWidth: 12, padding: 14 } },
            tooltip: {
              callbacks: {
                afterBody: (items) => {
                  const r = activeRegs[items[0].dataIndex];
                  return `Total regional records: ${fmtInt(r.totalRecords)} (${r.coveragePct}% include salary data)`;
                }
              }
            }
          }
        }
      });
    }
  }

  // Render Salary Insights Charts
  function renderSalaryCharts(analytics) {
    if (!isChartJsAvailable()) {
      ['chartSalaryHistogram', 'chartSalaryRegionalDetail'].forEach((id) =>
        setChartContainerState(id, 'unavailable', 'Chart visualization unavailable: Chart.js library could not be loaded. Salary tables remain active below.')
      );
      return;
    }
    const tokens = getThemeTokens();
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // Salary Distribution Histogram
    destroyChart('chartSalaryHistogram');
    const histCanvas =
      analytics.kpis.pkgRecords > 0
        ? setChartContainerState('chartSalaryHistogram', 'ready')
        : setChartContainerState('chartSalaryHistogram', 'empty', 'No package data available for the selected filters.');
    if (histCanvas && analytics.kpis.pkgRecords > 0) {
      chartRegistry['chartSalaryHistogram'] = new Chart(histCanvas, {
        type: 'bar',
        data: {
          labels: analytics.salaryBins.map((b) => b.label),
          datasets: [
            {
              label: 'Records with Package Data',
              data: analytics.salaryBins.map((b) => b.count),
              backgroundColor: tokens.teal,
              borderRadius: 4,
              maxBarThickness: 56
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: reducedMotion ? false : { duration: 250 },
          layout: { padding: { top: 18 } },
          scales: {
            x: {
              grid: { display: false },
              border: { display: false },
              ticks: { color: tokens.ink, font: { weight: '600', size: 11 } },
              title: { display: true, text: 'Annual Package Bracket (LPA)', color: tokens.muted, font: { size: 11, weight: '600' } }
            },
            y: {
              beginAtZero: true,
              grid: { color: tokens.line },
              border: { display: false },
              ticks: { color: tokens.muted, precision: 0 },
              title: { display: true, text: 'Number of Records (n)', color: tokens.muted, font: { size: 11, weight: '600' } }
            }
          },
          plugins: {
            legend: { display: false },
            cpiValueLabels: { enabled: true, formatter: (v) => fmtInt(v) },
            tooltip: {
              callbacks: {
                label: (ctx) => {
                  const count = ctx.raw;
                  const share = analytics.kpis.pkgRecords > 0 ? ((count / analytics.kpis.pkgRecords) * 100).toFixed(1) : '0.0';
                  return `${count} records (${share}% of ${analytics.kpis.pkgRecords} salary-bearing records)`;
                }
              }
            }
          }
        },
        plugins: [valueLabelPlugin]
      });
    }

    // Regional Min / Median / Mean / Max Range Comparison Chart
    destroyChart('chartSalaryRegionalDetail');
    const validRegs = analytics.regionalStats.filter((r) => r.pkgRecords > 0);
    const regDetailCanvas =
      validRegs.length > 0
        ? setChartContainerState('chartSalaryRegionalDetail', 'ready')
        : setChartContainerState('chartSalaryRegionalDetail', 'empty', 'No regional package data available for the selected filters.');
    if (regDetailCanvas && validRegs.length > 0) {
      chartRegistry['chartSalaryRegionalDetail'] = new Chart(regDetailCanvas, {
        type: 'bar',
        data: {
          labels: validRegs.map((r) => `${r.name} (n=${r.pkgRecords})`),
          datasets: [
            {
              label: '25th Percentile (Q1)',
              data: validRegs.map((r) => r.q1),
              backgroundColor: tokens.slateBar,
              borderRadius: 3
            },
            {
              label: 'Median (Typical LPA)',
              data: validRegs.map((r) => r.median),
              backgroundColor: tokens.amber,
              borderRadius: 3
            },
            {
              label: 'Mean (Average LPA)',
              data: validRegs.map((r) => r.avg),
              backgroundColor: tokens.teal,
              borderRadius: 3
            },
            {
              label: '75th Percentile (Q3)',
              data: validRegs.map((r) => r.q3),
              backgroundColor: '#3B82F6',
              borderRadius: 3
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: reducedMotion ? false : { duration: 250 },
          layout: { padding: { top: 12 } },
          scales: {
            x: {
              grid: { display: false },
              border: { display: false },
              ticks: { color: tokens.ink, font: { weight: '600', size: 12 } }
            },
            y: {
              beginAtZero: true,
              grid: { color: tokens.line },
              border: { display: false },
              ticks: { color: tokens.muted },
              title: { display: true, text: 'Package (LPA)', color: tokens.muted, font: { size: 11, weight: '600' } }
            }
          },
          plugins: {
            legend: { position: 'bottom', labels: { color: tokens.ink, boxWidth: 12, padding: 12 } },
            tooltip: {
              callbacks: {
                label: (ctx) => `${ctx.dataset.label}: ${Number(ctx.raw).toFixed(2)} LPA`,
                afterBody: (items) => {
                  const r = validRegs[items[0].dataIndex];
                  return `Full range: ${r.min.toFixed(2)} LPA (Min) to ${r.max.toFixed(2)} LPA (Max) | IQR: ${r.iqr.toFixed(2)} LPA`;
                }
              }
            }
          }
        }
      });
    }
  }

  // Render Recruiter Analysis Chart
  function renderRecruiterCharts(analytics) {
    if (!isChartJsAvailable()) {
      setChartContainerState('chartRecruiterTop', 'unavailable', 'Chart visualization unavailable: Chart.js library could not be loaded. The searchable company directory remains active below.');
      return;
    }
    const tokens = getThemeTokens();
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    destroyChart('chartRecruiterTop');
    const mode = state.recruiterChartRankBy;
    const list = (mode === 'colleges' ? analytics.topByColleges : analytics.topByRecords).slice(0, 10);
    const canvas =
      list.length > 0
        ? setChartContainerState('chartRecruiterTop', 'ready')
        : setChartContainerState('chartRecruiterTop', 'empty', 'No recruiting companies match the current filter selection.');

    if (canvas && list.length > 0) {
      chartRegistry['chartRecruiterTop'] = new Chart(canvas, {
        type: 'bar',
        data: {
          labels: list.map((c) => c.name),
          datasets: [
            {
              label: 'Placement Records',
              data: list.map((c) => c.records),
              backgroundColor: tokens.teal,
              borderRadius: 4
            },
            {
              label: 'Distinct Colleges Represented',
              data: list.map((c) => c.collegesCount),
              backgroundColor: tokens.amber,
              borderRadius: 4
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: reducedMotion ? false : { duration: 250 },
          indexAxis: 'y',
          layout: { padding: { right: 36, top: 4 } },
          scales: {
            x: {
              beginAtZero: true,
              grid: { color: tokens.line },
              border: { display: false },
              ticks: { color: tokens.muted, precision: 0 },
              title: { display: true, text: 'Count (Records vs Distinct Colleges)', color: tokens.muted, font: { size: 11, weight: '600' } }
            },
            y: {
              grid: { display: false },
              border: { display: false },
              ticks: { color: tokens.ink, font: { weight: '600', size: 11 } }
            }
          },
          plugins: {
            legend: { position: 'bottom', labels: { color: tokens.ink, boxWidth: 12, padding: 14 } },
            tooltip: {
              callbacks: {
                afterBody: (items) => {
                  const c = list[items[0].dataIndex];
                  return [
                    `Active years: ${c.yearsSpan}`,
                    `Regions: ${c.regionsList.join(', ')}`,
                    c.pkgCount > 0 ? `Observed median package: ${c.medianPkg.toFixed(2)} LPA (n=${c.pkgCount})` : 'Package data: Not reported'
                  ];
                }
              }
            }
          }
        }
      });
    }
  }

  // Render Yearly Trends Charts
  function renderTrendsCharts(analytics) {
    if (!isChartJsAvailable()) {
      ['chartTrendsRecords', 'chartTrendsColleges'].forEach((id) =>
        setChartContainerState(id, 'unavailable', 'Chart visualization unavailable: Chart.js library could not be loaded. The yearly reconciliation table remains active below.')
      );
      return;
    }
    const tokens = getThemeTokens();
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const yrList = analytics.yearlyStats.filter((y) => y.records > 0);

    destroyChart('chartTrendsRecords');
    const c1 =
      yrList.length > 0
        ? setChartContainerState('chartTrendsRecords', 'ready')
        : setChartContainerState('chartTrendsRecords', 'empty', 'No yearly records match the current filter selection.');
    if (c1 && yrList.length > 0) {
      chartRegistry['chartTrendsRecords'] = new Chart(c1, {
        type: 'bar',
        data: {
          labels: yrList.map((y) => String(y.year)),
          datasets: [
            {
              label: 'Placement / Recruiter Records',
              data: yrList.map((y) => y.records),
              backgroundColor: yrList.map((y) => (y.year === 2018 ? tokens.teal : tokens.slateBar)),
              borderRadius: 4,
              maxBarThickness: 58
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: reducedMotion ? false : { duration: 250 },
          layout: { padding: { top: 18 } },
          scales: {
            x: { grid: { display: false }, border: { display: false }, ticks: { color: tokens.ink, font: { weight: '600' } } },
            y: {
              beginAtZero: true,
              grid: { color: tokens.line },
              border: { display: false },
              ticks: { color: tokens.muted, precision: 0 },
              title: { display: true, text: 'Observed Records Count', color: tokens.muted, font: { size: 11, weight: '600' } }
            }
          },
          plugins: {
            legend: { display: false },
            cpiValueLabels: { enabled: true, formatter: (v) => fmtInt(v) },
            tooltip: {
              callbacks: {
                afterBody: (items) => {
                  const y = yrList[items[0].dataIndex];
                  return [
                    `Reporting colleges: ${y.collegesCount} of 27`,
                    `Share of selection: ${y.shareOfTotalPct}%`,
                    `Distinct companies: ${fmtInt(y.companiesCount)}`
                  ];
                }
              }
            }
          }
        },
        plugins: [valueLabelPlugin]
      });
    }

    destroyChart('chartTrendsColleges');
    const c2 = document.getElementById('chartTrendsColleges');
    if (c2 && yrList.length > 0) {
      chartRegistry['chartTrendsColleges'] = new Chart(c2, {
        type: 'bar',
        data: {
          labels: yrList.map((y) => String(y.year)),
          datasets: [
            {
              label: 'Distinct Colleges Reporting',
              data: yrList.map((y) => y.collegesCount),
              backgroundColor: tokens.amber,
              borderRadius: 4,
              maxBarThickness: 48
            },
            {
              label: 'Regions Represented',
              data: yrList.map((y) => y.regionsCount),
              backgroundColor: tokens.teal,
              borderRadius: 4,
              maxBarThickness: 48
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: reducedMotion ? false : { duration: 250 },
          layout: { padding: { top: 18 } },
          scales: {
            x: { grid: { display: false }, border: { display: false }, ticks: { color: tokens.ink, font: { weight: '600' } } },
            y: {
              beginAtZero: true,
              suggestedMax: 28,
              grid: { color: tokens.line },
              border: { display: false },
              ticks: { color: tokens.muted, precision: 0 },
              title: { display: true, text: 'Institutional & Regional Count', color: tokens.muted, font: { size: 11, weight: '600' } }
            }
          },
          plugins: {
            legend: { position: 'bottom', labels: { color: tokens.ink, boxWidth: 12, padding: 12 } },
            cpiValueLabels: { enabled: true, formatter: (v) => fmtInt(v) }
          }
        },
        plugins: [valueLabelPlugin]
      });
    }
  }

  // Escape HTML safely
  function esc(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // Genuine RFC 4180 CSV Export
  function downloadCsv(filename, headers, rowsArray) {
    const escapeCell = (val) => {
      if (val === null || val === undefined) return '';
      const str = String(val);
      if (/[",\r\n]/.test(str)) {
        return '"' + str.replace(/"/g, '""') + '"';
      }
      return str;
    };
    const csvLines = [headers.map(escapeCell).join(',')];
    for (let i = 0; i < rowsArray.length; i++) {
      csvLines.push(rowsArray[i].map(escapeCell).join(','));
    }
    const blob = new Blob(['\uFEFF' + csvLines.join('\r\n') + '\r\n'], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function exportFilteredRecordsCsv(analytics) {
    const rows = analytics.filteredRows.map((r) => [
      r.company,
      r.college,
      r.region,
      r.year,
      r.pkg !== null ? r.pkg.toFixed(2) : ''
    ]);
    const suffix = state.filters.years.size > 0 ? Array.from(state.filters.years).sort().join('-') : '2014-2018';
    downloadCsv(
      `campus_placement_records_${suffix}_${rows.length}rows.csv`,
      ['name of company', 'college name', 'region', 'year', 'package_lpa'],
      rows
    );
  }

  function exportRecruiterSummaryCsv(analytics) {
    const rows = analytics.companiesAll.map((c) => [
      c.rawName,
      c.records,
      c.collegesCount,
      c.yearsList.join(';'),
      c.regionsList.join(';'),
      c.pkgCount,
      c.medianPkg !== null ? c.medianPkg.toFixed(2) : '',
      c.avgPkg !== null ? c.avgPkg.toFixed(2) : ''
    ]);
    downloadCsv(
      `recruiter_summary_${rows.length}companies.csv`,
      ['company_name', 'placement_records', 'distinct_colleges', 'years_active', 'regions', 'package_records', 'median_package_lpa', 'avg_package_lpa'],
      rows
    );
  }

  // Main UI Render Function
  function renderApp() {
    document.documentElement.setAttribute('data-theme', state.theme);
    const analytics = computeAnalytics();

    // Update Sidebar Active Navigation
    document.querySelectorAll('[data-nav-section]').forEach((btn) => {
      const isAct = btn.getAttribute('data-nav-section') === state.activeSection;
      btn.classList.toggle('active', isAct);
      btn.setAttribute('aria-current', isAct ? 'page' : 'false');
    });

    // Update Section Visibility
    const sectionTitles = {
      overview: 'Executive Overview',
      salary: 'Salary Insights & Regional LPA Analysis',
      recruiters: 'Recruiter Footprint & Company Analysis',
      trends: 'Historical Reporting Trends (2014–2018)',
      quality: 'Data Quality, Lineage & Methodology'
    };
    const breadcrumbEl = document.getElementById('activeSectionTitle');
    if (breadcrumbEl) breadcrumbEl.textContent = sectionTitles[state.activeSection] || 'Executive Overview';

    document.querySelectorAll('[data-view-panel]').forEach((panel) => {
      const match = panel.getAttribute('data-view-panel') === state.activeSection;
      panel.hidden = !match;
    });

    // Update Theme Toggle Button Label/Icon
    const themeBtn = document.getElementById('themeToggleBtn');
    if (themeBtn) {
      themeBtn.innerHTML =
        state.theme === 'dark'
          ? '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg><span>Light Theme</span>'
          : '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg><span>Dark Theme</span>';
    }

    // Update Filter Controls State
    document.querySelectorAll('[data-filter-year]').forEach((btn) => {
      const yr = btn.getAttribute('data-filter-year');
      if (yr === 'ALL') {
        btn.classList.toggle('active', state.filters.years.size === 0);
      } else {
        btn.classList.toggle('active', state.filters.years.has(Number(yr)));
      }
    });

    document.querySelectorAll('[data-filter-region]').forEach((btn) => {
      const reg = btn.getAttribute('data-filter-region');
      if (reg === 'ALL') {
        btn.classList.toggle('active', state.filters.regions.size === 0);
      } else {
        btn.classList.toggle('active', state.filters.regions.has(reg));
      }
    });

    const colSelect = document.getElementById('filterCollegeSelect');
    if (colSelect && colSelect.value !== state.filters.college) {
      colSelect.value = state.filters.college;
    }

    const pkgToggle = document.getElementById('filterPkgOnlyBtn');
    if (pkgToggle) {
      pkgToggle.classList.toggle('active', state.filters.pkgOnly);
      pkgToggle.setAttribute('aria-pressed', String(state.filters.pkgOnly));
    }

    // Render Active Filter Indicators & Reset Bar
    renderActiveFiltersBar(analytics);

    // Handle Empty Filter Result State vs Populated Content
    const emptyStateEl = document.getElementById('globalEmptyState');
    const mainPanelsWrap = document.getElementById('mainPanelsContainer');
    const isZeroResults = analytics.kpis.totalRecords === 0 && state.activeSection !== 'quality';
    if (emptyStateEl && mainPanelsWrap) {
      emptyStateEl.hidden = !isZeroResults;
      mainPanelsWrap.hidden = isZeroResults;
    }

    // Update Global KPI Strip (shown at top of Overview and summarized across views)
    renderKpiCards(analytics);

    // Render active section content
    if (!isZeroResults) {
      if (state.activeSection === 'overview') {
        renderOverviewSection(analytics);
      } else if (state.activeSection === 'salary') {
        renderSalarySection(analytics);
      } else if (state.activeSection === 'recruiters') {
        renderRecruitersSection(analytics);
      } else if (state.activeSection === 'trends') {
        renderTrendsSection(analytics);
      }
    }
    if (state.activeSection === 'quality') {
      renderQualitySection(analytics);
    }
  }

  function renderActiveFiltersBar(analytics) {
    const bar = document.getElementById('activeFiltersBar');
    const listEl = document.getElementById('activeFilterTags');
    const countBadge = document.getElementById('filteredStatusText');
    if (!bar || !listEl || !countBadge) return;

    const tags = [];
    if (state.filters.years.size > 0) {
      const yrs = Array.from(state.filters.years).sort().join(', ');
      tags.push({ label: `Year: ${yrs}`, action: 'clear-years' });
    }
    if (state.filters.regions.size > 0) {
      const regs = Array.from(state.filters.regions).map(formatDisplayName).join(', ');
      tags.push({ label: `Region: ${regs}`, action: 'clear-regions' });
    }
    if (state.filters.college !== 'ALL') {
      tags.push({ label: `College: ${formatDisplayName(state.filters.college)}`, action: 'clear-college' });
    }
    if (state.filters.search.trim().length > 0) {
      tags.push({ label: `Search: "${state.filters.search.trim()}"`, action: 'clear-search' });
    }
    if (state.filters.pkgOnly) {
      tags.push({ label: 'Package Data Only (399 max)', action: 'clear-pkg' });
    }

    const totalCanon = CANONICAL_RECORDS.length;
    const curr = analytics.kpis.totalRecords;
    countBadge.textContent =
      tags.length === 0
        ? `Showing all ${fmtInt(curr)} canonical records · 2014–2018`
        : `Showing ${fmtInt(curr)} of ${fmtInt(totalCanon)} records (${ ((curr / totalCanon) * 100).toFixed(1) }%)`;

    const resetBtn = document.getElementById('resetFiltersBtn');
    if (resetBtn) {
      resetBtn.disabled = tags.length === 0;
    }

    if (tags.length === 0) {
      listEl.innerHTML = '<span class="muted-inline">No active filters applied — displaying full canonical dataset.</span>';
    } else {
      listEl.innerHTML = tags
        .map(
          (t) =>
            `<button type="button" class="filter-tag-btn" data-clear-filter="${esc(t.action)}" title="Remove filter">${esc(t.label)} <span aria-hidden="true">×</span></button>`
        )
        .join('');
    }
  }

  function renderKpiCards(analytics) {
    const k = analytics.kpis;
    const setTxt = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.textContent = val;
    };
    setTxt('kpiRecordsVal', fmtInt(k.totalRecords));
    setTxt('kpiRecordsSub', `Placement / recruiter records (not unique student count)`);

    setTxt('kpiCompaniesVal', fmtInt(k.distinctCompanies));
    setTxt('kpiCompaniesSub', `Unique standardized company names in selection`);

    setTxt('kpiCollegesVal', fmtInt(k.distinctColleges));
    setTxt('kpiCollegesSub', `Across ${k.distinctRegions} ${k.distinctRegions === 1 ? 'region' : 'regions'} in Mumbai & Pune`);

    setTxt('kpiPackagesVal', `${fmtInt(k.pkgRecords)} (${fmtPct(k.pkgCoveragePct)})`);
    setTxt(
      'kpiPackagesSub',
      k.pkgRecords > 0
        ? `Median ${k.salaryStats.median.toFixed(2)} LPA · Mean ${k.salaryStats.avg.toFixed(2)} LPA · ${fmtInt(k.missingPkgRecords)} missing`
        : `0 of ${fmtInt(k.totalRecords)} records contain package data`
    );
  }

  function renderOverviewSection(analytics) {
    const notePkgEl = document.getElementById('overviewNotePkgStats');
    if (notePkgEl) {
      notePkgEl.textContent = `${fmtInt(analytics.kpis.pkgRecords)} of ${fmtInt(analytics.kpis.totalRecords)} records (${fmtPct(analytics.kpis.pkgCoveragePct)})`;
    }
    // Update Rank Criterion Buttons
    document.querySelectorAll('[data-overview-rank]').forEach((btn) => {
      btn.classList.toggle('active', btn.getAttribute('data-overview-rank') === state.overviewCompanyRankBy);
    });

    const rankSubtitle = document.getElementById('overviewRankSubtitle');
    if (rankSubtitle) {
      rankSubtitle.textContent =
        state.overviewCompanyRankBy === 'colleges'
          ? 'Ranked by number of distinct engineering colleges represented (ties broken by record count).'
          : 'Ranked by total placement/recruiter records across the selected filter view (ties broken by distinct colleges).';
    }

    // Render Descriptive Observations
    const obsList = document.getElementById('overviewObservationsList');
    if (obsList) {
      obsList.innerHTML = analytics.observations
        .map(
          (o) => `
          <div class="obs-item">
            <div class="obs-label">${esc(o.label)}</div>
            <p class="obs-text">${esc(o.text)}</p>
          </div>`
        )
        .join('');
    }

    renderOverviewCharts(analytics);
  }

  function renderSalarySection(analytics) {
    const st = analytics.kpis.salaryStats;
    const setTxt = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.textContent = val;
    };

    setTxt('salKpiMedian', st.n > 0 ? `${st.median.toFixed(2)} LPA` : 'No data');
    setTxt('salKpiMedianSub', st.n > 0 ? `Typical observation (50th percentile, n=${fmtInt(st.n)})` : 'No valid package records');

    setTxt('salKpiMean', st.n > 0 ? `${st.avg.toFixed(2)} LPA` : 'No data');
    const diff = st.n > 0 ? (st.avg - st.median).toFixed(2) : null;
    setTxt(
      'salKpiMeanSub',
      st.n > 0 ? `Arithmetic mean (${diff >= 0 ? '+' : ''}${diff} LPA vs median due to high outliers)` : 'No valid package records'
    );

    setTxt('salKpiRange', st.n > 0 ? `${st.min.toFixed(2)} – ${st.max.toFixed(2)} LPA` : 'No data');
    setTxt('salKpiRangeSub', st.n > 0 ? `Interquartile range (Q1–Q3): ${st.q1.toFixed(2)} – ${st.q3.toFixed(2)} LPA` : '—');

    setTxt('salKpiCoverage', `${fmtPct(analytics.kpis.pkgCoveragePct)} (${fmtInt(st.n)} / ${fmtInt(analytics.kpis.totalRecords)})`);
    setTxt('salKpiCoverageSub', `${fmtInt(analytics.kpis.missingPkgRecords)} records have no reported salary (excluded, never zeroed)`);

    // Regional Salary Table
    const regTbody = document.getElementById('salaryRegionalTableBody');
    if (regTbody) {
      regTbody.innerHTML = analytics.regionalStats
        .map((r) => {
          if (r.noData) {
            return `
              <tr>
                <td class="font-semibold">${esc(r.name)}</td>
                <td class="num">${fmtInt(r.totalRecords)}</td>
                <td class="num">0 (0.0%)</td>
                <td colspan="5" class="muted-cell">No package data available for current filter selection</td>
              </tr>`;
          }
          return `
            <tr>
              <td class="font-semibold">
                ${esc(r.name)}
                ${r.smallSample ? '<span class="caution-inline"> · Low sample (n&lt;10)</span>' : ''}
              </td>
              <td class="num">${fmtInt(r.totalRecords)}</td>
              <td class="num">${fmtInt(r.pkgRecords)} (${fmtPct(r.coveragePct)})</td>
              <td class="num font-semibold accent-text">${r.median.toFixed(2)} LPA</td>
              <td class="num">${r.avg.toFixed(2)} LPA</td>
              <td class="num">${r.q1.toFixed(2)} – ${r.q3.toFixed(2)} LPA</td>
              <td class="num">${r.min.toFixed(2)} LPA</td>
              <td class="num">${r.max.toFixed(2)} LPA</td>
            </tr>`;
        })
        .join('');
    }

    // College-level Salary Breakdown Table
    const colTbody = document.getElementById('salaryCollegeTableBody');
    if (colTbody) {
      const sortKey = state.collegeSalarySortBy;
      const sortedCols = [...analytics.collegeStats].sort((a, b) => {
        if (sortKey === 'median') return (b.median ?? -1) - (a.median ?? -1) || b.pkgRecords - a.pkgRecords;
        if (sortKey === 'avg') return (b.avg ?? -1) - (a.avg ?? -1) || b.pkgRecords - a.pkgRecords;
        if (sortKey === 'pkgCount') return b.pkgRecords - a.pkgRecords || b.totalRecords - a.totalRecords;
        return b.totalRecords - a.totalRecords;
      });

      colTbody.innerHTML = sortedCols
        .map((c) => {
          const hasPkg = c.pkgRecords > 0;
          return `
            <tr>
              <td class="font-semibold">${esc(c.name)}</td>
              <td>${esc(c.region)}</td>
              <td class="num">${fmtInt(c.totalRecords)}</td>
              <td class="num">${fmtInt(c.pkgRecords)} (${fmtPct(c.coveragePct)})</td>
              <td class="num font-semibold">${hasPkg ? `${c.median.toFixed(2)} LPA` : 'No package data'}</td>
              <td class="num">${hasPkg ? `${c.avg.toFixed(2)} LPA` : '—'}</td>
              <td class="num">${hasPkg ? `${c.min.toFixed(2)} – ${c.max.toFixed(2)} LPA` : '—'}</td>
            </tr>`;
        })
        .join('');
    }

    renderSalaryCharts(analytics);
  }

  function renderRecruitersSection(analytics) {
    document.querySelectorAll('[data-recruiter-rank]').forEach((btn) => {
      btn.classList.toggle('active', btn.getAttribute('data-recruiter-rank') === state.recruiterChartRankBy);
    });

    renderRecruiterCharts(analytics);
    renderRecruiterTable(analytics);
  }

  function renderRecruiterTable(analytics) {
    const { sortBy, sortDir, page, pageSize, tableSearch, expandedCompany } = state.recruiterTable;
    const q = tableSearch.trim().toUpperCase();

    let rows = analytics.companiesAll;
    if (q.length > 0) {
      rows = rows.filter(
        (c) =>
          c.rawName.includes(q) ||
          c.regionsList.some((r) => r.toUpperCase().includes(q)) ||
          c.collegesList.some((col) => col.toUpperCase().includes(q))
      );
    }

    const dir = sortDir === 'asc' ? 1 : -1;
    rows = [...rows].sort((a, b) => {
      if (sortBy === 'name') return a.name.localeCompare(b.name) * dir;
      if (sortBy === 'colleges') {
        return (a.collegesCount - b.collegesCount) * dir || b.records - a.records || a.name.localeCompare(b.name);
      }
      if (sortBy === 'avgPkg') {
        const avA = a.medianPkg ?? -1;
        const avB = b.medianPkg ?? -1;
        return (avA - avB) * dir || b.records - a.records;
      }
      if (sortBy === 'yearsSpan') {
        return (a.yearsCount - b.yearsCount) * dir || b.records - a.records;
      }
      // default: 'records'
      return (a.records - b.records) * dir || b.collegesCount - a.collegesCount || a.name.localeCompare(b.name);
    });

    const totalItems = rows.length;
    const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
    if (state.recruiterTable.page > totalPages) state.recruiterTable.page = totalPages;
    const currPage = state.recruiterTable.page;
    const startIdx = (currPage - 1) * pageSize;
    const pageRows = rows.slice(startIdx, startIdx + pageSize);

    // Update Sort Header Indicators
    document.querySelectorAll('[data-sort-col]').forEach((th) => {
      const col = th.getAttribute('data-sort-col');
      const indicator = th.querySelector('.sort-ind');
      const isAct = col === sortBy;
      th.classList.toggle('sorted', isAct);
      if (indicator) {
        indicator.textContent = isAct ? (sortDir === 'asc' ? '↑' : '↓') : '↕';
      }
    });

    const tbody = document.getElementById('recruiterTableBody');
    if (tbody) {
      if (pageRows.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" class="muted-cell" style="text-align:center;padding:24px;">No companies match "${esc(tableSearch)}".</td></tr>`;
      } else {
        tbody.innerHTML = pageRows
          .map((c) => {
            const isExp = expandedCompany === c.rawName;
            const mainRow = `
              <tr class="clickable-row ${isExp ? 'expanded-parent' : ''}" data-expand-company="${esc(c.rawName)}">
                <td class="font-semibold">
                  <button type="button" class="row-expand-btn" data-expand-company="${esc(c.rawName)}" aria-expanded="${isExp}">
                    <span class="exp-chevron">${isExp ? '▾' : '▸'}</span>
                    <span>${esc(c.name)}</span>
                  </button>
                </td>
                <td class="num font-semibold">${fmtInt(c.records)}</td>
                <td class="num">${fmtInt(c.collegesCount)}</td>
                <td>${esc(c.regionsList.join(', '))}</td>
                <td class="num">${esc(c.yearsSpan)}</td>
                <td class="num">${c.pkgCount > 0 ? `${c.medianPkg.toFixed(2)} LPA <span class="muted-inline">(n=${c.pkgCount})</span>` : '<span class="muted-inline">Unreported</span>'}</td>
              </tr>`;

            if (!isExp) return mainRow;

            const detailRowsHtml = c.details
              .map(
                (d) => `
                <tr>
                  <td>${esc(d.college)}</td>
                  <td>${esc(d.region)}</td>
                  <td class="num">${d.year}</td>
                  <td class="num">${d.pkg !== null ? `${d.pkg.toFixed(2)} LPA` : '<span class="muted-inline">Unreported</span>'}</td>
                </tr>`
              )
              .join('');

            const detailRow = `
              <tr class="company-detail-row">
                <td colspan="6">
                  <div class="company-detail-box">
                    <div class="company-detail-hdr">
                      <strong>${esc(c.name)} — Campus Drive Records (${fmtInt(c.records)} records across ${fmtInt(c.collegesCount)} colleges)</strong>
                      <span class="muted-inline">Canonical entity from standardized dataset</span>
                    </div>
                    <div class="table-scroll-mini">
                      <table class="mini-table">
                        <thead>
                          <tr>
                            <th>College Name</th>
                            <th>Region</th>
                            <th class="num">Year</th>
                            <th class="num">Reported Package (LPA)</th>
                          </tr>
                        </thead>
                        <tbody>${detailRowsHtml}</tbody>
                      </table>
                    </div>
                  </div>
                </td>
              </tr>`;
            return mainRow + detailRow;
          })
          .join('');
      }
    }

    // Pagination Info
    const pageInfo = document.getElementById('recruiterPageInfo');
    if (pageInfo) {
      pageInfo.textContent =
        totalItems === 0
          ? '0 companies'
          : `Showing ${fmtInt(startIdx + 1)}–${fmtInt(Math.min(startIdx + pageSize, totalItems))} of ${fmtInt(totalItems)} distinct companies (Page ${currPage} of ${totalPages})`;
    }
    const prevBtn = document.getElementById('recruiterPrevPage');
    const nextBtn = document.getElementById('recruiterNextPage');
    if (prevBtn) prevBtn.disabled = currPage <= 1;
    if (nextBtn) nextBtn.disabled = currPage >= totalPages;
  }

  function renderTrendsSection(analytics) {
    renderTrendsCharts(analytics);

    const tbody = document.getElementById('trendsYearlyTableBody');
    if (tbody) {
      tbody.innerHTML = analytics.yearlyStats
        .map((y) => {
          const hasPkg = y.pkgRecords > 0;
          return `
            <tr>
              <td class="num font-semibold">${y.year}</td>
              <td class="num font-semibold">${fmtInt(y.records)}</td>
              <td class="num">${fmtPct(y.shareOfTotalPct)}</td>
              <td class="num">${fmtInt(y.collegesCount)} / 27</td>
              <td class="num">${fmtInt(y.regionsCount)} / 4</td>
              <td class="num">${fmtInt(y.companiesCount)}</td>
              <td class="num">${fmtInt(y.pkgRecords)} (${fmtPct(y.coveragePct)})</td>
              <td class="num">${hasPkg ? `${y.medianPkg.toFixed(2)} LPA${y.smallSample ? ' *' : ''}` : 'No data'}</td>
              <td class="num">${hasPkg ? `${y.avgPkg.toFixed(2)} LPA${y.smallSample ? ' *' : ''}` : 'No data'}</td>
            </tr>`;
        })
        .join('');
    }
  }

  function renderQualitySection() {
    const p = RAW_DATA.pipeline || {};
    const baselines = RAW_DATA.validationBaselines || [];

    // Compute live field completeness on canonical dataset
    const totalCanon = CANONICAL_RECORDS.length;
    let missComp = 0,
      missCol = 0,
      missReg = 0,
      missYr = 0,
      missPkg = 0;
    const compSet = new Set();
    const colSet = new Set();
    const regSet = new Set();
    const yrCounts = {};

    CANONICAL_RECORDS.forEach((r) => {
      if (!r.company) missComp++;
      else compSet.add(r.company);
      if (!r.college) missCol++;
      else colSet.add(r.college);
      if (!r.region) missReg++;
      else regSet.add(r.region);
      if (!r.year) missYr++;
      else yrCounts[r.year] = (yrCounts[r.year] || 0) + 1;
      if (r.pkg === null) missPkg++;
    });

    const validPkgs = totalCanon - missPkg;
    const pkgCovPct = totalCanon > 0 ? ((validPkgs / totalCanon) * 100).toFixed(2) : '0.00';

    // 1. Render Expected Baselines vs Observed Results Table
    const baselineTbody = document.getElementById('qualityBaselineValidationBody');
    const baselineBadge = document.getElementById('qualityBaselineSummaryBadge');
    if (baselineTbody && baselines.length > 0) {
      const mismatchCount = baselines.filter((b) => !b.matches).length;
      if (baselineBadge) {
        baselineBadge.textContent =
          mismatchCount === 0
            ? `All ${baselines.length} validation targets matched (${mismatchCount} discrepancies)`
            : `WARNING: ${mismatchCount} baseline discrepancy detected`;
      }
      baselineTbody.innerHTML = baselines
        .map((b) => {
          const deltaStr = b.diff === 0 ? '0' : b.diff > 0 ? `+${fmtInt(b.diff)}` : fmtInt(b.diff);
          const statusHtml = b.matches
            ? '<span class="accent-text font-semibold">Matched Expected Baseline</span>'
            : `<span class="caution-inline font-semibold">Discrepancy (${deltaStr} vs target)</span>`;
          return `
            <tr>
              <td class="font-semibold">${esc(b.metric)}</td>
              <td class="num">${fmtInt(b.expected)}</td>
              <td class="num font-semibold">${fmtInt(b.observed)}</td>
              <td class="num">${deltaStr}</td>
              <td>${statusHtml}</td>
            </tr>`;
        })
        .join('');
    }

    // 2. Render Dynamic Funnel
    const funnelBadge = document.getElementById('qualityFunnelBadge');
    if (funnelBadge && p.raw) {
      funnelBadge.textContent = `${fmtInt(p.raw)} raw → ${fmtInt(p.clean)} cleaned → ${fmtInt(p.final)} canonical records`;
    }

    const funnelEl = document.getElementById('qualityFunnelContainer');
    if (funnelEl && p.raw) {
      const stages = [
        {
          stage: '01. Raw Master Input (placement_companies.csv)',
          rows: p.raw,
          pct: 100,
          detail: `Unmodified master list across ${colSet.size} colleges. Contains ${p.headerJunk} leaked header rows and ${fmtInt(p.exactDuplicatesRemoved)} exact duplicate records.`
        },
        {
          stage: '02. Initial Cleaning & Text Normalization (01_clean_data.py)',
          rows: p.clean,
          pct: Number(((p.clean / p.raw) * 100).toFixed(1)),
          detail: `Removed ${p.headerJunk} leaked header rows ("NAME OF COMPANY") and ${fmtInt(p.exactDuplicatesRemoved)} exact duplicate records; joined explicit-unit salary from variation_3.csv (${fmtInt(validPkgs)} matched).`
        },
        {
          stage: '03. Rule-Based Company Name Reconciliation (02 & 03 scripts)',
          rows: p.final,
          pct: Number(((p.final / p.raw) * 100).toFixed(1)),
          detail: `Generated ${fmtInt(p.mappingsProposed)} candidate merges (${fmtInt(p.tier1Proposed)} Tier-1 + ${fmtInt(p.tier2Proposed)} Tier-2), excluded ${fmtInt(p.excludedProposedPairs)} pairs via the ${fmtInt(p.riskySetSize)}-term RISKY set, applied ${fmtInt(p.mappingsApplied)} variant merges + ${fmtInt(p.manualFixes)} FIX dictionary rules (${fmtInt(p.companiesBeforeMerge)} → ${fmtInt(p.companiesAfterMerge)} companies), and removed ${fmtInt(p.postMergeDuplicatesRemoved)} post-merge duplicates.`
        }
      ];

      funnelEl.innerHTML = stages
        .map(
          (s) => `
          <div class="funnel-row">
            <div class="funnel-meta">
              <div class="funnel-title">${esc(s.stage)}</div>
              <div class="funnel-desc">${esc(s.detail)}</div>
            </div>
            <div class="funnel-bar-wrap">
              <div class="funnel-bar" style="width:${Math.max(s.pct, 25)}%">
                <span>${fmtInt(s.rows)} records (${s.pct}%)</span>
              </div>
            </div>
          </div>`
        )
        .join('');
    }

    // 3. Render Live Computed Field-Level Completeness Audit
    const fieldBadge = document.getElementById('qualityFieldAuditBadge');
    if (fieldBadge) {
      fieldBadge.textContent = `Audited on data/processed/placements_final.csv (n = ${fmtInt(totalCanon)})`;
    }

    const yrsSorted = Object.keys(yrCounts).map(Number).sort((a, b) => a - b);
    const yrRangeStr = yrsSorted.length > 0 ? `${yrsSorted[0]}–${yrsSorted[yrsSorted.length - 1]}` : '—';
    const peakYr = yrsSorted.length > 0 ? yrsSorted.reduce((a, b) => (yrCounts[a] > yrCounts[b] ? a : b)) : null;

    const auditGrid = document.getElementById('qualityFieldAuditBody');
    if (auditGrid) {
      const fields = [
        {
          field: 'name of company',
          valid: totalCanon - missComp,
          missing: missComp,
          note: `Reconciled from ${fmtInt(p.companiesBeforeMerge)} raw spellings to ${fmtInt(compSet.size)} distinct canonical companies.`
        },
        {
          field: 'college name',
          valid: totalCanon - missCol,
          missing: missCol,
          note: `${fmtInt(colSet.size)} distinct engineering colleges represented across Mumbai & Pune.`
        },
        {
          field: 'region',
          valid: totalCanon - missReg,
          missing: missReg,
          note: `${fmtInt(regSet.size)} normalized regions (${Array.from(regSet).map(formatDisplayName).join(', ')}).`
        },
        {
          field: 'year',
          valid: totalCanon - missYr,
          missing: missYr,
          note: `Integer years spanning ${yrRangeStr}${peakYr ? `; highest concentration in ${peakYr} (${fmtInt(yrCounts[peakYr])} records)` : ''}.`
        },
        {
          field: 'package_lpa',
          valid: validPkgs,
          missing: missPkg,
          note: `${pkgCovPct}% populated (${fmtInt(validPkgs)} valid numeric LPA records; ${fmtInt(missPkg)} missing values kept as null, never zero).`
        }
      ];
      auditGrid.innerHTML = fields
        .map((f) => {
          const cov = totalCanon > 0 ? ((f.valid / totalCanon) * 100).toFixed(2) : '0.00';
          return `
            <tr>
              <td class="font-mono font-semibold">${esc(f.field)}</td>
              <td class="num">${fmtInt(f.valid)}</td>
              <td class="num">${fmtInt(f.missing)}</td>
              <td class="num font-semibold">${cov}%</td>
              <td>${esc(f.note)}</td>
            </tr>`;
        })
        .join('');
    }

    // 4. Render Raw Source Files Inventory with Observed Column Schemas
    const rawTbody = document.getElementById('qualityRawFilesBody');
    if (rawTbody && RAW_DATA.rawFiles) {
      rawTbody.innerHTML = RAW_DATA.rawFiles
        .map(
          (rf) => `
          <tr>
            <td class="font-mono font-semibold">${esc(rf.file)}</td>
            <td class="num">${fmtInt(rf.rows)}</td>
            <td class="font-mono muted-inline">${esc(rf.columns || '—')}</td>
            <td class="font-semibold">${esc(rf.status)}</td>
            <td>${esc(rf.note)}</td>
          </tr>`
        )
        .join('');
    }

    // 5. Render Algorithmic & Rule-Based Company Merge Summary
    const mergeBadge = document.getElementById('qualityMergeSummaryBadge');
    if (mergeBadge && p.companiesBeforeMerge) {
      mergeBadge.textContent = `${fmtInt(p.companiesBeforeMerge)} raw names → ${fmtInt(p.companiesAfterMerge)} canonical entities (${fmtInt(p.mappingsApplied)} applied · ${fmtInt(p.excludedProposedPairs)} excluded · ${fmtInt(p.manualFixes)} manual fixes)`;
    }

    const mergeTbody = document.getElementById('qualityMergesBody');
    if (mergeTbody && RAW_DATA.sampleMerges) {
      mergeTbody.innerHTML = RAW_DATA.sampleMerges
        .map(
          (m) => `
          <tr>
            <td class="font-mono">${esc(m.variant)}</td>
            <td class="font-mono font-semibold">${esc(m.canonical)}</td>
            <td>${esc(m.type)}</td>
            <td>${esc(m.reason)}</td>
          </tr>`
        )
        .join('');
    }
  }

  // Initialize Controls & Event Listeners
  function initApp() {
    // Populate College Select Dropdown with all 27 canonical colleges
    const colSelect = document.getElementById('filterCollegeSelect');
    if (colSelect) {
      const countsByCol = {};
      CANONICAL_RECORDS.forEach((r) => {
        countsByCol[r.college] = (countsByCol[r.college] || 0) + 1;
      });
      const optionsHtml =
        `<option value="ALL">All 27 Engineering Colleges (${fmtInt(CANONICAL_RECORDS.length)} records)</option>` +
        COLLEGES_LIST.map(
          (col) => `<option value="${esc(col)}">${esc(formatDisplayName(col))} (${countsByCol[col] || 0})</option>`
        ).join('');
      colSelect.innerHTML = optionsHtml;

      colSelect.addEventListener('change', (e) => {
        state.filters.college = e.target.value;
        state.recruiterTable.page = 1;
        renderApp();
      });
    }

    // Populate Author / Profile links in Sidebar Footer if configured in assets/config.js
    const normalizeUrl = (u) => {
      const s = String(u || '').trim();
      if (!s) return '';
      return /^https?:\/\//i.test(s) ? s : `https://${s}`;
    };
    const authorContainer = document.getElementById('sidebarAuthorLinks');
    if (authorContainer) {
      const parts = [];
      if (SITE_CONFIG.author && SITE_CONFIG.author.trim()) {
        parts.push(`<span>By ${esc(SITE_CONFIG.author.trim())}</span>`);
      }
      const ghUrl = normalizeUrl(SITE_CONFIG.github);
      if (ghUrl) {
        parts.push(`<a href="${esc(ghUrl)}" target="_blank" rel="noopener">GitHub</a>`);
      }
      const liUrl = normalizeUrl(SITE_CONFIG.linkedin);
      if (liUrl) {
        parts.push(`<a href="${esc(liUrl)}" target="_blank" rel="noopener">LinkedIn</a>`);
      }
      if (parts.length > 0) {
        authorContainer.innerHTML = parts.join(' <span aria-hidden="true">·</span> ');
      } else {
        authorContainer.innerHTML = '<span>B.Tech Data Analytics Portfolio</span> <span aria-hidden="true">·</span> <span>2014–2018 Dataset</span>';
      }
    }

    // Navigation Clicks (Sidebar + Mobile Drawer)
    document.querySelectorAll('[data-nav-section]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const target = btn.getAttribute('data-nav-section');
        if (target) {
          state.activeSection = target;
          document.body.classList.remove('mobile-nav-open');
          renderApp();
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }
      });
    });

    // Mobile Menu Drawer Toggle
    const mobileMenuBtn = document.getElementById('mobileMenuBtn');
    const mobileBackdrop = document.getElementById('mobileNavBackdrop');
    if (mobileMenuBtn) {
      mobileMenuBtn.addEventListener('click', () => {
        document.body.classList.toggle('mobile-nav-open');
      });
    }
    if (mobileBackdrop) {
      mobileBackdrop.addEventListener('click', () => {
        document.body.classList.remove('mobile-nav-open');
      });
    }

    // Theme Toggle
    const themeBtn = document.getElementById('themeToggleBtn');
    if (themeBtn) {
      themeBtn.addEventListener('click', () => {
        state.theme = state.theme === 'dark' ? 'light' : 'dark';
        localStorage.setItem('cpi_theme', state.theme);
        renderApp();
      });
    }

    // Year Filter Multi-Select Buttons
    document.querySelectorAll('[data-filter-year]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const val = btn.getAttribute('data-filter-year');
        if (val === 'ALL') {
          state.filters.years.clear();
        } else {
          const yr = Number(val);
          if (state.filters.years.has(yr)) {
            state.filters.years.delete(yr);
          } else {
            state.filters.years.add(yr);
          }
        }
        state.recruiterTable.page = 1;
        renderApp();
      });
    });

    // Region Filter Multi-Select Buttons
    document.querySelectorAll('[data-filter-region]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const val = btn.getAttribute('data-filter-region');
        if (val === 'ALL') {
          state.filters.regions.clear();
        } else {
          if (state.filters.regions.has(val)) {
            state.filters.regions.delete(val);
          } else {
            state.filters.regions.add(val);
          }
        }
        state.recruiterTable.page = 1;
        renderApp();
      });
    });

    // Package Only Toggle
    const pkgOnlyBtn = document.getElementById('filterPkgOnlyBtn');
    if (pkgOnlyBtn) {
      pkgOnlyBtn.addEventListener('click', () => {
        state.filters.pkgOnly = !state.filters.pkgOnly;
        state.recruiterTable.page = 1;
        renderApp();
      });
    }

    // Global Company / Keyword Search Input
    const searchInput = document.getElementById('globalSearchInput');
    const clearSearchBtn = document.getElementById('clearGlobalSearchBtn');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        state.filters.search = e.target.value;
        if (clearSearchBtn) clearSearchBtn.hidden = state.filters.search.length === 0;
        state.recruiterTable.page = 1;
        renderApp();
      });
    }
    if (clearSearchBtn) {
      clearSearchBtn.addEventListener('click', () => {
        state.filters.search = '';
        if (searchInput) searchInput.value = '';
        clearSearchBtn.hidden = true;
        state.recruiterTable.page = 1;
        renderApp();
      });
    }

    // Reset Filters Buttons
    const resetAllFilters = () => {
      state.filters.years.clear();
      state.filters.regions.clear();
      state.filters.college = 'ALL';
      state.filters.search = '';
      state.filters.pkgOnly = false;
      if (searchInput) searchInput.value = '';
      if (clearSearchBtn) clearSearchBtn.hidden = true;
      if (colSelect) colSelect.value = 'ALL';
      state.recruiterTable.page = 1;
      renderApp();
    };

    document.querySelectorAll('[data-action="reset-filters"]').forEach((btn) => {
      btn.addEventListener('click', resetAllFilters);
    });

    // Individual Active Filter Tag Removal
    const activeTagsContainer = document.getElementById('activeFilterTags');
    if (activeTagsContainer) {
      activeTagsContainer.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-clear-filter]');
        if (!btn) return;
        const act = btn.getAttribute('data-clear-filter');
        if (act === 'clear-years') state.filters.years.clear();
        if (act === 'clear-regions') state.filters.regions.clear();
        if (act === 'clear-college') {
          state.filters.college = 'ALL';
          if (colSelect) colSelect.value = 'ALL';
        }
        if (act === 'clear-search') {
          state.filters.search = '';
          if (searchInput) searchInput.value = '';
          if (clearSearchBtn) clearSearchBtn.hidden = true;
        }
        if (act === 'clear-pkg') state.filters.pkgOnly = false;
        state.recruiterTable.page = 1;
        renderApp();
      });
    }

    // Overview Company Ranking Criterion Selector
    document.querySelectorAll('[data-overview-rank]').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.overviewCompanyRankBy = btn.getAttribute('data-overview-rank') || 'records';
        renderApp();
      });
    });

    // Recruiter Analysis Ranking Criterion Selector
    document.querySelectorAll('[data-recruiter-rank]').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.recruiterChartRankBy = btn.getAttribute('data-recruiter-rank') || 'records';
        renderApp();
      });
    });

    // College Salary Table Sort Selector
    const colSortSelect = document.getElementById('collegeSalarySortSelect');
    if (colSortSelect) {
      colSortSelect.addEventListener('change', (e) => {
        state.collegeSalarySortBy = e.target.value;
        renderApp();
      });
    }

    // Recruiter Table Search, Sort, Pagination & Expandable Rows
    const recTableSearch = document.getElementById('recruiterTableSearchInput');
    if (recTableSearch) {
      recTableSearch.addEventListener('input', (e) => {
        state.recruiterTable.tableSearch = e.target.value;
        state.recruiterTable.page = 1;
        renderRecruiterTable(computeAnalytics());
      });
    }

    document.querySelectorAll('[data-sort-col]').forEach((th) => {
      th.addEventListener('click', () => {
        const col = th.getAttribute('data-sort-col');
        if (state.recruiterTable.sortBy === col) {
          state.recruiterTable.sortDir = state.recruiterTable.sortDir === 'asc' ? 'desc' : 'asc';
        } else {
          state.recruiterTable.sortBy = col;
          state.recruiterTable.sortDir = col === 'name' ? 'asc' : 'desc';
        }
        state.recruiterTable.page = 1;
        renderRecruiterTable(computeAnalytics());
      });
    });

    const prevPageBtn = document.getElementById('recruiterPrevPage');
    const nextPageBtn = document.getElementById('recruiterNextPage');
    if (prevPageBtn) {
      prevPageBtn.addEventListener('click', () => {
        if (state.recruiterTable.page > 1) {
          state.recruiterTable.page -= 1;
          renderRecruiterTable(computeAnalytics());
        }
      });
    }
    if (nextPageBtn) {
      nextPageBtn.addEventListener('click', () => {
        state.recruiterTable.page += 1;
        renderRecruiterTable(computeAnalytics());
      });
    }

    const pageSizeSelect = document.getElementById('recruiterPageSizeSelect');
    if (pageSizeSelect) {
      pageSizeSelect.addEventListener('change', (e) => {
        state.recruiterTable.pageSize = Number(e.target.value) || 15;
        state.recruiterTable.page = 1;
        renderRecruiterTable(computeAnalytics());
      });
    }

    const recTbody = document.getElementById('recruiterTableBody');
    if (recTbody) {
      recTbody.addEventListener('click', (e) => {
        const trigger = e.target.closest('[data-expand-company]');
        if (!trigger) return;
        const compName = trigger.getAttribute('data-expand-company');
        state.recruiterTable.expandedCompany = state.recruiterTable.expandedCompany === compName ? null : compName;
        renderRecruiterTable(computeAnalytics());
      });
    }

    // Export Buttons
    const exportCsvBtn = document.getElementById('exportFilteredCsvBtn');
    if (exportCsvBtn) {
      exportCsvBtn.addEventListener('click', () => {
        exportFilteredRecordsCsv(computeAnalytics());
      });
    }

    const exportRecSummaryBtn = document.getElementById('exportRecruiterSummaryBtn');
    if (exportRecSummaryBtn) {
      exportRecSummaryBtn.addEventListener('click', () => {
        exportRecruiterSummaryCsv(computeAnalytics());
      });
    }

    // Initial Render
    renderApp();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
  } else {
    initApp();
  }
})();
