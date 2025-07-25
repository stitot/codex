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


const monthRange = (fromMonth, toMonth) => {
  const months = [];
  const start = parseMonth(fromMonth);
  const end = parseMonth(toMonth);
  for (let cur = start; cur <= end; cur.setUTCMonth(cur.getUTCMonth() + 1)) {
    months.push(formatMonth(cur));
  }
  return months;
};

const getOptimizedJsDelivrRanges = (fromMonth, toMonth, today = new Date()) =>
  monthRange(fromMonth, toMonth).map((m) =>
    m === formatMonth(today) ? "month" : m
  );


const computeMovingAverage = (data, window = 7) =>
  data.map(([, val], i) => {
    const windowData = data.slice(Math.max(0, i - window + 1), i + 1);
    const avg = windowData.reduce((sum, [, v]) => sum + v, 0) / windowData.length;
    return [data[i][0], Math.round(avg)];
  });

const toHighcharts = (arr) => arr.map(([d, v]) => [Date.parse(d), v]);

const fetchSplitStats = async (fromMonth, toMonth) => {
  const jsdelivrRanges = getOptimizedJsDelivrRanges(fromMonth, toMonth);
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
          jsdelivr.push([date, downloads / 2]);
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

  return { jsdelivr, npm, versions };
};

const renderChart = async (fromMonth, toMonth) => {
  const button = document.getElementById("confirm-range");
  const lastUpdated = document.getElementById("last-updated");
  button.disabled = true;
  lastUpdated.textContent = "Loading...";

  const { jsdelivr, npm, versions } = await fetchSplitStats(fromMonth, toMonth);

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

  Highcharts.setOptions({ colors: ["blue", "red"] });

  Highcharts.chart("container-total", {
    plotOptions: {
      series: { shadow: true, marker: { enabled: false } },
    },
    xAxis: {
      type: "datetime",
      plotLines: plotlines,
    },
    yAxis: [{ title: { text: "NPM", style: { color: "blue" } } }, { title: { text: "jsDelivr", style: { color: "red" } }, opposite: true }],
    series: [
      { name: "NPM avg", data: toHighcharts(computeMovingAverage(npm)), yAxis: 0, zIndex: 4 },
      { name: "jsDelivr avg", data: toHighcharts(computeMovingAverage(jsdelivr)), yAxis: 1, zIndex: 3 },
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

  lastUpdated.textContent = `Last updated: ${new Date().toLocaleString()}`;
  button.disabled = false;
};

document.getElementById("confirm-range").addEventListener("click", () => {
  const from = document.getElementById("from-month").value;
  const to = document.getElementById("to-month").value;

  if (from && to && from <= to) {
    renderChart(from, to);
  } else {
    alert("Please select a valid month range.");
  }
});

// Set default to last 6 full months
const today = new Date();
const thisMonth = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
const fromDate = new Date(thisMonth);
fromDate.setUTCMonth(fromDate.getUTCMonth() - 5);
const defaultFrom = formatMonth(fromDate);
const defaultTo = formatMonth(thisMonth);

document.getElementById("from-month").value = defaultFrom;
document.getElementById("to-month").value = defaultTo;
renderChart(defaultFrom, defaultTo);
