// Pulls Firebase Analytics (GA4) data for every game in games.json, as of one day, and saves it.
//
//   node scripts/fetch.mjs                      as of yesterday: writes public/data/metrics.json
//                                               and the snapshot public/data/history/<yesterday>.json
//   node scripts/fetch.mjs --end 2026-11-01     snapshot as of that day only
//   node scripts/fetch.mjs --backfill 2026-10-21  one snapshot per day from that date to yesterday
//
// Every snapshot holds the 30 days ending on its day, the 7-day comparison, retention, events and
// breakdowns as they looked on that day. public/data/history/index.json lists the saved days.
//
// Env: GA_SA_KEY (service-account JSON, raw or base64) or GA_SA_KEY_FILE / service-account.json.
import { join } from 'node:path';
import { BetaAnalyticsDataClient } from '@google-analytics/data';
import { DATA_DIR, loadGames, readJson, writeJson, isoDay, addDays, gaDateToIso, serviceAccountFromEnv } from './lib.mjs';

const DAYS = 30; // daily series length per snapshot
const RETENTION_COHORTS = 14; // one cohort per install day, the 14 days before the snapshot day
const HISTORY_DIR = join(DATA_DIR, 'history');

const num = (v) => (v == null || v === '' ? 0 : Number(v));
const round = (v, d = 2) => (Number.isFinite(v) ? Math.round(v * 10 ** d) / 10 ** d : null);

/** Runs a report and returns rows as plain objects keyed by dimension/metric name. */
async function report(client, propertyId, request) {
  const [res] = await client.runReport({ property: `properties/${propertyId}`, ...request });
  const dims = (res.dimensionHeaders ?? []).map((h) => h.name);
  const mets = (res.metricHeaders ?? []).map((h) => h.name);
  return (res.rows ?? []).map((row) => {
    const o = {};
    dims.forEach((d, i) => (o[d] = row.dimensionValues[i].value));
    mets.forEach((m, i) => (o[m] = num(row.metricValues[i].value)));
    return o;
  });
}

async function fetchDaily(client, pid, end) {
  const range = [{ startDate: addDays(end, -(DAYS - 1)), endDate: end }];
  const core = await report(client, pid, {
    dateRanges: range,
    dimensions: [{ name: 'date' }],
    metrics: [{ name: 'activeUsers' }, { name: 'newUsers' }, { name: 'sessions' }, { name: 'userEngagementDuration' }],
    limit: 1000,
  });

  // Revenue is a separate call: totalAdRevenue only exists when AdMob is linked, and an
  // unsupported metric would otherwise fail the whole report.
  let revenue;
  try {
    revenue = await report(client, pid, {
      dateRanges: range,
      dimensions: [{ name: 'date' }],
      metrics: [{ name: 'totalRevenue' }, { name: 'totalAdRevenue' }],
      limit: 1000,
    });
  } catch {
    revenue = await report(client, pid, {
      dateRanges: range,
      dimensions: [{ name: 'date' }],
      metrics: [{ name: 'totalRevenue' }],
      limit: 1000,
    });
  }

  const byDate = new Map();
  for (const r of core) byDate.set(gaDateToIso(r.date), { ...r });
  for (const r of revenue) Object.assign(byDate.get(gaDateToIso(r.date)) ?? {}, r);

  // One entry per calendar day, zero-filled, oldest first.
  const days = [];
  for (let i = DAYS - 1; i >= 0; i--) {
    const date = addDays(end, -i);
    const r = byDate.get(date) ?? {};
    days.push({
      date,
      dau: num(r.activeUsers),
      newUsers: num(r.newUsers),
      sessions: num(r.sessions),
      engagementSec: num(r.userEngagementDuration),
      revenue: round(num(r.totalRevenue), 2),
      adRevenue: round(num(r.totalAdRevenue), 2),
    });
  }
  return days;
}

