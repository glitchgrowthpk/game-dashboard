// Renders public/data/metrics.json. No build step: plain JS + Chart.js.
// One game at a time (picked from the menu), with two clubbed charts:
//   Daily trend: a switcher (Users / Revenue / Playtime), each a multi-line chart
//   Retention:   D1 and D7 side by side per install day
// Secondary numbers, events and breakdowns sit in expandable sections.
(async function () {
  const $ = (sel) => document.querySelector(sel);
  const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const esc = (s) =>
    String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const store = {
    get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch {} },
  };

  const getJson = async (path) => {
    const res = await fetch(path, { cache: 'no-store' });
    if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
    return res.json();
  };

  // `latest` is the newest data; `metrics` is whatever day is on screen (latest or a saved past day).
  let latest, metrics, games = [], okGames = [];
  try {
    latest = metrics = await getJson('data/metrics.json');
  } catch (e) {
    $('#meta').textContent = `Could not load data (${e.message}).`;
    return;
  }
  // Saved days (newest first). Missing on old deployments, which just hides the date menu.
  const savedDays = await getJson('data/history/index.json').then((x) => x.days ?? []).catch(() => []);
  const COMPARE = '__all';
  const HINT = 'Click a line, bar or legend square to hide it. Click the legend again to show it.';

  // ---------- formatting ----------
  const int = (v) => (v == null ? '–' : Math.round(v).toLocaleString());
  const dec = (v, d = 1) => (v == null ? '–' : Number(v).toLocaleString(undefined, { maximumFractionDigits: d, minimumFractionDigits: d }));
  const pct = (v) => (v == null ? '–' : `${(v * 100).toFixed(1)}%`);
  const money = (v, cur, digits = 2) => {
    if (v == null) return '–';
    try {
      return new Intl.NumberFormat(undefined, { style: 'currency', currency: cur || 'USD', minimumFractionDigits: digits, maximumFractionDigits: digits }).format(v);
    } catch {
      return dec(v, digits);
    }
  };
  const moneyAxis = (cur) => (v) => money(v, cur, Math.abs(v) > 0 && Math.abs(v) < 1 ? 3 : 2);
  const shortDate = (iso) => new Date(iso + 'T00:00:00Z').toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });
  const change = (cur, prev) => (prev ? (cur - prev) / prev : null);
  const changeText = (ch) => (ch == null ? 'new' : `${ch >= 0 ? '+' : ''}${(ch * 100).toFixed(Math.abs(ch) < 0.1 ? 1 : 0)}%`);

  // A game that barely existed the week before (launch week) gets no week-over-week %, which would be huge and meaningless.
  // Same for a prior week that includes days before launch (any day with no players).
  const isNewGame = (g) => !(g.summary?.prev7?.dauAvg >= 5) || (g.daily ?? []).slice(-14, -7).some((d) => d.dau === 0);
  function delta(cur, prev, game) {
    if (game && isNewGame(game)) return '<span class="delta flat">launched recently</span>';
    if (cur == null || prev == null || prev === 0) return '<span class="delta flat">no prior week</span>';
    const ch = (cur - prev) / prev;
    const cls = Math.abs(ch) < 0.005 ? 'flat' : ch > 0 ? 'up' : 'down';
    const arrow = cls === 'up' ? '▲' : cls === 'down' ? '▼' : '■';
    return `<span class="delta ${cls}">${arrow} ${(Math.abs(ch) * 100).toFixed(1)}% vs prior 7d</span>`;
  }
  const tile = (label, value, sub) => `<div class="tile"><div class="k">${label}</div><div class="v">${value}</div>${sub}</div>`;
  const note = (text) => `<span class="delta flat">${text}</span>`;

  // Charts start at the first day with any users, so a new game isn't half empty space.
  const firstActive = (days) => Math.max(0, days.findIndex((d) => d.dau > 0));
  const ev = (g, name) => g.events?.find((e) => e.name === name);
  const minutes = (d) => (d.dau ? d.engagementSec / d.dau / 60 : null);
  const sessionsPer = (d) => (d.dau ? d.sessions / d.dau : null);
  const inApp = (d) => Math.round(Math.max(0, d.revenue - d.adRevenue) * 100) / 100;

  // ---------- header, game menu, date menu ----------
  const select = $('#game-select');
  const dateSelect = $('#date-select');
  const longDate = (iso) =>
    new Date(iso + 'T00:00:00Z').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

  /** Points the page at `metrics`: header, banners and the game menu (keeping the chosen game). */
  function applyMetrics() {
    games = metrics.games;
    okGames = games.filter((g) => g.ok);
    const isLatest = metrics.periodEnd === latest.periodEnd;
    const updated = new Date(latest.generatedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
    $('#meta').textContent = isLatest
      ? `Data through ${shortDate(metrics.periodEnd)} · updated ${updated}`
      : `Viewing a past day: ${longDate(metrics.periodEnd)}`;
    $('#demo-banner').hidden = !metrics.demo;
    $('#past-banner').hidden = isLatest;
    $('#past-day').textContent = longDate(metrics.periodEnd);

    const want = select.value || store.get('dash-game');
    select.innerHTML =
      games.map((g) => `<option value="${esc(g.id)}">${esc(g.name)}</option>`).join('') +
      (games.length > 1 ? `<option value="${COMPARE}">All games (compare)</option>` : '');
    select.value = [...select.options].some((o) => o.value === want) ? want : games[0]?.id;
  }

  select.addEventListener('change', () => {
    store.set('dash-game', select.value);
    render();
  });

  // Date menu: the newest day first, then every saved day before it.
  const days = [...new Set([latest.periodEnd, ...savedDays])].sort().reverse();
  if (days.length > 1) {
    dateSelect.innerHTML = days
      .map((d) => `<option value="${d}">${esc(longDate(d))}${d === latest.periodEnd ? ' (latest)' : ''}</option>`)
      .join('');
    dateSelect.value = latest.periodEnd;
    $('#date-picker').hidden = false;
  }
  async function showDay(day) {
    dateSelect.value = day;
    try {
      metrics = day === latest.periodEnd ? latest : await getJson(`data/history/${day}.json`);
    } catch (e) {
      $('#meta').textContent = `Could not load ${day} (${e.message}).`;
      return;
    }
    applyMetrics();
    render();
  }
  dateSelect.addEventListener('change', () => showDay(dateSelect.value));
  $('#back-to-latest').addEventListener('click', () => showDay(latest.periodEnd));
  applyMetrics();

  // ---------- charts: shared look + click to hide ----------
  let charts = [];
  const destroyCharts = () => {
    charts.forEach((c) => c.destroy());
    charts = [];
  };
  const HIT_PX = 10;
  function segDist(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
  }
  /** Index of the dataset under (x, y): the line within HIT_PX, or the bar under the pointer. */
  function datasetAt(chart, e) {
    if (chart.config.type === 'bar') {
      const hit = chart.getElementsAtEventForMode(e, 'nearest', { intersect: true }, false)[0];
      return hit ? hit.datasetIndex : null;
    }
    let best = null, bestD = HIT_PX;
    chart.data.datasets.forEach((_, di) => {
      if (!chart.isDatasetVisible(di)) return;
      const pts = chart.getDatasetMeta(di).data.filter((p) => !p.skip);
      for (let k = 0; k < pts.length; k++) {
        const a = pts[k], b = pts[k + 1] ?? pts[k];
        const d = segDist(e.x, e.y, a.x, a.y, b.x, b.y);
        if (d < bestD) [bestD, best] = [d, di];
      }
    });
    return best;
  }
  function options(yFormat, { legend = true } = {}) {
    return {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          display: legend,
          position: 'top',
          align: 'start',
          labels: { boxWidth: 12, boxHeight: 12, color: css('--ink-2') },
          onHover: (e) => (e.native.target.style.cursor = 'pointer'),
          onLeave: (e) => (e.native.target.style.cursor = ''),
        },
        tooltip: { callbacks: { label: (c) => ` ${c.dataset.label}: ${yFormat(c.parsed.y)}` } },
      },
      scales: {
        x: { grid: { display: false }, border: { color: css('--axis') }, ticks: { color: css('--muted'), maxTicksLimit: 8, maxRotation: 0 } },
        y: { beginAtZero: true, grid: { color: css('--grid') }, border: { display: false }, ticks: { color: css('--muted'), maxTicksLimit: 5, callback: yFormat } },
      },
      onClick: (e, _els, chart) => {
        const di = datasetAt(chart, e);
        if (di != null) chart.hide(di);
      },
      onHover: (e, _els, chart) => {
        if (e.y < chart.chartArea.top || !e.native?.target) return; // over the legend: its own onHover sets the cursor
        e.native.target.style.cursor = datasetAt(chart, e) != null ? 'pointer' : '';
      },
    };
  }
  const seriesColor = (i) => css(`--series-${(i % 3) + 1}`); // fixed order: blue, orange, aqua
  const line = (label, data, i) => {
    const c = seriesColor(i);
    // monotone curves never overshoot between points (no dips below zero on sparse data)
    return { label, data, borderColor: c, backgroundColor: c, borderWidth: 2, pointRadius: 0, pointHoverRadius: 4, cubicInterpolationMode: 'monotone', spanGaps: true };
  };
  const bar = (label, data, i) => ({ label, data, backgroundColor: seriesColor(i), borderRadius: 4, borderSkipped: 'start', maxBarThickness: 14 });
  const add = (id, config) => {
    const el = document.getElementById(id);
    if (!el) return null;
    const chart = new Chart(el, config);
    charts.push(chart);
    return chart;
  };

  /** A card with a segmented switcher; each view is { id, label, draw() -> chart config }. */
  function switcherCard(key, title, views) {
    const current = views.some((v) => v.id === store.get(key)) ? store.get(key) : views[0].id;
    return {
      html: `<div class="card">
        <div class="card-head"><h3>${title}</h3>
          <div class="seg" role="group" aria-label="${esc(title)}" data-key="${key}">
            ${views.map((v) => `<button type="button" data-view="${v.id}" aria-pressed="${v.id === current}">${v.label}</button>`).join('')}
          </div>
        </div>
        <div class="chart-box tall"><canvas id="${key}-canvas"></canvas></div>
        <p class="chart-caption" id="${key}-caption"></p>
      </div>`,
      mount() {
        let chart = null;
        const show = (id) => {
          const v = views.find((x) => x.id === id) ?? views[0];
          store.set(key, v.id);
          document.querySelectorAll(`[data-key="${key}"] button`).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === v.id)));
          if (chart) {
            charts = charts.filter((c) => c !== chart);
            chart.destroy();
          }
          chart = add(`${key}-canvas`, v.draw());
          $(`#${key}-caption`).textContent = [v.caption, HINT].filter(Boolean).join(' ');
        };
        document.querySelector(`[data-key="${key}"]`).addEventListener('click', (e) => e.target.dataset?.view && show(e.target.dataset.view));
        show(current);
      },
    };
  }

  // ---------- one game ----------
  function gameView(g) {
    if (!g.ok) {
      return {
        html: `<div class="card error"><h2>${esc(g.name)}</h2><strong>Couldn't fetch data.</strong>
          <p class="warn-list">${esc(g.error)}</p>
          <p class="warn-list">Check that the service account is a Viewer on GA4 property ${esc(g.propertyId)}.</p></div>`,
        mount() {},
      };
    }
    const s = g.summary.last7, p = g.summary.prev7, cur = g.currency;
    const days = g.daily.slice(firstActive(g.daily));
    const labels = days.map((d) => shortDate(d.date));

    const trend = switcherCard('trend', 'Daily trend', [
      {
        id: 'users', label: 'Users',
        draw: () => ({ type: 'line', data: { labels, datasets: [line('Active users', days.map((d) => d.dau), 0), line('New users', days.map((d) => d.newUsers), 1)] }, options: options(int) }),
      },
      {
        id: 'revenue', label: 'Revenue',
        caption: s.adRevenue ? `Ads ${money(s.adRevenue, cur)} of ${money(s.revenue, cur)} in the last 7 days.` : 'No ad revenue recorded (AdMob may not be linked to this Firebase project).',
        draw: () => ({
          type: 'line',
          data: { labels, datasets: [line('Total', days.map((d) => d.revenue), 0), line('Ads', days.map((d) => d.adRevenue), 1), line('In-app purchases', days.map(inApp), 2)] },
          options: options(moneyAxis(cur)),
        }),
      },
      {
        id: 'playtime', label: 'Playtime',
        draw: () => ({
          type: 'line',
          data: { labels, datasets: [line('Minutes per active user', days.map(minutes), 0), line('Sessions per active user', days.map(sessionsPer), 1)] },
          options: options((v) => dec(v)),
        }),
      },
    ]);

    const cohorts = (g.retention?.cohorts ?? []).filter((c) => c.users >= 20);
    const start = ev(g, 'level_start');
    const done = ev(g, 'level_complete') ?? ev(g, 'level_end');
    const winRate = start?.count7 && done ? done.count7 / start.count7 : null;
    const winPrev = start?.prev7 && done?.prev7 ? done.prev7 / start.prev7 : null;
    const installs = ev(g, 'first_open'), removes = ev(g, 'app_remove');
    const offers = ev(g, 'adoffer'), rewards = ev(g, 'ad_reward');
    const arpdau = s.dauAvg ? s.revenue / 7 / s.dauAvg : null;
    const arpdauPrev = p.dauAvg ? p.revenue / 7 / p.dauAvg : null;
    const more = [
      tile('ARPDAU', money(arpdau, cur, 4), delta(arpdau, arpdauPrev, g)),
      tile('Sessions per DAU', dec(s.sessionsPerDau, 2), delta(s.sessionsPerDau, p.sessionsPerDau, g)),
      winRate != null ? tile(ev(g, 'level_complete') ? 'Level win rate' : 'Levels finished', pct(winRate), delta(winRate, winPrev, g)) : '',
      installs?.count7 && removes ? tile('Uninstalls per install', pct(removes.count7 / installs.count7), note(`${int(removes.count7)} of ${int(installs.count7)}`)) : '',
      offers?.count7 && rewards ? tile('Rewarded ads watched', pct(rewards.count7 / offers.count7), note(`${int(rewards.count7)} of ${int(offers.count7)} offers`)) : '',
      tile('Yesterday DAU', int(g.summary.yesterday?.dau), note(shortDate(g.summary.yesterday?.date ?? metrics.periodEnd))),
    ].join('');

    return {
      html: `
        <div class="view-head"><h2>${esc(g.name)}</h2><span class="meta">Last 7 days vs the 7 before · GA4 property ${esc(g.propertyId)}</span></div>
        <div class="tiles">
          ${tile('Avg DAU', int(s.dauAvg), delta(s.dauAvg, p.dauAvg, g))}
          ${tile('New users', int(s.newUsers), delta(s.newUsers, p.newUsers, g))}
          ${tile('Revenue', money(s.revenue, cur), delta(s.revenue, p.revenue, g))}
          ${tile('Day-1 retention', pct(g.retention?.d1), note('install cohorts, 14 days'))}
          ${tile('Day-7 retention', pct(g.retention?.d7), note('install cohorts, 14 days'))}
          ${tile('Minutes per DAU', dec(s.engagementMinPerDau), delta(s.engagementMinPerDau, p.engagementMinPerDau, g))}
        </div>
        <div class="grid main">
          ${trend.html}
          <div class="card">
            <div class="card-head"><h3>Retention by install day</h3></div>
            <div class="chart-box tall"><canvas id="ret-canvas"></canvas></div>
            <p class="chart-caption">Day 7 appears once that day has passed. Install days with under 20 installs are left out. ${HINT}</p>
          </div>
        </div>
        <details class="card fold"><summary>More numbers</summary><div class="tiles">${more}</div></details>
        <details class="card fold"><summary>Events, last 7 days (${(g.events ?? []).length})</summary>
          <div class="table-scroll"><table>
            <thead><tr><th>Event</th><th>Count</th><th>Prior 7d</th><th>Change</th><th>Users</th><th>Per user</th></tr></thead>
            <tbody>${(g.events ?? [])
              .map((e) => `<tr><td>${esc(e.name)}</td><td>${int(e.count7)}</td><td>${int(e.prev7)}</td>
                <td>${changeText(change(e.count7, e.prev7))}</td><td>${int(e.users7)}</td>
                <td>${e.users7 ? dec(e.count7 / e.users7) : '–'}</td></tr>`)
              .join('')}</tbody></table></div>
        </details>
        <details class="card fold"><summary>App versions, countries and platforms</summary>
          <div class="grid three">
            <div>${breakdown('App versions (users, 7d)', g.versions)}</div>
            <div>${breakdown('Countries', g.countries)}</div>
            <div>${breakdown('Platforms', g.platforms)}</div>
          </div>
          ${g.warnings?.length ? `<h3>Data warnings</h3><ul class="warn-list">${g.warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}
        </details>`,
      mount() {
        trend.mount();
        const o = options(pct);
        o.plugins.tooltip.callbacks.afterBody = (items) => (items[0] ? ` ${int(cohorts[items[0].dataIndex].users)} installs` : '');
        add('ret-canvas', {
          type: 'bar',
          data: { labels: cohorts.map((c) => shortDate(c.date)), datasets: [bar('Day 1', cohorts.map((c) => c.d1), 0), bar('Day 7', cohorts.map((c) => c.d7), 1)] },
          options: o,
        });
      },
    };
  }

  function breakdown(title, rows) {
    if (!rows?.length) return '';
    const max = Math.max(...rows.map((r) => r.users), 1);
    return `<h3>${title}</h3><ul class="bars">${rows
      .slice(0, 10)
      .map((r) => `<li><span>${esc(r.name)}</span><span class="n">${int(r.users)}</span><span class="bar"><span style="width:${(r.users / max) * 100}%"></span></span></li>`)
      .join('')}</ul>`;
  }

  // ---------- all games (compare) ----------
  function compareView() {
    const start = Math.min(...okGames.map((g) => firstActive(g.daily)));
    const labels = (okGames[0]?.daily ?? []).slice(start).map((d) => shortDate(d.date));
    const perGame = (fn, i0 = 0) => okGames.map((g, i) => line(g.name, g.daily.slice(start).map(fn), i + i0));
    const cur = okGames[0]?.currency;
    const trend = switcherCard('compare', 'Daily trend, all games', [
      { id: 'dau', label: 'Active users', draw: () => ({ type: 'line', data: { labels, datasets: perGame((d) => d.dau) }, options: options(int) }) },
      { id: 'new', label: 'New users', draw: () => ({ type: 'line', data: { labels, datasets: perGame((d) => d.newUsers) }, options: options(int) }) },
      { id: 'rev', label: 'Revenue', draw: () => ({ type: 'line', data: { labels, datasets: perGame((d) => d.revenue) }, options: options(moneyAxis(cur)) }) },
      { id: 'min', label: 'Minutes per user', draw: () => ({ type: 'line', data: { labels, datasets: perGame(minutes) }, options: options((v) => dec(v)) }) },
    ]);
    return {
      html: `
        <div class="view-head"><h2>All games</h2><span class="meta">Last 7 days</span></div>
        <div class="card">
          <div class="table-scroll"><table>
            <thead><tr><th>Game</th><th>Avg DAU</th><th>vs prior</th><th>New users</th><th>D1</th><th>D7</th><th>Min/DAU</th><th>Revenue</th></tr></thead>
            <tbody>${games
              .map((g) => {
                if (!g.ok) return `<tr><td>${esc(g.name)}</td><td colspan="7">Data failed: ${esc(g.error)}</td></tr>`;
                const s = g.summary.last7, p = g.summary.prev7;
                return `<tr><td><button type="button" class="link" data-open="${esc(g.id)}">${esc(g.name)}</button></td>
                  <td>${int(s.dauAvg)}</td><td>${isNewGame(g) ? 'new' : changeText(change(s.dauAvg, p.dauAvg))}</td>
                  <td>${int(s.newUsers)}</td><td>${pct(g.retention?.d1)}</td><td>${pct(g.retention?.d7)}</td>
                  <td>${dec(s.engagementMinPerDau)}</td><td>${money(s.revenue, g.currency)}</td></tr>`;
              })
              .join('')}</tbody>
          </table></div>
        </div>
        ${okGames.length ? trend.html : ''}`,
      mount() {
        if (okGames.length) trend.mount();
        document.querySelectorAll('[data-open]').forEach((b) =>
          b.addEventListener('click', () => {
            select.value = b.dataset.open;
            select.dispatchEvent(new Event('change'));
          })
        );
      },
    };
  }

  // ---------- render ----------
  function render() {
    destroyCharts();
    Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
    Chart.defaults.color = css('--ink-2');
    const g = games.find((x) => x.id === select.value);
    const view = g ? gameView(g) : compareView();
    $('#view').innerHTML = view.html;
    view.mount();
  }
  render();
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', render);
})();
