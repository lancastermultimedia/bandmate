// ── Admin Dashboard ───────────────────────────────────────────────────────────
// Only loads if currentBandProfile.is_admin is true.

document.addEventListener('DOMContentLoaded', async () => {
  await initAuth();

  if (!currentBandProfile?.is_admin) {
    document.getElementById('adminGate').innerHTML = `
      <div class="admin-gate-inner">
        <div class="admin-gate-title">Access Denied</div>
        <div class="admin-gate-sub">Admin accounts only</div>
        <a href="index.html" style="display:inline-block;margin-top:20px;font-family:'Space Mono',monospace;font-size:8px;letter-spacing:0.18em;text-transform:uppercase;color:var(--teal)">← Back to Bandmate</a>
      </div>`;
    return;
  }

  await loadDashboard();
});

async function loadDashboard() {
  document.getElementById('adminGate').style.display    = 'flex';
  document.getElementById('adminContent').style.display = 'none';

  const now      = new Date();
  const weekAgo  = new Date(now - 7  * 864e5).toISOString();
  const monthAgo = new Date(now - 30 * 864e5).toISOString();
  const eightWeeksAgo = new Date(now - 56 * 864e5).toISOString();

  // Fetch everything in parallel
  const [
    bandsRes,
    recentBandsRes,
    reviewsRes,
    recentReviewsRes,
    epkWeekRes,
    epkMonthRes,
    growthRes,
  ] = await Promise.all([
    sb.from('bands').select('id, band_name, home_city, genre, created_at, review_count, is_premium, epk_theme, is_admin').order('created_at', { ascending: false }),
    sb.from('bands').select('band_name, home_city, genre, created_at, review_count').order('created_at', { ascending: false }).limit(12),
    sb.from('reviews').select('id, overall_rating, sound_rating, comms_rating, merch_rating, parking_rating, venue_name, google_place_id, created_at, is_anonymous, would_return, band_tip, band_id, review_text'),
    sb.from('reviews').select('overall_rating, venue_name, created_at, is_anonymous, bands(band_name, home_city)').order('created_at', { ascending: false }).limit(12),
    sb.from('epk_view_logs').select('id', { count: 'exact', head: true }).gte('viewed_at', weekAgo),
    sb.from('epk_view_logs').select('id', { count: 'exact', head: true }).gte('viewed_at', monthAgo),
    sb.from('bands').select('created_at').gte('created_at', eightWeeksAgo),
  ]);

  const allBands   = bandsRes.data   || [];
  const allReviews = reviewsRes.data || [];
  const recentRevs = recentReviewsRes.data || [];
  const growthBands = growthRes.data || [];

  const totalBands   = allBands.length;
  const newThisWeek  = allBands.filter(b => b.created_at >= weekAgo).length;
  const totalReviews = allReviews.length;
  const epkViewsWk   = epkWeekRes.count || 0;

  const avgRating = totalReviews > 0
    ? (allReviews.reduce((s, r) => s + (r.overall_rating || 0), 0) / totalReviews).toFixed(1)
    : '—';

  // Render all sections
  renderStats({ totalBands, newThisWeek, totalReviews, avgRating, epkViewsWk, epkViewsMo: epkMonthRes.count || 0 });
  renderTicker(recentBandsRes.data || [], recentRevs);
  renderGrowth(growthBands);
  renderGenres(allBands);
  renderCities(allBands);
  renderConversions(allReviews);
  renderVenues(allReviews);
  renderSignups(recentBandsRes.data || []);
  renderRecentReviews(recentRevs);
  renderRatings(allReviews);
  renderReturn(allReviews);
  renderFunnel(allBands);

  document.getElementById('refreshTime').textContent = 'Updated ' + now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  document.getElementById('adminGate').style.display    = 'none';
  document.getElementById('adminContent').style.display = 'block';
}

// ── Hero stats ────────────────────────────────────────────────────────────────

