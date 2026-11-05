// Writes made-up metrics.json + insights.json so the dashboard can be previewed before the
// first real run. Both files are flagged demo: true and the page shows a banner.
import { join } from 'node:path';
import { DATA_DIR, loadGames, writeJson, isoDay } from './lib.mjs';
import { summarize } from './fetch.mjs';

let seed = 7;
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

function fakeGame(game, base, trend) {
  const daily = [];
  for (let i = 30; i >= 1; i--) {
    const weekend = [0, 6].includes(new Date(isoDay(i) + 'T00:00:00Z').getUTCDay()) ? 1.15 : 1;
    const dau = Math.round(base * weekend * (1 + trend * (30 - i)) * (0.92 + rand() * 0.16));
    daily.push({
      date: isoDay(i),
      dau,
      newUsers: Math.round(dau * (0.3 + rand() * 0.1)),
      sessions: Math.round(dau * (2.1 + rand() * 0.5)),
      engagementSec: Math.round(dau * (480 + rand() * 120)),
      revenue: Math.round(dau * (0.018 + rand() * 0.006) * 100) / 100,
      adRevenue: Math.round(dau * (0.015 + rand() * 0.005) * 100) / 100,
    });
  }
  const cohorts = [];
  for (let i = 15; i >= 2; i--) {
    cohorts.push({
      date: isoDay(i),
      users: Math.round(base * 0.33),
      d1: Math.round((0.3 + rand() * 0.08) * 1e4) / 1e4,
      d7: i >= 9 ? Math.round((0.07 + rand() * 0.04) * 1e4) / 1e4 : null,
    });
  }
  const avg = (k) => {
    const c = cohorts.filter((x) => x[k] != null);
    return Math.round((c.reduce((a, x) => a + x[k], 0) / c.length) * 1e4) / 1e4;
  };
  const ev = (name, per) => {
    const count7 = Math.round(base * 7 * per * (0.9 + rand() * 0.2));
    return { name, count7, prev7: Math.round(count7 * (0.85 + rand() * 0.25)), users7: Math.round(base * 3 * Math.min(per, 1)) };
  };
  return {
    id: game.id,
    name: game.name,
    propertyId: game.ga4PropertyId,
    currency: game.currency ?? 'USD',
    ok: true,
    warnings: [],
    daily,
    summary: summarize(daily),
    retention: { cohorts, d1: avg('d1'), d7: avg('d7') },
    events: [
      ev('user_engagement', 9),
      ev('screen_view', 6),
      ev('level_start', 5),
      ev('level_complete', 3.8),
      ev('ad_impression', 3.2),
      ev('session_start', 2.3),
      ev('level_fail', 1.1),
      ev('booster_use', 0.6),
      ev('rv_watched', 0.4),
      ev('first_open', 0.33),
    ],
    versions: [
      { name: '1.0.6', users: Math.round(base * 2.4) },
      { name: '1.0.5', users: Math.round(base * 0.9) },
    ],
    countries: [
      { name: 'Pakistan', users: Math.round(base * 1.1) },
      { name: 'India', users: Math.round(base * 0.8) },
      { name: 'United States', users: Math.round(base * 0.4) },
    ],
    platforms: [{ name: 'Android', users: Math.round(base * 3.3) }],
  };
}

const [a, b] = loadGames();
const games = [fakeGame(a, 1200, 0.004), b && fakeGame(b, 420, -0.006)].filter(Boolean);
writeJson(join(DATA_DIR, 'metrics.json'), { generatedAt: new Date().toISOString(), periodEnd: isoDay(1), demo: true, games });
writeJson(join(DATA_DIR, 'insights.json'), {
  generatedAt: new Date().toISOString(),
  periodEnd: isoDay(1),
  model: 'demo',
  demo: true,
  report: {
    headline: 'Demo data: this is where Claude’s one-line takeaway for the day appears.',
    overview:
      'After the first real run, this paragraph compares all games week over week: who is growing, whose retention slipped, and where revenue moved.',
    games: games.map((g, i) => ({
      id: g.id,
      status: i === 0 ? 'good' : 'watch',
      summary: `Example summary for ${g.name}, written from the real numbers once the daily job runs.`,
      highlights: ['Each highlight cites a number, e.g. DAU up 8% week over week.'],
      concerns: ['Each concern cites a number too, e.g. level_fail up 30% against level_start.'],
      actions: ['Concrete steps for this week, e.g. check level 12 difficulty in 1.0.6.'],
    })),
    watchNext: ['Things Claude wants to re-check in tomorrow’s data.'],
  },
});
console.log('Wrote demo metrics.json and insights.json');
