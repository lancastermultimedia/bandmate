// Shared logic for static venue review pages.
// Each venue HTML page defines window.VENUE before loading this script.

(async () => {
  if (!window.VENUE) { console.error('[venue-page] VENUE config missing'); return; }

  const statsEl   = document.getElementById('vpStats');
  const listEl    = document.getElementById('vpReviewList');
  const countEl   = document.getElementById('vpReviewCount');
  const titleEl   = document.getElementById('vpReviewsTitle');

  function starBar(rating) {
    const n = Math.round(Number(rating) || 0);
    return Array.from({ length: 5 }, (_, i) =>
      `<span style="color:${i < n ? 'var(--teal)' : 'rgba(15,15,12,0.15)'}">★</span>`
    ).join('');
  }

  function timeAgo(ts) {
    const diff = Date.now() - new Date(ts);
    const d = Math.floor(diff / 86400000);
    if (d < 1)  return 'Today';
    if (d < 7)  return `${d}d ago`;
    if (d < 30) return `${Math.floor(d/7)}w ago`;
    if (d < 365) return `${Math.floor(d/30)}mo ago`;
    return `${Math.floor(d/365)}y ago`;
  }

  function renderEmpty() {
    if (statsEl) statsEl.style.display = 'none';
    if (listEl)  listEl.innerHTML = `
      <div style="padding:48px 0;text-align:center;font-family:'Space Mono',monospace;font-size:7px;letter-spacing:0.18em;text-transform:uppercase;color:var(--grey)">
        No reviews yet for this venue.<br><br>
        <a href="../map.html#leave-review" style="color:var(--teal);text-decoration:none">Be the first band to review it →</a>
      </div>`;
  }

  function renderStats(reviews) {
    if (!statsEl) return;
    const total = reviews.length;
    const rated = reviews.filter(r => r.rating);
    const avg   = rated.length ? (rated.reduce((s, r) => s + Number(r.rating), 0) / rated.length) : 0;
    const returning = reviews.filter(r => r.would_return === 'yes' || r.would_return === true).length;
    const returnPct = total ? Math.round((returning / total) * 100) : 0;

    statsEl.innerHTML = `
      <div class="vp-stat">
        <div class="vp-stat-num">${total}</div>
        <div class="vp-stat-label">Band review${total !== 1 ? 's' : ''}</div>
      </div>
      <div class="vp-stat-divider"></div>
      <div class="vp-stat">
        <div class="vp-stat-num">${avg > 0 ? avg.toFixed(1) : '—'}</div>
        <div class="vp-stat-label">Avg rating</div>
      </div>
      <div class="vp-stat-divider"></div>
      <div class="vp-stat">
        <div class="vp-stat-num">${returnPct}%</div>
        <div class="vp-stat-label">Would play again</div>
      </div>`;
  }

  function renderReviews(reviews) {
    if (!listEl) return;
    if (countEl) countEl.textContent = reviews.length;
    if (titleEl) titleEl.textContent = `${reviews.length} Band Review${reviews.length !== 1 ? 's' : ''}`;

    listEl.innerHTML = reviews.map(r => {
      const bandName  = r.is_anonymous ? 'Verified Band — Identity Protected' : (r.bands?.band_name || 'Anonymous');
      const genres    = Array.isArray(r.genres) ? r.genres : (r.genre ? [r.genre] : []);
      const genreHtml = genres.map(g => `<span class="vp-genre-chip">${g}</span>`).join('');
      const tipHtml   = r.band_tip ? `<div class="vp-review-tip"><span class="vp-tip-label">Tip for bands</span> ${r.band_tip}</div>` : '';
      const editedHtml = r.is_edited ? `<span class="vp-edited-badge">Edited</span>` : '';
      const returnHtml = r.would_return
        ? `<span class="vp-return-tag vp-return-${r.would_return}">${
            r.would_return === 'yes' ? '✓ Would play again'
            : r.would_return === 'no' ? '✗ Wouldn\'t return'
            : '~ Maybe'
          }</span>` : '';

      return `
        <div class="vp-review-card">
          <div class="vp-review-header">
            <div class="vp-review-meta">
              <span class="vp-band-name">${bandName}</span>
              ${editedHtml}
              <span class="vp-review-date">${timeAgo(r.created_at)}</span>
            </div>
            <div class="vp-review-right">
              ${r.rating ? `<div class="vp-stars">${starBar(r.rating)}</div>` : ''}
              ${returnHtml}
            </div>
          </div>
          ${genreHtml ? `<div class="vp-genres">${genreHtml}</div>` : ''}
          ${r.review_text ? `<p class="vp-review-text">${r.review_text}</p>` : ''}
          ${tipHtml}
        </div>`;
    }).join('');
  }

  try {
    if (!window.supabase || !window.BANDMATE_SUPABASE_URL || !window.BANDMATE_SUPABASE_KEY) {
      renderEmpty(); return;
    }

    const sb = window.supabase.createClient(window.BANDMATE_SUPABASE_URL, window.BANDMATE_SUPABASE_KEY);

    // Try matching on google_place_id first (exact), fall back to venue_name ILIKE
    let data = null;

    if (VENUE.placeId) {
      const res = await sb.from('reviews')
        .select('*, bands(band_name)')
        .eq('google_place_id', VENUE.placeId)
        .order('created_at', { ascending: false });
      data = res.data;
    }

    if (!data || data.length === 0) {
      const res = await sb.from('reviews')
        .select('*, bands(band_name)')
        .ilike('venue_name', `%${VENUE.queryName || VENUE.name}%`)
        .order('created_at', { ascending: false });
      data = res.data;
    }

    if (!data || data.length === 0) { renderEmpty(); return; }

    // Update page meta dynamically once we know the review count
    const descEl = document.querySelector('meta[name="description"]');
    if (descEl && data.length > 0) {
      descEl.setAttribute('content',
        `${data.length} touring band review${data.length !== 1 ? 's' : ''} for ${VENUE.name} in ${VENUE.city}. Real reviews from independent touring bands on Bandmate.`);
    }

    renderStats(data);
    renderReviews(data);

  } catch (err) {
    console.warn('[venue-page] load error:', err);
    renderEmpty();
  }
})();