function renderStats({ totalBands, newThisWeek, totalReviews, avgRating, epkViewsWk, epkViewsMo }) {
  document.getElementById('adminHero').innerHTML = [
    { cls: 'bands',   eyebrow: 'Total Bands',        num: totalBands,    sub: `+${newThisWeek} this week` },
    { cls: 'new',     eyebrow: 'New This Week',       num: newThisWeek,   sub: 'registered accounts' },
    { cls: 'reviews', eyebrow: 'Total Reviews',       num: totalReviews,  sub: 'across all venues' },
    { cls: 'rating',  eyebrow: 'Avg Overall Rating',  num: avgRating + '★', sub: 'across all reviews' },
    { cls: 'epk',     eyebrow: 'EPK Views / Week',    num: epkViewsWk,    sub: `${epkViewsMo} this month` },
  ].map(s => `
    <div class="admin-stat admin-stat--${s.cls}">
      <div class="admin-stat-eyebrow">${s.eyebrow}</div>
      <div class="admin-stat-num">${s.num}</div>
      <div class="admin-stat-sub">${s.sub}</div>
    </div>`).join('');
}

// ── Ticker ────────────────────────────────────────────────────────────────────

function renderTicker(bands, reviews) {
  const items = [];
  bands.slice(0, 5).forEach(b => items.push(`New band: ${b.band_name} · ${b.home_city || '—'}`));
  reviews.slice(0, 5).forEach(r => {
    const band = r.bands?.band_name || 'A band';
    items.push(`${r.overall_rating}★ review at ${r.venue_name || 'a venue'} by ${band}`);
  });
  const html = items.map(t => `<span class="admin-ticker-item">${escapeHtml(t)}<span class="admin-ticker-dot"> · </span></span>`).join('');
  const track = document.getElementById('adminTickerTrack');
  if (track) track.innerHTML = html + html; // doubled for seamless loop
}

// ── Growth chart (8-week signups) ─────────────────────────────────────────────

function renderGrowth(bands) {
  // Build 8 weekly buckets
  const weeks = [];
  for (let i = 7; i >= 0; i--) {
    const start = new Date(Date.now() - (i + 1) * 7 * 864e5);
    const end   = new Date(Date.now() - i * 7 * 864e5);
    const label = start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const count = bands.filter(b => {
      const d = new Date(b.created_at);
      return d >= start && d < end;
    }).length;
    weeks.push({ label, count });
  }

  const max = Math.max(...weeks.map(w => w.count), 1);
  const bars = weeks.map(w => {
    const pct = Math.round((w.count / max) * 100);
    return `<div class="growth-col">
      <div class="growth-count">${w.count || ''}</div>
      <div class="growth-bar" style="height:${Math.max(pct, 3)}%"></div>
      <div class="growth-lbl">${w.label}</div>
    </div>`;
  }).join('');

  document.getElementById('panelGrowth').innerHTML = `
    <div class="admin-panel-hd">Signup Growth — Last 8 Weeks</div>
    <div class="growth-wrap">${bars}</div>`;
}

// ── Genre breakdown ───────────────────────────────────────────────────────────

function renderGenres(bands) {
  const counts = {};
  bands.forEach(b => {
    (b.genre || '').split(',').forEach(g => {
      const name = g.trim().toLowerCase();
      if (name) counts[name] = (counts[name] || 0) + 1;
    });
  });
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 10);
  const max = sorted[0]?.[1] || 1;

  const rows = sorted.map(([g, n]) => `
    <div class="hbar-row">
      <div class="hbar-label">${escapeHtml(g)}</div>
      <div class="hbar-track"><div class="hbar-fill hbar-fill--genre" style="width:${Math.round(n/max*100)}%"></div></div>
      <div class="hbar-n">${n}</div>
    </div>`).join('');

  document.getElementById('panelGenres').innerHTML = `
    <div class="admin-panel-hd">Top Genres <span class="admin-panel-count">${sorted.length} total</span></div>
    ${rows}`;
}

// ── City breakdown ────────────────────────────────────────────────────────────

