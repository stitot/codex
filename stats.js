const BASES = {
  jsDelivr: "https://data.jsdelivr.com/v1/stats/packages/npm",
  npmRange: "https://api.npmjs.org/downloads/range",
  npmRegistry: "https://registry.npmjs.org",
};
const PACKAGE = "@highcharts/grid-lite";

const fetchJson = async (url, label) => {
  console.log(label, url);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${label} fetch failed`);
  return res.json();
};

const isoDate = (d) => d.toISOString().slice(0, 10);
const toISODate = (dateStr) => isoDate(new Date(dateStr));

const parseMonth = (m) => {
  const [y, mo] = m.split("-").map(Number);
  return new Date(Date.UTC(y, mo - 1, 1));
};

const formatMonth = (d) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;

const monthRange = (fromMonth, toMonth) => {
  const months = [];
  const start = parseMonth(fromMonth);
  const end = parseMonth(toMonth);
  for (let cur = start; cur <= end; cur.setUTCMonth(cur.getUTCMonth() + 1)) {
    months.push(formatMonth(cur));
  }
  return months;
};

const addDays = (d, days) => new Date(d.getTime() + days * 864e5);

const getNpmPublishDates = async () => {
  const url = `${BASES.npmRegistry}/${encodeURIComponent(PACKAGE)}`;
  const data = await fetchJson(url, "npm registry");
  return Object.entries(data.time)
    .filter(([k]) => k !== "created" && k !== "modified")
    .reduce((acc, [ver, date]) => ({ ...acc, [ver]: toISODate(date) }), {});
};

const fetchJsDelivrDownloads = async (range) => {
  const url = `${BASES.jsDelivr}/${encodeURIComponent(PACKAGE)}?period=${range}`;
  const data = await fetchJson(url, "jsDelivr");
  return Object.entries(data?.hits?.dates || {}).map(([date, downloads]) => ({ date, downloads }));
};

const getNpmDateRanges = (fromMonth, toMonth, maxDays = 360) => {
  const start = parseMonth(fromMonth);
  const end = parseMonth(toMonth);
  end.setUTCMonth(end.getUTCMonth() + 1);
  end.setUTCDate(0);

  const ranges = [];
  for (let cur = new Date(start); cur <= end; ) {
    const stop = addDays(cur, maxDays);
    const rangeEnd = stop > end ? new Date(end) : stop;
    ranges.push([isoDate(cur), isoDate(rangeEnd)]);
    cur = addDays(rangeEnd, 1);
  }

  return ranges;
};

const fetchNpmDownloads = async (fromMonth, toMonth) => {
  const dateRanges = getNpmDateRanges(fromMonth, toMonth);
  const results = [];

  for (const [start, end] of dateRanges) {
    try {
      const url = `${BASES.npmRange}/${start}:${end}/${encodeURIComponent(PACKAGE)}`;
      const data = await fetchJson(url, "npm");
      results.push(...(data.downloads?.map(({ day, downloads }) => ({ date: day, downloads })) || []));
    } catch (e) {
      console.warn(`Skipping npm range ${start}:${end}: ${e.message}`);
    }
  }

  return results;
};

const getOptimizedJsDelivrRanges = (fromMonth, toMonth, today = new Date()) => {
  const rawMonths = monthRange(fromMonth, toMonth);
  const currentMonth = formatMonth(today);
  const result = [];

  const quarters = {
    Q1: ["01", "02", "03"],
    Q2: ["04", "05", "06"],
    Q3: ["07", "08", "09"],
    Q4: ["10", "11", "12"],
  };

  let i = 0;
  while (i < rawMonths.length) {
    const [year, month] = rawMonths[i].split("-");
    const quarterKey = Object.keys(quarters).find((q) => quarters[q].includes(month));
    const quarterMonths = quarters[quarterKey].map((m) => `${year}-${m}`);

    const isFullQuarter = quarterMonths.every((m) => rawMonths.includes(m));
    if (isFullQuarter) {
      result.push(`${year}-${quarterKey}`);
      i += 3;
    } else {
      const m = rawMonths[i];
      result.push(m === currentMonth ? "month" : m);
      i++;
    }
  }

  return result;
};

const computeMovingAverage = (data, window = 7) =>
  data.map(([, val], i) => {
    const windowData = data.slice(Math.max(0, i - window + 1), i + 1);
    const avg = windowData.reduce((sum, [, v]) => sum + v, 0) / windowData.length;
    return [data[i][0], Math.round(avg)];
  });

const toHighcharts = (arr) => arr.map(([d, v]) => [Date.parse(d), v]);

const fetchSplitStats = async (fromDate, toDate) => {
  const fromMonth = fromDate.slice(0, 7);
  const toMonth = toDate.slice(0, 7);
  const jsdelivrRanges = getOptimizedJsDelivrRanges(fromMonth, toMonth);
  console.log(jsdelivrRanges);
  const seenJsDelivr = new Set();
  const seenNpm = new Set();
  const jsdelivr = [],
    npm = [];
  const versions = await getNpmPublishDates();
  const today = new Date();
  const monthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));

  for (const r of jsdelivrRanges) {
    try {
      const downloads = await fetchJsDelivrDownloads(r);
      const filtered = r === "month" ? downloads.filter((d) => new Date(d.date) >= monthStart) : downloads;
      filtered.forEach(({ date, downloads }) => {
        if (!seenJsDelivr.has(date)) {
          seenJsDelivr.add(date);
          jsdelivr.push([date, Math.round(downloads / 2)]);
        }
      });
    } catch (e) {
      console.warn(`Skipping jsDelivr ${r}: ${e.message}`);
    }
  }

  const maxJsDelivrDate = jsdelivr.reduce((max, [d]) => (d > max ? d : max), "1970-01-01");
  const npmRaw = await fetchNpmDownloads(fromMonth, toMonth);
  npmRaw.forEach(({ date, downloads }) => {
    if (!seenNpm.has(date) && date <= maxJsDelivrDate) {
      seenNpm.add(date);
      npm.push([date, downloads]);
    }
  });

  const filteredJsDelivr = jsdelivr.filter(([d]) => d >= fromDate && d <= toDate);
  const filteredNpm = npm.filter(([d]) => d >= fromDate && d <= toDate);

  return { jsdelivr: filteredJsDelivr, npm: filteredNpm, versions };
};

const renderChart = async (fromDate, toDate) => {
  const button = document.getElementById("confirm-range");
  const lastUpdated = document.getElementById("last-updated");
  button.disabled = true;
  lastUpdated.textContent = "Loading...";

  const { jsdelivr, npm, versions } = await fetchSplitStats(fromDate, toDate);

  const plotlines = Object.entries(versions).map(([ver, time]) => ({
    value: Date.parse(time),
    color: "#444",
    dashStyle: "Dash",
    label: {
      text: ver,
      x: 7,
      style: { fontSize: "10px", color: "#444" },
    },
  }));

  const chart = Highcharts.chart("container-total", {
    plotOptions: {
      series: { shadow: true, marker: { enabled: false } },
    },
    xAxis: {
      type: "datetime",
      plotLines: plotlines,
    },
    yAxis: [{ title: { text: "NPM", style: { color: "blue" } } }, { title: { text: "jsDelivr", style: { color: "red" } }, opposite: true }],
    series: [
      {
        name: "NPM avg",
        data: toHighcharts(computeMovingAverage(npm)),
        yAxis: 0,
        color: "blue",
        zIndex: 4,
      },
      {
        name: "jsDelivr avg",
        data: toHighcharts(computeMovingAverage(jsdelivr)),
        yAxis: 1,
        color: "red",
        zIndex: 3,
      },
      {
        name: "NPM accurate",
        data: toHighcharts(npm),
        yAxis: 0,
        color: "blue",
        opacity: 0.1,
        zIndex: 2,
        states: { hover: { opacity: 1 } },
      },
      {
        name: "jsDelivr accurate",
        data: toHighcharts(jsdelivr),
        yAxis: 1,
        color: "red",
        opacity: 0.1,
        zIndex: 1,
        states: { hover: { opacity: 1 } },
      },
    ],
  });

  console.log(chart.getOptions());

  lastUpdated.textContent = `Last updated: ${new Date().toLocaleString()}`;
  button.disabled = false;
};

document.getElementById("confirm-range").addEventListener("click", () => {
  const from = document.getElementById("from-date").value;
  const to = document.getElementById("to-date").value;

  if (from && to && from <= to) {
    renderChart(from, to);
  } else {
    alert("Please select a valid date range.");
  }
});

// Set default to last 6 months
const today = new Date();
const thisMonth = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
const fromDate = new Date(thisMonth);
fromDate.setUTCMonth(fromDate.getUTCMonth() - 5);
const defaultFrom = isoDate(fromDate);
const defaultTo = isoDate(today);

document.getElementById("from-date").value = defaultFrom;
document.getElementById("to-date").value = defaultTo;
renderChart(defaultFrom, defaultTo);