export function summarize(days) {
  const sum = (arr, k) => arr.reduce((a, d) => a + d[k], 0);
  const win = (arr) => {
    const dau = sum(arr, 'dau');
    return {
      days: arr.length,
      dauAvg: round(dau / Math.max(arr.length, 1), 1),
      newUsers: sum(arr, 'newUsers'),
      sessions: sum(arr, 'sessions'),
      sessionsPerDau: dau ? round(sum(arr, 'sessions') / dau, 2) : null,
      engagementMinPerDau: dau ? round(sum(arr, 'engagementSec') / dau / 60, 1) : null,
      revenue: round(sum(arr, 'revenue'), 2),
      adRevenue: round(sum(arr, 'adRevenue'), 2),
    };
  };
  return { last7: win(days.slice(-7)), prev7: win(days.slice(-14, -7)), yesterday: days.at(-1) };
}

async function fetchEvents(client, pid, end) {
  const rows = await report(client, pid, {
    dateRanges: [
      { startDate: addDays(end, -6), endDate: end, name: 'cur' },
      { startDate: addDays(end, -13), endDate: addDays(end, -7), name: 'prev' },
    ],
    dimensions: [{ name: 'eventName' }],
    metrics: [{ name: 'eventCount' }, { name: 'totalUsers' }],
    limit: 200,
  });
  const map = new Map();
  for (const r of rows) {
    const e = map.get(r.eventName) ?? { name: r.eventName, count7: 0, prev7: 0, users7: 0 };
    if (r.dateRange === 'cur') {
      e.count7 = r.eventCount;
      e.users7 = r.totalUsers;
    } else {
      e.prev7 = r.eventCount;
    }
    map.set(r.eventName, e);
  }
  // GA4 also returns blank / "(not set)" rows that carry users but no events; drop them.
  return [...map.values()]
    .filter((e) => e.name && e.name !== '(not set)' && (e.count7 || e.prev7))
    .sort((a, b) => b.count7 - a.count7)
    .slice(0, 40);
}

async function fetchBreakdown(client, pid, dimension, limit, end) {
  const rows = await report(client, pid, {
    dateRanges: [{ startDate: addDays(end, -6), endDate: end }],
    dimensions: [{ name: dimension }],
    metrics: [{ name: 'activeUsers' }],
    orderBys: [{ metric: { metricName: 'activeUsers' }, desc: true }],
    limit,
  });
  return rows.map((r) => ({ name: r[dimension] || '(not set)', users: r.activeUsers }));
}

/**
 * Day-1 and day-7 retention from daily install cohorts. A cohort only counts toward D-n once
 * day n has passed by the snapshot day, so recent cohorts don't drag the average down.
 */
async function fetchRetention(client, pid, end) {
  const cohorts = [];
  for (let i = RETENTION_COHORTS; i >= 1; i--) {
    const d = addDays(end, -i);
    cohorts.push({ name: d, dimension: 'firstSessionDate', dateRange: { startDate: d, endDate: d } });
  }
  const rows = await report(client, pid, {
    dimensions: [{ name: 'cohort' }, { name: 'cohortNthDay' }],
    metrics: [{ name: 'cohortActiveUsers' }, { name: 'cohortTotalUsers' }],
    cohortSpec: { cohorts, cohortsRange: { granularity: 'DAILY', startOffset: 0, endOffset: 7 } },
    limit: 1000,
  });
  return retentionFromRows(rows, end);
}

export function retentionFromRows(rows, lastCompleteDay) {
  const by = new Map();
  for (const r of rows) {
    const c = by.get(r.cohort) ?? { date: r.cohort, users: 0, active: {} };
    c.users = Math.max(c.users, r.cohortTotalUsers);
    c.active[Number(r.cohortNthDay)] = r.cohortActiveUsers;
    by.set(r.cohort, c);
  }
  const out = [...by.values()]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((c) => {
      const rate = (n) =>
        c.users && addDays(c.date, n) <= lastCompleteDay ? round((c.active[n] ?? 0) / c.users, 4) : null;
      return { date: c.date, users: c.users, d1: rate(1), d7: rate(7) };
    });
  // Cohorts under MIN_COHORT installs (launch-day testers etc.) stay in the list but not in the average.
  const MIN_COHORT = 20;
  const weighted = (k) => {
    const usable = out.filter((c) => c[k] != null && c.users >= MIN_COHORT);
    const users = usable.reduce((a, c) => a + c.users, 0);
    return users ? round(usable.reduce((a, c) => a + c[k] * c.users, 0) / users, 4) : null;
  };
  return { cohorts: out, d1: weighted('d1'), d7: weighted('d7') };
}