function renderCities(bands) {
  const counts = {};
  bands.forEach(b => {
    const city = (b.home_city || '').trim();
    if (city) counts[city] = (counts[city] || 0) + 1;
  });
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 10);
  const max = sorted[0]?.[1] || 1;

  const rows = sorted.map(([city, n]) => `
    <div class="hbar-row">
      <div class="hbar-label">${escapeHtml(city)}</div>
      <div class="hbar-track"><div class="hbar-fill hbar-fill--city" style="width:${Math.round(n/max*100)}%"></div></div>
      <div class="hbar-n">${n}</div>
    </div>`).join('');

  document.getElementById('panelCities').innerHTML = `
    <div class="admin-panel-hd">Top Cities <span class="admin-panel-count">${Object.keys(counts).length} cities</span></div>
    ${rows || '<div style="color:var(--grey);font-size:11px;font-weight:300">No data yet</div>'}`;
}

// ── Venue leaderboard ─────────────────────────────────────────────────────────

// ── Venue conversion opportunities ───────────────────────────────────────────

const CONVERTED_PLACE_IDS = new Set([
  'ChIJI4sMfoFEQogRu6mxNiuBIHU', // The Burl
  'ChIJL89un_NEQogRaR9d0FgvN5I', // The Green Lantern
  'ChIJEaADEBJFQogR1ePUsrbUG6E', // The Fishtank
  'ChIJsbMgk_tEQogRocp77F-dFDo', // Al's Bar
]);

function isPositiveReview(r) {
  if (r.would_return === 'yes') return true;
  if ((r.overall_rating || 0) >= 4) return true;
  const subs = [r.sound_rating, r.comms_rating, r.merch_rating, r.parking_rating].filter(Boolean);
  if (subs.length >= 3 && subs.filter(s => s === 5).length >= Math.ceil(subs.length / 2)) return true;
  return false;
}

function renderConversions(reviews) {
  const venues = {};
  reviews.forEach(r => {
    const key  = r.google_place_id || r.venue_name || 'unknown';
    const name = r.venue_name || 'Unknown';
    if (!venues[key]) venues[key] = { name, placeId: r.google_place_id, pos: 0, total: 0 };
    venues[key].total++;
    if (isPositiveReview(r)) venues[key].pos++;
  });

  const candidates = Object.entries(venues)
    .filter(([, v]) => v.pos >= 3)
    .sort(([, a], [, b]) => b.pos - a.pos);

  const rows = candidates.map(([key, v]) => {
    const converted = CONVERTED_PLACE_IDS.has(key);
    const badge = converted
      ? `<span class="conv-badge conv-done">✓ Has page</span>`
      : `<span class="conv-badge">Needs page</span>`;
    const returnPct = Math.round((v.pos / v.total) * 100);
    return `
      <div class="conv-row">
        <div class="conv-name">${escapeHtml(v.name)}</div>
        <div class="conv-count">${v.pos} positive</div>
        <div class="conv-pct">${returnPct}% would return</div>
        ${badge}
      </div>`;
  }).join('');

  const needCount = candidates.filter(([k]) => !CONVERTED_PLACE_IDS.has(k)).length;

  document.getElementById('panelConversions').innerHTML = `
    <div class="admin-panel-hd">
      Venue Page Opportunities
      <span class="admin-panel-count">${needCount} need a page</span>
    </div>
    ${rows || '<div style="color:var(--grey);font-size:11px;font-weight:300">No venues with 3+ positive reviews yet</div>'}`;
}

// ── Venue leaderboard ─────────────────────────────────────────────────────────

