const assert = require('assert');
const { fetchSplitStats } = require('./stats');

// mock fetch
global.fetch = async (url) => {
  if (url.includes('data.jsdelivr.com') && url.includes('period=2024-07')) {
    return {
      ok: true,
      json: async () => ({ hits: { dates: { '2024-07-01': 0, '2024-07-02': 0 } } })
    };
  }
  if (url.includes('data.jsdelivr.com') && url.includes('period=month')) {
    return {
      ok: true,
      json: async () => ({ hits: { dates: { '2024-07-01': 10, '2024-07-02': 20 } } })
    };
  }
  if (url.includes('api.npmjs.org')) {
    return {
      ok: true,
      json: async () => ({ downloads: [
        { day: '2024-07-01', downloads: 0 },
        { day: '2024-07-02', downloads: 0 }
      ] })
    };
  }
  return { ok: true, json: async () => ({}) };
};

(async () => {
  const { jsdelivr } = await fetchSplitStats('2024-07-01', '2024-07-31');
  const entry = jsdelivr.find(([d]) => d === '2024-07-01');
  assert(entry, 'July 1 data missing');
  assert.strictEqual(entry[1], 5, 'Downloads not divided by 2');
  console.log('Test passed');
})();
