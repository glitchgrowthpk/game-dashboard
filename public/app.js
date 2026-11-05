// Renders public/data/metrics.json. No build step: plain JS + Chart.js. Numbers and charts only.
(async function () {
  const $ = (sel) => document.querySelector(sel);
  const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const esc = (s) =>
    String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  let metrics;
  try {
    const res = await fetch('data/metrics.json', { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    metrics = await res.json();
  } catch (e) {
    $('#meta').textContent = `Could not load data (${e.message}).`;
    return;
  }

  const games = metrics.games;
  const okGames = games.filter((g) => g.ok);
  const seriesVar = (i) => `--series-${(i % 3) + 1}`; // fixed order: game 1 blue, game 2 orange, game 3 aqua

  // ---------- formatting ----------
  const int = (v) => (v == null ? '–' : Math.round(v).toLocaleString());
  const dec = (v, d = 1) => (v == null ? '–' : Number(v).toLocaleString(undefined, { maximumFractionDigits: d, minimumFractionDigits: d }));
  const pct = (v) => (v == null ? '–' : `${(v * 100).toFixed(1)}%`);
  const money = (v, cur, digits = 2) => {
    if (v == null) return '–';
    try {
      return new Intl.NumberFormat(undefined, { style: 'currency', currency: cur || 'USD', minimumFractionDigits: digits, maximumFractionDigits: digits }).format(v);
    } catch {
      return dec(v, 2);
    }
  };
  const shortDate = (iso) => new Date(iso + 'T00:00:00Z').toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });
  const change = (cur, prev) => (prev ? (cur - prev) / prev : null);
  const changeText = (ch) => (ch == null ? 'new' : `${ch >= 0 ? '+' : ''}${(ch * 100).toFixed(Math.abs(ch) < 0.1 ? 1 : 0)}%`);

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

  // Charts start at the first day with any users, so a new game isn't half empty space.
  const firstActive = (days) => Math.max(0, days.findIndex((d) => d.dau > 0));
  const trimmed = (g) => g.daily.slice(firstActive(g.daily));
  const ev = (g, name) => g.events?.find((e) => e.name === name);

  // ---------- header ----------
  const updated = new Date(metrics.generatedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  $('#meta').textContent = `Data through ${shortDate(metrics.periodEnd)} · updated ${updated}`;
  $('#demo-banner').hidden = !metrics.demo;

  // ---------- overview (all games) ----------
  $('#overview').innerHTML = `
    <div class="card">
      <h2>All games, last 7 days</h2>
      <div class="table-scroll"><table>
        <thead><tr><th>Game</th><th>Avg DAU</th><th>vs prior</th><th>Yesterday DAU</th><th>New users</th><th>D1</th><th>D7</th><th>Min/DAU</th><th>Revenue</th><th>Uninstalls</th></tr></thead>
        <tbody>${games
          .map((g) => {
            if (!g.ok) return `<tr><td>${esc(g.name)}</td><td colspan="9">Data failed: ${esc(g.error)}</td></tr>`;
            const s = g.summary.last7, p = g.summary.prev7;
            return `<tr>
              <td>${esc(g.name)}</td>
              <td>${int(s.dauAvg)}</td>
              <td>${isNewGame(g) ? 'new' : changeText(change(s.dauAvg, p.dauAvg))}</td>
              <td>${int(g.summary.yesterday?.dau)}</td>
              <td>${int(s.newUsers)}</td><td>${pct(g.retention?.d1)}</td><td>${pct(g.retention?.d7)}</td>
              <td>${dec(s.engagementMinPerDau)}</td>
              <td>${money(s.revenue, g.currency)}</td>
              <td>${int(ev(g, 'app_remove')?.count7)}</td></tr>`;
          })
          .join('')}</tbody>
      </table></div>
    </div>
    ${okGames.length > 1 ? `<div class="grid two">
      <div class="card"><h3>Daily active users</h3><div class="chart-box"><canvas id="all-dau"></canvas></div></div>
      <div class="card"><h3>New users per day</h3><div class="chart-box"><canvas id="all-new"></canvas></div></div>
    </div>` : ''}`;

  // ---------- per-game sections ----------
  $('#games').innerHTML = games
    .map((g, i) => {
      if (!g.ok) {
        return `<section class="game" data-game="${esc(g.id)}">
          <div class="game-head"><h2>${esc(g.name)}</h2></div>
          <div class="card error"><strong>Couldn't fetch data.</strong><p class="warn-list">${esc(g.error)}</p>
          <p class="warn-list">Check that the service account is a Viewer on GA4 property ${esc(g.propertyId)}.</p></div></section>`;
      }
      const s = g.summary.last7, p = g.summary.prev7;
      const start = ev(g, 'level_start');
      const done = ev(g, 'level_complete') ?? ev(g, 'level_end');
      const doneLabel = ev(g, 'level_complete') ? 'Level win rate' : 'Levels finished';
      const winRate = start?.count7 && done ? done.count7 / start.count7 : null;
      const winPrev = start?.prev7 && done?.prev7 ? done.prev7 / start.prev7 : null;
      const installs = ev(g, 'first_open'), removes = ev(g, 'app_remove');
      const offers = ev(g, 'adoffer'), rewards = ev(g, 'ad_reward');
      const arpdau = s.dauAvg ? s.revenue / 7 / s.dauAvg : null;
      const arpdauPrev = p.dauAvg ? p.revenue / 7 / p.dauAvg : null;
      return `<section class="game" data-game="${esc(g.id)}">
        <div class="game-head">
          <span class="swatch" style="background:var(${seriesVar(i)})" aria-hidden="true"></span>
          <h2>${esc(g.name)}</h2>
          <span class="meta">GA4 property ${esc(g.propertyId)} · last 7 days vs the 7 before</span>
        </div>

        <div class="tiles">
          <div class="tile"><div class="k">Avg DAU</div><div class="v">${int(s.dauAvg)}</div>${delta(s.dauAvg, p.dauAvg, g)}</div>
          <div class="tile"><div class="k">New users</div><div class="v">${int(s.newUsers)}</div>${delta(s.newUsers, p.newUsers, g)}</div>
          <div class="tile"><div class="k">Revenue</div><div class="v">${money(s.revenue, g.currency)}</div>${delta(s.revenue, p.revenue, g)}</div>
          <div class="tile"><div class="k">ARPDAU</div><div class="v">${money(arpdau, g.currency, 4)}</div>${delta(arpdau, arpdauPrev, g)}</div>
          <div class="tile"><div class="k">Day-1 retention</div><div class="v">${pct(g.retention?.d1)}</div><span class="delta flat">install cohorts, 14 days</span></div>
          <div class="tile"><div class="k">Day-7 retention</div><div class="v">${pct(g.retention?.d7)}</div><span class="delta flat">install cohorts, 14 days</span></div>
          <div class="tile"><div class="k">Minutes per DAU</div><div class="v">${dec(s.engagementMinPerDau)}</div>${delta(s.engagementMinPerDau, p.engagementMinPerDau, g)}</div>
          <div class="tile"><div class="k">Sessions per DAU</div><div class="v">${dec(s.sessionsPerDau, 2)}</div>${delta(s.sessionsPerDau, p.sessionsPerDau, g)}</div>
          ${winRate != null ? `<div class="tile"><div class="k">${doneLabel}</div><div class="v">${pct(winRate)}</div>${delta(winRate, winPrev, g)}</div>` : ''}
          ${installs?.count7 && removes ? `<div class="tile"><div class="k">Uninstalls per install</div><div class="v">${pct(removes.count7 / installs.count7)}</div><span class="delta flat">${int(removes.count7)} of ${int(installs.count7)}</span></div>` : ''}
          ${offers?.count7 && rewards ? `<div class="tile"><div class="k">Rewarded ads watched</div><div class="v">${pct(rewards.count7 / offers.count7)}</div><span class="delta flat">${int(rewards.count7)} of ${int(offers.count7)} offers</span></div>` : ''}
        </div>

        <div class="grid three">
          <div class="card"><h3>Daily active users</h3><div class="chart-box"><canvas id="dau-${i}"></canvas></div></div>
          <div class="card"><h3>New users per day</h3><div class="chart-box"><canvas id="new-${i}"></canvas></div></div>
          <div class="card"><h3>Daily revenue</h3><div class="chart-box"><canvas id="rev-${i}"></canvas></div>
            <p class="chart-caption">${s.adRevenue ? `Ads ${money(s.adRevenue, g.currency)} of ${money(s.revenue, g.currency)} in the last 7 days` : 'No ad revenue recorded (AdMob may not be linked to this Firebase project)'}</p></div>
          <div class="card"><h3>Minutes played per DAU</h3><div class="chart-box"><canvas id="eng-${i}"></canvas></div></div>
          <div class="card"><h3>Day-1 retention by install day</h3><div class="chart-box"><canvas id="ret-${i}"></canvas></div></div>
          <div class="card"><h3>Day-7 retention by install day</h3><div class="chart-box"><canvas id="ret7-${i}"></canvas></div>
            <p class="chart-caption">Install days appear once day 7 has passed</p></div>
        </div>

        <div class="grid two" style="margin-top:16px">
          <div class="card"><h3>Events, last 7 days</h3><div class="table-scroll"><table>
            <thead><tr><th>Event</th><th>Count</th><th>Prior 7d</th><th>Change</th><th>Users</th><th>Per user</th></tr></thead>
            <tbody>${(g.events ?? [])
              .map((e) => `<tr><td>${esc(e.name)}</td><td>${int(e.count7)}</td><td>${int(e.prev7)}</td>
                <td>${changeText(change(e.count7, e.prev7))}</td><td>${int(e.users7)}</td>
                <td>${e.users7 ? dec(e.count7 / e.users7) : '–'}</td></tr>`)
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
      .slice(0, 10)
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
  const withLegend = (o) => {
    o.plugins.legend = { display: true, position: 'top', align: 'start', labels: { boxWidth: 12, boxHeight: 12, color: css('--ink-2') } };
    return o;
  };
  const line = (label, data, color) => ({ label, data, borderColor: color, backgroundColor: color, borderWidth: 2, pointRadius: 0, pointHoverRadius: 4, tension: 0.25, spanGaps: true });
  const bar = (label, data, color) => ({ label, data, backgroundColor: color, borderRadius: 4, borderSkipped: 'start', maxBarThickness: 18 });
  const add = (id, config) => {
    const el = document.getElementById(id);
    if (el) charts.push(new Chart(el, config));
  };

  function drawCharts() {
    charts.forEach((c) => c.destroy());
    charts = [];
    Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
    Chart.defaults.color = css('--ink-2');

    // Overview: every game on one date axis, starting at the earliest active day of any game.
    if (okGames.length > 1) {
      const start = Math.min(...okGames.map((g) => firstActive(g.daily)));
      const labels = okGames[0].daily.slice(start).map((d) => shortDate(d.date));
      const series = (key) =>
        games.map((g, i) => (g.ok ? line(g.name, g.daily.slice(start).map((d) => d[key]), css(seriesVar(i))) : null)).filter(Boolean);
      add('all-dau', { type: 'line', data: { labels, datasets: series('dau') }, options: withLegend(base(int)) });
      add('all-new', { type: 'line', data: { labels, datasets: series('newUsers') }, options: withLegend(base(int)) });
    }

    games.forEach((g, i) => {
      if (!g.ok) return;
      const color = css(seriesVar(i));
      const days = trimmed(g);
      const labels = days.map((d) => shortDate(d.date));
      add(`dau-${i}`, { type: 'line', data: { labels, datasets: [line('DAU', days.map((d) => d.dau), color)] }, options: base(int) });
      add(`new-${i}`, { type: 'bar', data: { labels, datasets: [bar('New users', days.map((d) => d.newUsers), color)] }, options: base(int) });
      add(`rev-${i}`, { type: 'bar', data: { labels, datasets: [bar('Revenue', days.map((d) => d.revenue), color)] }, options: base((v) => money(v, g.currency)) });
      add(`eng-${i}`, {
        type: 'line',
        data: { labels, datasets: [line('Minutes', days.map((d) => (d.dau ? d.engagementSec / d.dau / 60 : null)), color)] },
        options: base((v) => dec(v)),
      });
      for (const [id, key] of [[`ret-${i}`, 'd1'], [`ret7-${i}`, 'd7']]) {
        const cohorts = (g.retention?.cohorts ?? []).filter((c) => c[key] != null && c.users >= 20);
        const o = base(pct);
        o.plugins.tooltip.callbacks.afterLabel = (c) => ` ${int(cohorts[c.dataIndex].users)} installs`;
        add(id, { type: 'bar', data: { labels: cohorts.map((c) => shortDate(c.date)), datasets: [bar(key.toUpperCase(), cohorts.map((c) => c[key]), color)] }, options: o });
      }
    });
  }
  drawCharts();
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', drawCharts);
})();