function renderVenues(reviews) {
  const venues = {};
  reviews.forEach(r => {
    const key = r.google_place_id || r.venue_name || 'unknown';
    if (!venues[key]) venues[key] = { name: r.venue_name || 'Unknown', count: 0, total: 0 };
    venues[key].count++;
    venues[key].total += r.overall_rating || 0;
  });

  const sorted = Object.values(venues)
    .filter(v => v.count >= 1)
    .map(v => ({ ...v, avg: v.total / v.count }))
    .sort((a, b) => b.count - a.count || b.avg - a.avg)
    .slice(0, 10);

  const rows = sorted.map((v, i) => `
    <div class="venue-row">
      <div class="venue-rank">0${i + 1}</div>
      <div class="venue-name">${escapeHtml(v.name)}</div>
      <div class="venue-revs">${v.count} rev${v.count !== 1 ? 's' : ''}</div>
      <div class="venue-avg">${v.avg.toFixed(1)}★</div>
    </div>`).join('');

  document.getElementById('panelVenues').innerHTML = `
    <div class="admin-panel-hd">Venue Leaderboard <span class="admin-panel-count">${sorted.length} venues reviewed</span></div>
    ${rows || '<div style="color:var(--grey);font-size:11px;font-weight:300">No reviews yet</div>'}`;
}

// ── Recent signups ────────────────────────────────────────────────────────────

function renderSignups(bands) {
  const rows = bands.map(b => `
    <div class="signup-row">
      <div class="signup-name">${escapeHtml(b.band_name || '—')}</div>
      <div class="signup-city">${escapeHtml(b.home_city || '—')}</div>
      <div class="signup-time">${timeAgo(b.created_at)}</div>
    </div>`).join('');

  document.getElementById('panelSignups').innerHTML = `
    <div class="admin-panel-hd">Recent Signups</div>
    ${rows || '<div style="color:var(--grey);font-size:11px;font-weight:300">None yet</div>'}`;
}

// ── Recent reviews ────────────────────────────────────────────────────────────

function renderRecentReviews(reviews) {
  const rows = reviews.map(r => {
    const band  = r.is_anonymous ? 'Anonymous Band' : (r.bands?.band_name || 'A band');
    const stars = '★'.repeat(r.overall_rating || 0) + '☆'.repeat(5 - (r.overall_rating || 0));
    return `<div class="activity-item">
      <div class="activity-pip activity-pip--review"></div>
      <div class="activity-body">
        <div class="activity-title">${escapeHtml(stars)} at ${escapeHtml(r.venue_name || '—')}</div>
        <div class="activity-sub">by ${escapeHtml(band)}${r.bands?.home_city ? ' · ' + escapeHtml(r.bands.home_city) : ''}</div>
      </div>
      <div class="activity-time">${timeAgo(r.created_at)}</div>
    </div>`;
  }).join('');

  document.getElementById('panelReviews').innerHTML = `
    <div class="admin-panel-hd">Recent Reviews</div>
    ${rows || '<div style="color:var(--grey);font-size:11px;font-weight:300">No reviews yet</div>'}`;
}

// ── Rating distribution ───────────────────────────────────────────────────────

function renderRatings(reviews) {
  const dist = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
  reviews.forEach(r => { if (r.overall_rating) dist[r.overall_rating]++; });
  const max = Math.max(...Object.values(dist), 1);
  const total = reviews.length;

  const rows = [5, 4, 3, 2, 1].map(n => `
    <div class="rating-row">
      <div class="rating-star">${n}★</div>
      <div class="rating-track"><div class="rating-fill" style="width:${Math.round(dist[n]/max*100)}%"></div></div>
      <div class="rating-n">${dist[n]}</div>
    </div>`).join('');

  const anon = reviews.filter(r => r.is_anonymous).length;
  const anonPct = total ? Math.round(anon / total * 100) : 0;
  const withTip = reviews.filter(r => r.band_tip).length;

  document.getElementById('panelRatings').innerHTML = `
    <div class="admin-panel-hd">Rating Distribution</div>
    ${rows}
    <div style="margin-top:16px;padding-top:12px;border-top:1px solid rgba(15,15,12,0.08);display:flex;gap:20px">
      <div>
        <div class="quality-big">${anonPct}%</div>
        <div class="quality-lbl">Anonymous</div>
      </div>
      <div>
        <div class="quality-big">${withTip}</div>
        <div class="quality-lbl">Tips left</div>
      </div>
    </div>`;
}

// ── Would you return ──────────────────────────────────────────────────────────

