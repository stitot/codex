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

const toEpochDay = (dateStr) => {
  const d = new Date(dateStr);
  d.setUTCHours(0, 0, 0, 0);
  return d.getTime();
};

const dateToISO = (d) => d.toISOString().slice(0, 10);

const getNpmPublishDates = async () => {
  const url = `${BASES.npmRegistry}/${encodeURIComponent(PACKAGE)}`;
  const data = await fetchJson(url, "npm registry");
  return Object.entries(data.time)
    .filter(([k]) => k !== "created" && k !== "modified")
    .reduce((acc, [ver, date]) => ({ ...acc, [ver]: toEpochDay(date) }), {});
};

const fetchJsDelivrDownloads = async (range) => {
  const url = `${BASES.jsDelivr}/${encodeURIComponent(PACKAGE)}?period=${range}`;
  const data = await fetchJson(url, "jsDelivr");
  return Object.entries(data?.hits?.dates || {}).map(([date, downloads]) => ({ date, downloads }));
};

const fetchNpmDownloads = async (fromMonth, toMonth) => {
  const [startISO, endISO] = getISODateRange(fromMonth, toMonth);
  const dateRanges = splitDateRange(startISO, endISO);
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

const getISODateRange = (fromMonth, toMonth) => {
  const start = new Date(`${fromMonth}-01`);
  const end = new Date(new Date(`${toMonth}-01`).getFullYear(), new Date(`${toMonth}-01`).getMonth() + 1, 0);
  return [dateToISO(start), dateToISO(end)];
};

const splitDateRange = (start, end, maxDays = 360) => {
  const results = [];
  let current = new Date(start);
  const endDate = new Date(end);

  while (current <= endDate) {
    const segmentStart = new Date(current);
    const segmentEnd = new Date(current);
    segmentEnd.setDate(segmentEnd.getDate() + maxDays);
    if (segmentEnd > endDate) segmentEnd.setTime(endDate.getTime());

    results.push([dateToISO(segmentStart), dateToISO(segmentEnd)]);
    current = new Date(segmentEnd);
    current.setDate(current.getDate() + 1);
  }

  return results;
};

const getOptimizedJsDelivrRanges = (fromMonth, toMonth, today = new Date()) => {
  const ranges = [];
  let current = new Date(`${fromMonth}-01T00:00:00Z`);
  const to = new Date(`${toMonth}-01T00:00:00Z`);

  while (current <= to) {
    const y = current.getUTCFullYear();
    const m = current.getUTCMonth() + 1;
    const isCurrentMonth = y === today.getUTCFullYear() && m === today.getUTCMonth() + 1;
    ranges.push(isCurrentMonth ? "month" : `${y}-${String(m).padStart(2, "0")}`);
    current.setUTCMonth(current.getUTCMonth() + 1);
  }

  return [...new Set(ranges)];
};

// const getOptimizedJsDelivrRanges = (fromMonth, toMonth, today = new Date()) => {
//   const ranges = [];
//   let [y, m] = fromMonth.split("-").map(Number);
//   const [toY, toM] = toMonth.split("-").map(Number);
//   const currY = today.getFullYear();
//   const currM = today.getMonth() + 1;

//   const isBeforeEq = (y1, m1, y2, m2) => y1 < y2 || (y1 === y2 && m1 <= m2);
//   const isSame = (y1, m1, y2, m2) => y1 === y2 && m1 === m2;

//   if (isSame(y, m, toY, toM)) return [y === currY && m === currM ? "month" : "s-month"];

//   while (isBeforeEq(y, m, toY, toM)) {
//     if (y === currY && m === currM) {
//       ranges.push("month");
//       break;
//     }

//     if (m === 1 && isBeforeEq(y + 1, 0, toY, toM) && !(y + 1 === currY && 1 === currM)) {
//       ranges.push(`${y}`);
//       y++;
//       continue;
//     }

//     const q = Math.floor((m - 1) / 3) + 1;
//     const qStart = (q - 1) * 3 + 1;
//     const qEnd = q * 3;

//     if (m === qStart && isBeforeEq(y, qEnd, toY, toM) && !(y === currY && qEnd >= currM)) {
//       ranges.push(`${y}-Q${q}`);
//       m += 3;
//       if (m > 12) {
//         y++;
//         m -= 12;
//       }
//       continue;
//     }

//     ranges.push(`${y}-${String(m).padStart(2, "0")}`);
//     m++;
//     if (m > 12) {
//       y++;
//       m = 1;
//     }
//   }

//   return ranges;
// };

const computeMovingAverage = (data, window = 7) =>
  data.map(([, val], i) => {
    const windowData = data.slice(Math.max(0, i - window + 1), i + 1);
    const avg = windowData.reduce((sum, [, v]) => sum + v, 0) / windowData.length;
    return [data[i][0], Math.round(avg)];
  });

const fetchSplitStats = async (fromMonth, toMonth) => {
  const jsdelivrRanges = getOptimizedJsDelivrRanges(fromMonth, toMonth);
  const seenJsDelivr = new Set();
  const seenNpm = new Set();
  const jsdelivr = [],
    npm = [];
  const versions = await getNpmPublishDates();
  const today = new Date();

  for (const r of jsdelivrRanges) {
    try {
      const downloads = await fetchJsDelivrDownloads(r);
      const filtered = r === "month" ? downloads.filter((d) => new Date(d.date) >= new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1))) : downloads;
      filtered.forEach(({ date, downloads }) => {
        if (!seenJsDelivr.has(date)) {
          seenJsDelivr.add(date);
          jsdelivr.push([toEpochDay(date), downloads / 2]);
        }
      });
    } catch (e) {
      console.warn(`Skipping jsDelivr ${r}: ${e.message}`);
    }
  }

  const maxJsDelivrEpoch = Math.max(...jsdelivr.map(([ts]) => ts));
  const npmRaw = await fetchNpmDownloads(fromMonth, toMonth);
  npmRaw.forEach(({ date, downloads }) => {
    const ts = toEpochDay(date);
    if (!seenNpm.has(date) && ts <= maxJsDelivrEpoch) {
      seenNpm.add(date);
      npm.push([ts, downloads]);
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
    value: time,
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
      { name: "NPM avg", data: computeMovingAverage(npm), yAxis: 0, zIndex: 4 },
      { name: "jsDelivr avg", data: computeMovingAverage(jsdelivr), yAxis: 1, zIndex: 3 },
      {
        name: "NPM accurate",
        data: npm,
        yAxis: 0,
        color: "blue",
        opacity: 0.1,
        zIndex: 2,
        states: { hover: { opacity: 1 } },
      },
      {
        name: "jsDelivr accurate",
        data: jsdelivr,
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
const now = new Date();
const thisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
const fromDate = new Date(thisMonth);
fromDate.setMonth(fromDate.getMonth() - 5);
const defaultFrom = `${fromDate.getFullYear()}-${String(fromDate.getMonth() + 1).padStart(2, "0")}`;
const defaultTo = `${thisMonth.getFullYear()}-${String(thisMonth.getMonth() + 1).padStart(2, "0")}`;

document.getElementById("from-month").value = defaultFrom;
document.getElementById("to-month").value = defaultTo;
renderChart(defaultFrom, defaultTo);
