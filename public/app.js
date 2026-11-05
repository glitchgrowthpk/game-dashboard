// Renders metrics.json + insights.json. No build step: plain JS + Chart.js.
(async function () {
  const $ = (sel) => document.querySelector(sel);
  const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const esc = (s) =>
    String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  const load = async (path) => {
    const res = await fetch(path, { cache: 'no-store' });
    if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
    return res.json();
  };

  let metrics, insights;
  try {
    [metrics, insights] = await Promise.all([load('data/metrics.json'), load('data/insights.json').catch(() => null)]);
  } catch (e) {
    $('#meta').textContent = `Could not load data (${e.message}).`;
    return;
  }

  const games = metrics.games;
  const report = insights?.report;
  const insightFor = (id) => report?.games?.find((g) => g.id === id);
  const seriesVar = (i) => `--series-${(i % 3) + 1}`; // fixed order: game 1 blue, game 2 orange, game 3 aqua

  // ---------- formatting ----------
  const int = (v) => (v == null ? '–' : Math.round(v).toLocaleString());
  const dec = (v, d = 1) => (v == null ? '–' : Number(v).toLocaleString(undefined, { maximumFractionDigits: d, minimumFractionDigits: d }));
  const pct = (v) => (v == null ? '–' : `${(v * 100).toFixed(1)}%`);
  const money = (v, cur) => {
    if (v == null) return '–';
    try {
      return new Intl.NumberFormat(undefined, { style: 'currency', currency: cur || 'USD', maximumFractionDigits: 2 }).format(v);
    } catch {
      return dec(v, 2);
    }
  };
  const shortDate = (iso) => new Date(iso + 'T00:00:00Z').toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });
  // A game that barely existed the week before (launch week) gets no week-over-week %, which would be huge and meaningless.
  const isNewGame = (g) => !(g.summary?.prev7?.dauAvg >= 5);
  function delta(cur, prev, game) {
    if (game && isNewGame(game)) return '<span class="delta flat">launched this week</span>';
    if (cur == null || prev == null || prev === 0) return '<span class="delta flat">no prior week</span>';
    const ch = (cur - prev) / prev;
    const cls = Math.abs(ch) < 0.005 ? 'flat' : ch > 0 ? 'up' : 'down';
    const arrow = cls === 'up' ? '▲' : cls === 'down' ? '▼' : '■';
    return `<span class="delta ${cls}">${arrow} ${(Math.abs(ch) * 100).toFixed(1)}% vs prior 7d</span>`;
  }
  const STATUS = { good: 'Good', watch: 'Watch', problem: 'Problem' };
  const pill = (status) =>
    status ? `<span class="pill ${esc(status)}"><span class="dot" aria-hidden="true"></span>${STATUS[status] ?? esc(status)}</span>` : '';

  // ---------- header ----------
  const updated = new Date(metrics.generatedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  $('#meta').textContent = `Data through ${shortDate(metrics.periodEnd)} · updated ${updated}`;
  $('#demo-banner').hidden = !metrics.demo;

  // ---------- Claude's report ----------
  if (report) {
    $('#claude').innerHTML = `
      <p class="label" id="claude-title">Claude's daily report · ${esc(insights.model)}</p>
      <p class="headline">${esc(report.headline)}</p>
      <p>${esc(report.overview)}</p>
      ${report.watchNext?.length ? `<h3>Watch tomorrow</h3><ul>${report.watchNext.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}`;
  } else {
    $('#claude').innerHTML = `<p class="label" id="claude-title">Claude's daily report</p><p>No report yet. It is written after the next daily run.</p>`;
  }

  // ---------- overview (all games) ----------
  const okGames = games.filter((g) => g.ok);
  $('#overview').innerHTML = `
    <div class="card">
      <h2>All games, last 7 days</h2>
      <div class="table-scroll"><table>
        <thead><tr><th>Game</th><th>Status</th><th>Avg DAU</th><th>vs prior</th><th>New users</th><th>D1</th><th>D7</th><th>Revenue</th></tr></thead>
        <tbody>${games
          .map((g) => {
            if (!g.ok) return `<tr><td>${esc(g.name)}</td><td colspan="7">Data failed: ${esc(g.error)}</td></tr>`;
            const s = g.summary.last7, p = g.summary.prev7;
            const ch = isNewGame(g) ? null : (s.dauAvg - p.dauAvg) / p.dauAvg;
            return `<tr>
              <td>${esc(g.name)}</td><td>${pill(insightFor(g.id)?.status)}</td>
              <td>${int(s.dauAvg)}</td>
              <td>${ch == null ? 'new' : `${ch >= 0 ? '+' : ''}${(ch * 100).toFixed(1)}%`}</td>
              <td>${int(s.newUsers)}</td><td>${pct(g.retention?.d1)}</td><td>${pct(g.retention?.d7)}</td>
              <td>${money(s.revenue, g.currency)}</td></tr>`;
          })
          .join('')}</tbody>
      </table></div>
    </div>
    ${okGames.length > 1 ? `<div class="card"><h2>Daily active users, last 30 days</h2><div class="chart-box"><canvas id="chart-all"></canvas></div></div>` : ''}`;

  // ---------- per-game sections ----------
  const eventCount = (g, name) => g.events?.find((e) => e.name === name);
  $('#games').innerHTML = games
    .map((g, i) => {
      const ins = insightFor(g.id);
      if (!g.ok) {
        return `<section class="game" data-game="${esc(g.id)}">
          <div class="game-head"><h2>${esc(g.name)}</h2>${pill('problem')}</div>
          <div class="card error"><strong>Couldn't fetch data.</strong><p class="warn-list">${esc(g.error)}</p>
          <p class="warn-list">Check that the service account is a Viewer on GA4 property ${esc(g.propertyId)}.</p></div></section>`;
      }
      const s = g.summary.last7, p = g.summary.prev7;
      const start = eventCount(g, 'level_start'), done = eventCount(g, 'level_complete');
      const winRate = start?.count7 && done ? done.count7 / start.count7 : null;
      const winPrev = start?.prev7 && done?.prev7 ? done.prev7 / start.prev7 : null;
      const users = Math.max(...(g.events ?? []).map((e) => e.users7), 1);
      return `<section class="game" data-game="${esc(g.id)}">
        <div class="game-head">
          <span class="swatch" style="background:var(${seriesVar(i)})" aria-hidden="true"></span>
          <h2>${esc(g.name)}</h2>${pill(ins?.status)}
        </div>

        ${ins ? `<div class="card">
          <p class="summary">${esc(ins.summary)}</p>
          <div class="notes">
            ${[['Going well', ins.highlights], ['Concerns', ins.concerns], ['Do this week', ins.actions]]
              .filter(([, list]) => list?.length)
              .map(([t, list]) => `<div><h3>${t}</h3><ul>${list.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>`)
              .join('')}
          </div></div>` : ''}

        <div class="tiles">
          <div class="tile"><div class="k">Avg DAU</div><div class="v">${int(s.dauAvg)}</div>${delta(s.dauAvg, p.dauAvg, g)}</div>
          <div class="tile"><div class="k">New users</div><div class="v">${int(s.newUsers)}</div>${delta(s.newUsers, p.newUsers, g)}</div>
          <div class="tile"><div class="k">Revenue</div><div class="v">${money(s.revenue, g.currency)}</div>${delta(s.revenue, p.revenue, g)}</div>
          <div class="tile"><div class="k">Day-1 retention</div><div class="v">${pct(g.retention?.d1)}</div><span class="delta flat">install cohorts, 14 days</span></div>
          <div class="tile"><div class="k">Day-7 retention</div><div class="v">${pct(g.retention?.d7)}</div><span class="delta flat">install cohorts, 14 days</span></div>
          <div class="tile"><div class="k">Minutes per DAU</div><div class="v">${dec(s.engagementMinPerDau)}</div>${delta(s.engagementMinPerDau, p.engagementMinPerDau, g)}</div>
          <div class="tile"><div class="k">Sessions per DAU</div><div class="v">${dec(s.sessionsPerDau, 2)}</div>${delta(s.sessionsPerDau, p.sessionsPerDau, g)}</div>
          ${winRate != null ? `<div class="tile"><div class="k">Level win rate</div><div class="v">${pct(winRate)}</div>${delta(winRate, winPrev, g)}</div>` : ''}
        </div>

        <div class="grid three">
          <div class="card"><h3>Daily active users</h3><div class="chart-box"><canvas id="dau-${i}"></canvas></div></div>
          <div class="card"><h3>Daily revenue</h3><div class="chart-box"><canvas id="rev-${i}"></canvas></div>
            <p class="chart-caption">${s.adRevenue ? `Ads ${money(s.adRevenue, g.currency)} of ${money(s.revenue, g.currency)} this week` : 'Ad revenue shows here once AdMob is linked to this Firebase project'}</p></div>
          <div class="card"><h3>Day-1 retention by install day</h3><div class="chart-box"><canvas id="ret-${i}"></canvas></div></div>
        </div>

        <div class="grid two" style="margin-top:16px">
          <div class="card"><h3>Top events, last 7 days</h3><div class="table-scroll"><table>
            <thead><tr><th>Event</th><th>Count</th><th>vs prior</th><th>Users</th></tr></thead>
            <tbody>${(g.events ?? [])
              .slice(0, 15)
              .map((e) => {
                const ch = e.prev7 ? (e.count7 - e.prev7) / e.prev7 : null;
                const p = ch == null ? null : Math.round(ch * 100);
                return `<tr><td>${esc(e.name)}</td><td>${int(e.count7)}</td><td>${p == null ? 'new' : p === 0 ? '0%' : `${p > 0 ? '+' : ''}${p}%`}</td><td>${int(e.users7)}</td></tr>`;
              })
              .join('')}</tbody></table></div></div>
          <div class="card">
            ${breakdown('App versions (users, 7d)', g.versions)}
            ${breakdown('Countries', g.countries)}
            ${breakdown('Platforms', g.platforms)}
            ${g.warnings?.length ? `<h3>Data warnings</h3><ul class="warn-list">${g.warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}
          </div>
        </div>
      </section>`;
    })
    .join('');

  function breakdown(title, rows) {
    if (!rows?.length) return '';
    const max = Math.max(...rows.map((r) => r.users), 1);
    return `<h3>${title}</h3><ul class="bars">${rows
      .slice(0, 6)
      .map((r) => `<li><span>${esc(r.name)}</span><span class="n">${int(r.users)}</span><span class="bar"><span style="width:${(r.users / max) * 100}%"></span></span></li>`)
      .join('')}</ul>`;
  }

  // ---------- tabs ----------
  const tabs = [{ id: 'all', name: 'All games' }, ...games.map((g) => ({ id: g.id, name: g.name }))];
  let active = 'all';
  try { active = localStorage.getItem('dash-tab') || 'all'; } catch {}
  if (!tabs.some((t) => t.id === active)) active = 'all';
  function showTab(id) {
    active = id;
    try { localStorage.setItem('dash-tab', id); } catch {}
    $('#tabs').querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.id === id)));
    $('#overview').classList.toggle('hidden', id !== 'all');
    document.querySelectorAll('.game').forEach((s) => s.classList.toggle('hidden', id !== 'all' && s.dataset.game !== id));
  }
  $('#tabs').innerHTML = tabs.map((t) => `<button type="button" data-id="${esc(t.id)}">${esc(t.name)}</button>`).join('');
  $('#tabs').addEventListener('click', (e) => e.target.dataset?.id && showTab(e.target.dataset.id));
  showTab(active);

  // ---------- charts ----------
  let charts = [];
  function base(yFormat) {
    return {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: (c) => ` ${c.dataset.label}: ${yFormat(c.parsed.y)}` } },
      },
      scales: {
        x: { grid: { display: false }, border: { color: css('--axis') }, ticks: { color: css('--muted'), maxTicksLimit: 6, maxRotation: 0 } },
        y: { beginAtZero: true, grid: { color: css('--grid') }, border: { display: false }, ticks: { color: css('--muted'), maxTicksLimit: 5, callback: yFormat } },
      },
    };
  }
  const line = (label, data, color) => ({ label, data, borderColor: color, backgroundColor: color, borderWidth: 2, pointRadius: 0, pointHoverRadius: 4, tension: 0.25 });
  const bar = (label, data, color) => ({ label, data, backgroundColor: color, borderRadius: 4, borderSkipped: 'start', maxBarThickness: 18 });

  function drawCharts() {
    charts.forEach((c) => c.destroy());
    charts = [];
    Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
    Chart.defaults.color = css('--ink-2');

    const all = document.getElementById('chart-all');
    if (all) {
      const labels = okGames[0].daily.map((d) => shortDate(d.date));
      const opts = base(int);
      opts.plugins.legend = { display: true, position: 'top', align: 'start', labels: { boxWidth: 12, boxHeight: 12, color: css('--ink-2') } };
      charts.push(new Chart(all, {
        type: 'line',
        data: { labels, datasets: games.map((g, i) => (g.ok ? line(g.name, g.daily.map((d) => d.dau), css(seriesVar(i))) : null)).filter(Boolean) },
        options: opts,
      }));
    }

    games.forEach((g, i) => {
      if (!g.ok) return;
      const color = css(seriesVar(i));
      const labels = g.daily.map((d) => shortDate(d.date));
      charts.push(new Chart(document.getElementById(`dau-${i}`), { type: 'line', data: { labels, datasets: [line('DAU', g.daily.map((d) => d.dau), color)] }, options: base(int) }));
      charts.push(new Chart(document.getElementById(`rev-${i}`), { type: 'bar', data: { labels, datasets: [bar('Revenue', g.daily.map((d) => d.revenue), color)] }, options: base((v) => money(v, g.currency)) }));
      const cohorts = (g.retention?.cohorts ?? []).filter((c) => c.d1 != null);
      charts.push(new Chart(document.getElementById(`ret-${i}`), {
        type: 'bar',
        data: { labels: cohorts.map((c) => shortDate(c.date)), datasets: [bar('D1', cohorts.map((c) => c.d1), color)] },
        options: (() => {
          const o = base(pct);
          o.plugins.tooltip.callbacks.afterLabel = (c) => ` ${int(cohorts[c.dataIndex].users)} installs`;
          return o;
        })(),
      }));
    });
  }
  drawCharts();
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', drawCharts);
})();