async function fetchGame(client, game, end) {
  const pid = game.ga4PropertyId;
  const out = { id: game.id, name: game.name, propertyId: pid, currency: game.currency ?? 'USD', ok: true, warnings: [] };
  const daily = await fetchDaily(client, pid, end);
  out.daily = daily;
  out.summary = summarize(daily);

  // The breakdowns are nice-to-have: a failure there shouldn't lose the core numbers.
  const optional = async (key, fn) => {
    try {
      out[key] = await fn();
    } catch (e) {
      out[key] = null;
      out.warnings.push(`${key}: ${e.message}`);
    }
  };
  await optional('retention', () => fetchRetention(client, pid, end));
  await optional('events', () => fetchEvents(client, pid, end));
  await optional('versions', () => fetchBreakdown(client, pid, 'appVersion', 8, end));
  await optional('countries', () => fetchBreakdown(client, pid, 'country', 10, end));
  await optional('platforms', () => fetchBreakdown(client, pid, 'platform', 4, end));
  return out;
}

async function snapshot(client, games, end) {
  const results = [];
  for (const game of games) {
    try {
      results.push(await fetchGame(client, game, end));
    } catch (e) {
      console.error(`✗ ${end} ${game.name}: ${e.message}`);
      results.push({ id: game.id, name: game.name, propertyId: game.ga4PropertyId, ok: false, error: e.message });
    }
  }
  return { generatedAt: new Date().toISOString(), periodEnd: end, demo: false, games: results };
}

/** Saves a snapshot under history/ and refreshes history/index.json (newest first). */
function saveHistory(metrics) {
  writeJson(join(HISTORY_DIR, `${metrics.periodEnd}.json`), metrics);
  const index = readJson(join(HISTORY_DIR, 'index.json'), { days: [] });
  const days = new Set(index.days);
  days.add(metrics.periodEnd);
  writeJson(join(HISTORY_DIR, 'index.json'), { days: [...days].sort().reverse() });
}

function parseArgs(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--end') opts.end = argv[++i];
    else if (argv[i] === '--backfill') opts.backfill = argv[++i];
  }
  const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s ?? '');
  if (opts.end && !isDate(opts.end)) throw new Error('--end needs a date like 2026-11-01');
  if (opts.backfill && !isDate(opts.backfill)) throw new Error('--backfill needs a date like 2026-10-21');
  return opts;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const key = serviceAccountFromEnv();
  const client = new BetaAnalyticsDataClient({
    credentials: { client_email: key.client_email, private_key: key.private_key },
  });
  const games = loadGames();
  const latest = isoDay(1);

  // Which days to save: one (default yesterday, or --end), or every day from --backfill to yesterday.
  const ends = [];
  if (opts.backfill) for (let d = opts.backfill; d <= latest; d = addDays(d, 1)) ends.push(d);
  else ends.push(opts.end ?? latest);

  let ok = 0;
  for (const end of ends) {
    const metrics = await snapshot(client, games, end);
    saveHistory(metrics);
    // The page opens on metrics.json, so keep it on the newest day.
    if (end === latest) writeJson(join(DATA_DIR, 'metrics.json'), metrics);
    const good = metrics.games.filter((g) => g.ok).length;
    if (good) ok++;
    console.log(`✓ ${end}: ${good}/${metrics.games.length} games`);
  }
  if (!ok) process.exit(1);
}

// Run only when executed directly (demo.mjs imports summarize from here).
if (process.argv[1]?.endsWith('fetch.mjs')) {
  main().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