function renderReturn(reviews) {
  const withReturn = reviews.filter(r => r.would_return);
  const yes   = withReturn.filter(r => r.would_return === 'yes').length;
  const maybe = withReturn.filter(r => r.would_return === 'maybe').length;
  const no    = withReturn.filter(r => r.would_return === 'no').length;
  const total = withReturn.length || 1;

  const yesPct   = Math.round(yes   / total * 100);
  const maybePct = Math.round(maybe / total * 100);
  const noPct    = Math.round(no    / total * 100);

  document.getElementById('panelReturn').innerHTML = `
    <div class="admin-panel-hd">Would You Play Here Again? <span class="admin-panel-count">${withReturn.length} answered</span></div>
    <div style="display:flex;gap:24px;margin-bottom:8px">
      <div><div class="quality-big" style="color:var(--teal)">${yesPct}%</div><div class="quality-lbl">Yes</div></div>
      <div><div class="quality-big" style="color:var(--olive)">${maybePct}%</div><div class="quality-lbl">Maybe</div></div>
      <div><div class="quality-big" style="color:var(--red)">${noPct}%</div><div class="quality-lbl">No</div></div>
    </div>
    <div class="return-track">
      <div class="return-seg return-seg--yes"   style="width:${yesPct}%"  >${yesPct > 8 ? yesPct + '%' : ''}</div>
      <div class="return-seg return-seg--maybe" style="width:${maybePct}%">${maybePct > 8 ? maybePct + '%' : ''}</div>
      <div class="return-seg return-seg--no"    style="width:${noPct}%"   >${noPct > 8 ? noPct + '%' : ''}</div>
    </div>
    <div class="return-legend">
      <div class="return-legend-item"><div class="return-legend-dot" style="background:var(--teal)"></div>Yes (${yes})</div>
      <div class="return-legend-item"><div class="return-legend-dot" style="background:var(--olive)"></div>Maybe (${maybe})</div>
      <div class="return-legend-item"><div class="return-legend-dot" style="background:var(--red)"></div>No (${no})</div>
    </div>`;
}

// ── Premium funnel ────────────────────────────────────────────────────────────

function renderFunnel(bands) {
  const total    = bands.length || 1;
  const hasRevs  = bands.filter(b => (b.review_count || 0) >= 1).length;
  const isPrem   = bands.filter(b => (b.review_count || 0) >= 3 || b.is_premium).length;
  const hasEpk   = bands.filter(b => b.epk_theme).length;

  function row(label, n, cls) {
    const pct = Math.round(n / total * 100);
    return `<div class="funnel-row">
      <div class="funnel-label">${label}</div>
      <div class="funnel-track">
        <div class="funnel-fill ${cls}" style="width:${pct}%">
          <span>${pct > 10 ? pct + '%' : ''}</span>
        </div>
      </div>
      <div class="funnel-n">${n}</div>
    </div>`;
  }

  document.getElementById('panelFunnel').innerHTML = `
    <div class="admin-panel-hd">Activation Funnel</div>
    ${row('Signed up',      total,   'funnel-fill--all')}
    ${row('Left ≥1 review', hasRevs, 'funnel-fill--rev')}
    ${row('Unlocked (3+)',  isPrem,  'funnel-fill--prem')}
    ${row('Built an EPK',   hasEpk,  'funnel-fill--epk')}
    <div style="margin-top:14px;font-family:'Space Mono',monospace;font-size:7px;letter-spacing:0.14em;text-transform:uppercase;color:var(--grey)">
      Conversion: ${total ? Math.round(isPrem/total*100) : 0}% reach premium · ${total ? Math.round(hasEpk/total*100) : 0}% build EPK
    </div>`;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function timeAgo(iso) {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1)   return 'just now';
  if (mins < 60)  return mins + 'm ago';
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)   return hrs + 'h ago';
  const days = Math.floor(hrs / 24);
  if (days < 30)  return days + 'd ago';
  const mos = Math.floor(days / 30);
  return mos + 'mo ago';
}

function escapeHtml(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
