// Shared logic for static venue review pages.
// Each venue HTML page defines window.VENUE before loading this script.

(async () => {
  if (!window.VENUE) { console.error('[venue-page] VENUE config missing'); return; }

  const statsEl = document.getElementById('vpStats');
  const listEl  = document.getElementById('vpReviewList');
  const titleEl = document.getElementById('vpReviewsTitle');

  function escHtml(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function starsFull(n) {
    n = Math.max(0, Math.min(5, Math.round(Number(n) || 0)));
    return '★'.repeat(n) + '☆'.repeat(5 - n);
  }

  function timeAgo(ts) {
    const d = Math.floor((Date.now() - new Date(ts)) / 86400000);
    if (d < 1)   return 'Today';
    if (d < 7)   return `${d}d ago`;
    if (d < 30)  return `${Math.floor(d/7)}w ago`;
    if (d < 365) return `${Math.floor(d/30)}mo ago`;
    return `${Math.floor(d/365)}y ago`;
  }

  function renderEmpty() {
    if (statsEl) statsEl.style.display = 'none';
    if (listEl)  listEl.innerHTML = `
      <div class="vp-empty">
        <div class="vp-empty-dash">— —</div>
        <div class="vp-empty-title">No reviews yet</div>
        <div class="vp-empty-sub">Be the first band to review ${escHtml(VENUE.name)}</div>
        <a href="../map.html" class="vp-empty-cta">Leave a Review →</a>
      </div>`;
  }

  function renderStats(reviews) {
    if (!statsEl) return;
    const total     = reviews.length;
    const avgOver   = (reviews.reduce((s,r) => s + (r.overall_rating||0), 0) / total).toFixed(1);
    const withRet   = reviews.filter(r => r.would_return);
    const yesPct    = withRet.length ? Math.round(withRet.filter(r => r.would_return === 'yes').length / withRet.length * 100) : null;
    const avgSound  = (reviews.reduce((s,r) => s + (r.sound_rating||0), 0) / total).toFixed(1);

    statsEl.innerHTML = `
      <div class="vp-stat">
        <div class="vp-stat-num">${total}</div>
        <div class="vp-stat-label">Band review${total !== 1 ? 's' : ''}</div>
      </div>
      <div class="vp-stat-divider"></div>
      <div class="vp-stat">
        <div class="vp-stat-num">${avgOver}</div>
        <div class="vp-stat-label">Avg rating</div>
      </div>
      <div class="vp-stat-divider"></div>
      <div class="vp-stat">
        <div class="vp-stat-num">${yesPct !== null ? yesPct + '%' : '—'}</div>
        <div class="vp-stat-label">Would play again</div>
      </div>
      <div class="vp-stat-divider"></div>
      <div class="vp-stat">
        <div class="vp-stat-num">${avgSound}</div>
        <div class="vp-stat-label">Sound avg</div>
      </div>`;
  }

  function renderReviews(reviews) {
    if (!listEl) return;
    if (titleEl) titleEl.textContent = `${reviews.length} Band Review${reviews.length !== 1 ? 's' : ''}`;

    listEl.innerHTML = reviews.map(r => {
      const band = r.bands || {};

      // Avatar
      let avatar;
      if (r.is_anonymous) {
        avatar = `<div class="vp-avatar vp-avatar--anon"><svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2"><circle cx="8" cy="5.5" r="2.5"/><path d="M3 13c0-2.76 2.24-5 5-5s5 2.24 5 5"/></svg></div>`;
      } else if (band.profile_photo_url) {
        avatar = `<img src="${escHtml(band.profile_photo_url)}" class="vp-avatar vp-avatar--img" alt="${escHtml(band.band_name)}">`;
      } else {
        const initials = (band.band_name || 'B').substring(0, 2).toUpperCase();
        avatar = `<div class="vp-avatar">${initials}</div>`;
      }

      // Band name — link to EPK if they have one
      let bandName;
      if (r.is_anonymous) {
        bandName = `<span class="vp-band-name vp-band-anon">Verified Band — Identity Protected</span>`;
      } else {
        const slug    = (band.band_name || '').toLowerCase().replace(/\s+/g,'-').replace(/[^a-z0-9-]/g,'');
        const epkHref = band.epk_theme && slug ? `../epk.html?band=${slug}` : null;
        bandName = epkHref
          ? `<a href="${epkHref}" class="vp-band-name vp-band-link">${escHtml(band.band_name || 'Anonymous Band')}</a>`
          : `<span class="vp-band-name">${escHtml(band.band_name || 'Anonymous Band')}</span>`;
      }

      const metaParts = [];
      if (!r.is_anonymous && band.genre)     metaParts.push(escHtml(band.genre));
      if (!r.is_anonymous && band.home_city) metaParts.push(escHtml(band.home_city));
      metaParts.push(timeAgo(r.created_at));
      const metaLine = metaParts.join(' · ');

      const editedBadge = r.is_edited
        ? `<span class="vp-edited-badge">Edited ${new Date(r.edited_at).toLocaleDateString('en-US',{month:'short',year:'numeric'})}</span>`
        : '';

      // Stars
      const stars = `<div class="vp-stars">${starsFull(r.overall_rating)}</div>`;

      // Would-return badge
      const returnLabel = { yes: '✓ Would play here again', maybe: '~ Would consider returning', no: '✕ Would not return' };
      const returnClass = { yes: 'vp-return-yes', maybe: 'vp-return-maybe', no: 'vp-return-no' };
      const returnBadge = r.would_return
        ? `<div class="vp-return-tag ${returnClass[r.would_return] || ''}">${returnLabel[r.would_return] || ''}</div>`
        : '';

      // Genre played chip
      const genrePlayed = r.genre_played
        ? `<div class="vp-genre-played">Played as: <span>${escHtml(r.genre_played)}</span></div>`
        : '';

      // Sub-ratings
      const subRatings = `
        <div class="vp-sub-ratings">
          <div class="vp-sub"><span>Sound</span><strong>${r.sound_rating}/5</strong></div>
          <div class="vp-sub"><span>Comms</span><strong>${r.comms_rating}/5</strong></div>
          <div class="vp-sub"><span>Merch</span><strong>${r.merch_rating}/5</strong></div>
          <div class="vp-sub"><span>Parking</span><strong>${r.parking_rating}/5</strong></div>
        </div>`;

      // Band tip
      const tipBlock = r.band_tip
        ? `<div class="vp-review-tip"><span class="vp-tip-label">Tip for bands</span>${escHtml(r.band_tip)}</div>`
        : '';

      return `
        <div class="vp-review-card">
          <div class="vp-review-header">
            ${avatar}
            <div class="vp-review-header-body">
              <div class="vp-review-top-row">
                ${bandName}
                ${editedBadge}
                ${stars}
              </div>
              <div class="vp-review-meta">${metaLine}</div>
            </div>
          </div>
          ${genrePlayed}
          ${r.review_text ? `<p class="vp-review-text">${escHtml(r.review_text)}</p>` : ''}
          ${subRatings}
          ${tipBlock}
          ${returnBadge}
        </div>`;
    }).join('');
  }

  // Generate "What Bands Are Saying" paragraph from review data
  function synthesizeBio(reviews) {
    const el = document.getElementById('vpSynthBio');
    if (!el) return;

    const total    = reviews.length;
    const avgOver  = (reviews.reduce((s,r) => s + (r.overall_rating||0), 0) / total).toFixed(1);
    const withRet  = reviews.filter(r => r.would_return);
    const yesPct   = withRet.length
      ? Math.round(withRet.filter(r => r.would_return === 'yes').length / withRet.length * 100)
      : null;

    // Find standout sub-categories (avg >= 4.5)
    const cats = [
      { label: 'sound',         field: 'sound_rating' },
      { label: 'communication', field: 'comms_rating' },
      { label: 'merch space',   field: 'merch_rating' },
      { label: 'parking',       field: 'parking_rating' },
    ];
    const standouts = cats
      .map(c => ({ ...c, avg: reviews.reduce((s,r) => s + (r[c.field]||0), 0) / total }))
      .filter(c => c.avg >= 4.5)
      .map(c => c.label);

    // Pull up to 2 non-empty review quotes
    const quotes = reviews
      .filter(r => r.review_text && r.review_text.trim().length > 40)
      .slice(0, 2);

    // Build paragraph
    let para = `Bands rate ${VENUE.name} ${avgOver}/5 on average`;
    if (yesPct !== null) para += `, and ${yesPct}% say they'd play here again`;
    para += '.';

    if (standouts.length) {
      const joined = standouts.length === 1
        ? standouts[0]
        : standouts.slice(0, -1).join(', ') + ' and ' + standouts.slice(-1)[0];
      para += ` Bands consistently highlight ${joined} as standouts.`;
    }

    if (quotes.length) {
      const q = quotes[0].review_text.trim();
      para += ` "${q.length > 180 ? q.slice(0, 177) + '…' : q}"`;
    }

    el.textContent = para;
  }

  // Load Google Place photos into #vpPhotos if element exists
  function loadPlacePhotos(placeId) {
    const photoEl = document.getElementById('vpPhotos');
    if (!photoEl || !placeId || typeof BANDMATE_MAPS_KEY === 'undefined') return;

    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${BANDMATE_MAPS_KEY}&libraries=places&callback=_vpMapsReady`;
    window._vpMapsReady = () => {
      const dummy = document.createElement('div');
      const svc   = new google.maps.places.PlacesService(dummy);
      svc.getDetails({ placeId, fields: ['photos', 'url', 'website'] }, (result, status) => {
        if (status !== 'OK' || !result.photos?.length) return;
        const photos = result.photos.slice(0, 6);
        photoEl.innerHTML = photos.map(p => {
          const url = p.getUrl({ maxWidth: 800, maxHeight: 500 });
          return `<div class="vp-photo"><img src="${url}" alt="${escHtml(VENUE.name)}" loading="lazy"></div>`;
        }).join('');
        photoEl.classList.add('vp-photos--loaded');
        if (result.website) {
          const siteEl = document.getElementById('vpWebsite');
          if (siteEl) { siteEl.href = result.website; siteEl.style.display = 'inline'; }
        }
      });
    };
    document.head.appendChild(script);
  }

  try {
    if (typeof supabase === 'undefined' || typeof BANDMATE_SUPABASE_URL === 'undefined' || typeof BANDMATE_SUPABASE_KEY === 'undefined') {
      renderEmpty(); return;
    }

    const sb = supabase.createClient(BANDMATE_SUPABASE_URL, BANDMATE_SUPABASE_KEY);

    const { data } = await sb.from('reviews')
      .select('*, bands(band_name, genre, home_city, profile_photo_url, epk_theme)')
      .eq('google_place_id', VENUE.placeId)
      .order('created_at', { ascending: false });

    if (!data || data.length === 0) { renderEmpty(); return; }

    renderStats(data);
    renderReviews(data);
    synthesizeBio(data);
    loadPlacePhotos(VENUE.placeId);

  } catch (err) {
    console.warn('[venue-page] load error:', err);
    renderEmpty();
  }
})();
