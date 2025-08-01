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

const getNpmPackages = async () => {
  const url = `${BASES.npmRegistry}/-/v1/search?text=highcharts}`;
  const data = await fetchJson(url, "npm packages");
  return data.objects.filter((obj) => obj.package.maintainers?.some((m) => m.email?.includes("@highsoft.com"))).map((obj) => obj.package.name);
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
  data.map(([], i) => {
    const windowData = data.slice(Math.max(0, i - window + 1), i + 1);
    const avg = windowData.reduce((sum, [, v]) => sum + v, 0) / windowData.length;
    return [data[i][0], Math.round(avg)];
  });

const toHighcharts = (arr) => arr.map(([d, v]) => [Date.parse(d), v]);

const fetchSplitStats = async (fromDate, toDate) => {
  const fromMonth = fromDate.slice(0, 7);
  const toMonth = toDate.slice(0, 7);
  const jsdelivrRanges = getOptimizedJsDelivrRanges(fromMonth, toMonth);
  const jsDelivrMap = new Map();
  const npmMap = new Map();
  const today = new Date();
  const monthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));

  for (const r of jsdelivrRanges) {
    try {
      const raw = await fetchJsDelivrDownloads(r);
      let entries = r === "month" ? raw.filter((d) => new Date(d.date) >= monthStart) : raw;

      if (r !== "month" && entries.every((d) => d.downloads === 0)) {
        const monthData = await fetchJsDelivrDownloads("month");
        entries = monthData.filter((d) => d.date >= fromDate && d.date <= toDate);
      }

      for (const { date, downloads } of entries) {
        if (!jsDelivrMap.has(date)) {
          jsDelivrMap.set(date, Math.round(downloads / 2));
        }
      }
    } catch (e) {
      console.warn(`Skipping jsDelivr ${r}: ${e.message}`);
    }
  }

  const jsdelivr = Array.from(jsDelivrMap.entries())
    .filter(([d]) => d >= fromDate && d <= toDate)
    .sort((a, b) => a[0].localeCompare(b[0]));

  const maxJsDelivrDate = jsdelivr.length ? jsdelivr[jsdelivr.length - 1][0] : "1970-01-01";

  try {
    const npmRaw = await fetchNpmDownloads(fromMonth, toMonth);
    for (const { date, downloads } of npmRaw) {
      if (date < fromDate || date > toDate || date > maxJsDelivrDate) continue;
      if (!npmMap.has(date)) npmMap.set(date, downloads);
    }
  } catch (e) {
    console.warn(`Skipping npm range fetch: ${e.message}`);
  }

  const npm = Array.from(npmMap.entries()).sort((a, b) => a[0].localeCompare(b[0]));

  const total = jsdelivr.map(([d, v]) => [d, v + (npmMap.get(d) || 0)]);

  return { jsdelivr, npm, total };
};

const renderChart = async (fromDate, toDate, vers) => {
  const versions = !vers ? await getNpmPublishDates() : vers;

  const button = document.getElementById("confirm-range");
  const lastUpdated = document.getElementById("last-updated");
  button.disabled = true;
  lastUpdated.textContent = "Loading...";

  const { jsdelivr, npm, total } = await fetchSplitStats(fromDate, toDate);

  const plotlines = Object.entries(versions).map(([ver, time]) => ({
    value: time,
    color: "#444",
    dashStyle: "Dash",
    zIndex: 1,
    label: {
      text: `<strong>${ver}</strong> (${time.split("-")[2]}.${time.split("-")[1]})`,
      x: 7,
      style: { fontSize: "12px", color: "#444" },
    },
  }));

  const chart = Highcharts.chart("container-total", {
    plotOptions: {
      series: {
        marker: {
          enabled: false,
        },
      },
    },

    title: { text: PACKAGE + " NPM and jsDelivr downloads" },

    xAxis: {
      type: "datetime",
      plotLines: plotlines,
    },
    yAxis: [
      { title: { text: "NPM", style: { color: "blue" } } },
      { title: { text: "jsDelivr", style: { color: "red" } }, opposite: true },
      //{ title: { text: "Total", style: { color: "black" } }, opposite: true }
    ],
    series: [
      {
        name: "NPM avg",
        data: computeMovingAverage(npm),
        yAxis: 0,
        color: "blue",
        zIndex: 4,
        shadow: true,
      },
      {
        name: "jsDelivr avg",
        data: computeMovingAverage(jsdelivr),
        yAxis: 1,
        color: "red",
        zIndex: 3,
        shadow: true,
      },
      {
        type: "area",
        name: "NPM accurate",
        data: npm,
        yAxis: 0,
        color: "blue",
        opacity: 0.1,
        zIndex: 2,
        states: { hover: { opacity: 1 } },
        legendSymbolColor: "#0000FF50",
      },
      {
        type: "area",
        name: "jsDelivr accurate",
        data: jsdelivr,
        yAxis: 1,
        color: "red",
        opacity: 0.1,
        zIndex: 1,
        states: { hover: { opacity: 1 } },
        legendSymbolColor: "#FF000050",
      },
      // {
      //   name: "Total average",
      //   data: computeMovingAverage(total),
      //   yAxis: 2,
      //   color: "black",
      //   zIndex: 5,
      // },
    ],
    tooltip: {
      useHTML: true,
      //fixed: true,
      formatter() {
        const dateFormatter = new Intl.DateTimeFormat("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
        });
        let output = `<div style="text-align: center; font-weight: bold;">${dateFormatter.format(new Date(this.category))}</div>`;
        output += '<div class="tooltip">';
        for (const s of this?.series?.chart?.series) {
          const opacity = s !== this.series ? 0.2 : 1;
          output += `
            <div>
              <span>
                <span style="color:${s.color}; opacity: ${opacity}; margin-right: 4px;">\u25CF</span>
                <span>${s.name}</span>
              </span>
              <span>${s.dataTable.columns.y[this.index]}</span>
            </div>
          `;
        }
        output += "</div>";
        return output;
      },
    },
  });

  lastUpdated.textContent = `Last updated: ${new Date().toLocaleString()}`;
  button.disabled = false;
};

if (typeof document !== "undefined") {
  document.getElementById("confirm-range").addEventListener("click", () => {
    const from = document.getElementById("from-date").value;
    const to = document.getElementById("to-date").value;

    if (from && to && from <= to) {
      renderChart(from, to);
    } else {
      alert("Please select a valid date range.");
    }
  });

  // Initialize default range and input limits
  (async () => {
    const versions = await getNpmPublishDates();
    const packages = await getNpmPackages();
    const minDate = Object.values(versions).sort()[0];
    const today = new Date();
    const todayIso = isoDate(today);

    const fromInput = document.getElementById("from-date");
    const toInput = document.getElementById("to-date");
    fromInput.min = minDate;
    toInput.min = minDate;
    fromInput.max = todayIso;
    toInput.max = todayIso;

    const thisMonth = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
    const fromDate = new Date(thisMonth);
    fromDate.setUTCMonth(fromDate.getUTCMonth() - 5);
    if (fromDate < new Date(minDate)) fromDate.setTime(new Date(minDate).getTime());
    const defaultFrom = isoDate(fromDate);
    const defaultTo = todayIso;

    fromInput.value = defaultFrom;
    toInput.value = defaultTo;

    renderChart(defaultFrom, defaultTo, versions);
  })();
}

if (typeof module !== "undefined") {
  module.exports = {
    fetchJsDelivrDownloads,
    fetchSplitStats,
  };
}
