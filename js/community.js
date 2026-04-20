// community.js — Bandmate Community feed: postings, interests, notifications

// ── Module state ──────────────────────────────────────────────────────────────

let _allPostings       = [];   // all active postings from Supabase
let _myInterests       = {};   // { "postingId_dateId": 'pending'|'accepted'|'declined' }
let _acceptedByPosting = {};   // { postingId: [band, ...] } — publicly visible confirmed bands
let _venueRatings      = {};   // { place_id: { avg, count } }
let _filters           = { search: '', type: 'all', genre: '', location: '', length: 'all', sort: 'recent' };
let _postType          = null;
let _slotsNeeded       = 1;
let _editingPostingId  = null; // null = new post, number = editing existing
let _deletePostingId   = null;
let _interestPostingId = null;
let _interestDates     = [];
let _managePostingId   = null;
let _mapsLoaded        = false;
let _cityAutocompletes = [];
let _chatPostingId     = null; // for direct messaging
let _chatChannel       = null; // supabase realtime channel for chat
let _feedChannel       = null; // supabase realtime channel for feed updates

const TYPE_LABELS = { tour_support: 'Tour Support', local_opener: 'Local Opener', co_headlining: 'Co-Headlining' };
const GENRES = ['Rock','Indie','Folk','Alternative','Country','Jazz','Blues','Hip-Hop','Electronic','Punk','Metal','R&B','Soul','Acoustic','Americana','Pop','Experimental'];

// ── Best Match scoring ────────────────────────────────────────────────────────
// Scores a posting for the current user. Max 100 points.
// genre overlap +40 | city match +30 | review trust +20 | recency +10

function _scorePosting(p) {
  let score = 0;
  const bp   = currentBandProfile;

  // Genre overlap (+40)
  if (bp?.genre && p.genres?.length) {
    const myGenres = bp.genre.split(',').map(g => g.trim().toLowerCase());
    const hits     = (p.genres || []).filter(g => myGenres.some(mg => g.toLowerCase().includes(mg) || mg.includes(g.toLowerCase())));
    score += Math.min(40, hits.length * 20);
  }

  // City match: any date in user's home city (+30)
  if (bp?.home_city) {
    const myCity = bp.home_city.toLowerCase().split(',')[0].trim();
    const match  = (p.posting_dates || []).some(d => d.city.toLowerCase().includes(myCity));
    if (match) score += 30;
  }

  // Review trust: posting band's review count (+20 for ≥3)
  const rc = p.bands?.review_count || 0;
  score += rc >= 3 ? 20 : rc >= 1 ? 10 : 0;

  // Recency: posted within 7 days (+10)
  const ageMs = Date.now() - new Date(p.created_at).getTime();
  if (ageMs < 7 * 86400000) score += 10;

  return score;
}

// ── Init ─────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  await initAuth();
  _buildGenreFilters();
  renderSkeletons();
  await fetchPostings();
  _subscribeToFeed();

  // Tour Planner integration — open pre-filled post modal if redirected from tour.html
  if (new URLSearchParams(window.location.search).has('fromtour')) {
    const raw = sessionStorage.getItem('comm_prefill');
    sessionStorage.removeItem('comm_prefill');
    if (raw) {
      try {
        const prefill = JSON.parse(raw);
        // Wait a tick for auth to settle, then check premium and open modal
        setTimeout(() => {
          if (!currentUser) { openAuth('login'); return; }
          if (!isBandPremium(currentBandProfile)) { openPostModal(); return; }
          _editingPostingId = null;
          _openPostForm(prefill);
        }, 200);
      } catch (_) {}
    }
  }
});

// ── Realtime: live feed + notification bell ───────────────────────────────────

function _subscribeToFeed() {
  if (_feedChannel) { sb.removeChannel(_feedChannel); _feedChannel = null; }

  const myBandId = currentBandProfile?.id;
  let channel = sb.channel('community_feed')
    .on('postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'tour_postings' },
      async payload => {
        // Skip our own posts (already added via submitPosting → fetchPostings)
        if (currentBandProfile && payload.new.band_id === currentBandProfile.id) return;
        // Refresh feed and show toast
        await fetchPostings();
        _showFeedToast();
      }
    );

  // Only subscribe to personal notification changes when logged in
  if (myBandId) {
    channel = channel
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notifications', filter: `band_id=eq.${myBandId}` },
        async () => { await loadNotifCount(); }
      );
  }

  _feedChannel = channel.subscribe();
}

let _feedToastTimer = null;
function _showFeedToast() {
  clearTimeout(_feedToastTimer);
  const existing = document.getElementById('feedNewToast');
  if (existing) existing.remove();
  const el = document.createElement('div');
  el.id        = 'feedNewToast';
  el.className = 'comm-feed-toast';
  el.innerHTML = 'New posting added — <button onclick="document.getElementById(\'commFeed\').scrollIntoView({behavior:\'smooth\'});this.parentElement.remove()">View</button>';
  document.body.appendChild(el);
  _feedToastTimer = setTimeout(() => el.remove(), 8000);
}

// ── Data fetching ─────────────────────────────────────────────────────────────

async function fetchPostings() {
  const { data, error } = await sb
    .from('tour_postings')
    .select(`*, bands(id, band_name, genre, home_city, profile_photo_url, epk_theme, review_count), posting_dates(id, date, city, venue_name, venue_place_id, venue_address)`)
    .eq('is_active', true)
    .order('created_at', { ascending: false });

  if (error) {
    document.getElementById('commFeed').innerHTML = `<div class="comm-empty"><p class="comm-empty-title">Could not load postings</p><p class="comm-empty-sub">${escapeHtml(error.message)}</p></div>`;
    return;
  }

  (data || []).forEach(p => {
    if (p.posting_dates) p.posting_dates.sort((a, b) => a.date.localeCompare(b.date));
  });
  _allPostings = data || [];

  // Fetch publicly visible accepted bands for all postings
  const { data: accepted } = await sb
    .from('posting_interests')
    .select('posting_id, bands(id, band_name, profile_photo_url, epk_theme)')
    .eq('status', 'accepted');
  _acceptedByPosting = {};
  (accepted || []).forEach(i => {
    if (!_acceptedByPosting[i.posting_id]) _acceptedByPosting[i.posting_id] = [];
    if (i.bands) _acceptedByPosting[i.posting_id].push(i.bands);
  });

  // Collect all unique place IDs from posting dates and fetch their ratings
  const placeIds = [...new Set(
    (data || []).flatMap(p => (p.posting_dates || []).map(d => d.venue_place_id).filter(Boolean))
  )];
  _venueRatings = {};
  if (placeIds.length) {
    const { data: reviews } = await sb
      .from('reviews')
      .select('google_place_id, overall_rating')
      .in('google_place_id', placeIds);
    (reviews || []).forEach(r => {
      if (!_venueRatings[r.google_place_id]) _venueRatings[r.google_place_id] = { sum: 0, count: 0 };
      _venueRatings[r.google_place_id].sum   += r.overall_rating;
      _venueRatings[r.google_place_id].count += 1;
    });
    // Convert to avg
    Object.keys(_venueRatings).forEach(pid => {
      const v = _venueRatings[pid];
      v.avg = v.sum / v.count;
    });
  }

  // Fetch my own interests if logged in
  if (currentBandProfile) {
    const { data: interests } = await sb
      .from('posting_interests')
      .select('posting_id, posting_date_id, status')
      .eq('band_id', currentBandProfile.id);
    _myInterests = {};
    (interests || []).forEach(i => {
      _myInterests[`${i.posting_id}_${i.posting_date_id}`] = i.status;
    });
  }

  applyFilters();
}

// ── Rendering ─────────────────────────────────────────────────────────────────

function renderSkeletons() {
  const feed = document.getElementById('commFeed');
  feed.innerHTML = [1,2,3].map(() => `
    <div class="comm-skeleton">
      <div class="comm-skel-line comm-skel-line--short"></div>
      <div class="comm-skel-line"></div>
      <div class="comm-skel-line comm-skel-line--med"></div>
      <div class="comm-skel-line comm-skel-line--short" style="margin-top:16px"></div>
      <div class="comm-skel-line comm-skel-line--short"></div>
    </div>`).join('');
}

function renderFeed(postings) {
  const feed = document.getElementById('commFeed');
  if (!postings.length) {
    feed.innerHTML = `
      <div class="comm-empty">
        <div class="comm-empty-title">Nothing posted yet</div>
        <div class="comm-empty-sub">Be the first to post an opportunity in your area</div>
        <button class="comm-post-btn" onclick="openPostModal()">Post an Opportunity</button>
      </div>`;
    return;
  }
  feed.innerHTML = postings.map(renderCard).join('');
}

function renderCard(p) {
  const band       = p.bands || {};
  const dates      = p.posting_dates || [];
  const isOwn      = currentBandProfile && currentBandProfile.id === band.id;
  const slug       = (band.band_name || '').toLowerCase().replace(/\s+/g,'-').replace(/[^a-z0-9-]/g,'');
  const hasEpk     = !!band.epk_theme && slug;
  const slots      = p.slots_needed || 1;
  const confirmed  = _acceptedByPosting[p.id] || [];

  // Avatar
  const initials  = (band.band_name || 'B').substring(0,2).toUpperCase();
  const avatarEl  = band.profile_photo_url
    ? `<img src="${band.profile_photo_url}" class="comm-avatar comm-avatar-img" alt="">`
    : `<div class="comm-avatar comm-avatar-init">${initials}</div>`;
  const avatarWrapped = hasEpk
    ? `<a href="epk.html?band=${slug}" target="_blank" class="comm-avatar-link">${avatarEl}</a>`
    : avatarEl;

  // Type badge
  const badgeClass = { tour_support: 'comm-badge--support', local_opener: 'comm-badge--opener', co_headlining: 'comm-badge--cohead' }[p.type] || '';
  const badge = `<span class="comm-type-badge ${badgeClass}">${TYPE_LABELS[p.type] || p.type}</span>`;

  // Trust score
  const rc = band.review_count || 0;
  const trustHtml = rc > 0
    ? `<div class="comm-trust">★ ${rc} review${rc !== 1 ? 's' : ''}</div>`
    : '';

  // Tour route
  const cityNames  = dates.map(d => d.city.split(',')[0].trim());
  const routeParts = cityNames.slice(0, 3);
  const moreCount  = cityNames.length > 3 ? cityNames.length - 3 : 0;
  const routeHtml  = routeParts.join(' <span class="comm-route-arrow">→</span> ') + (moreCount ? ` <span class="comm-route-more">+${moreCount} more</span>` : '');

  // Date range
  const fmt = d => new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const dateRange = dates.length
    ? dates.length === 1
      ? fmt(dates[0].date)
      : `${fmt(dates[0].date)} – ${fmt(dates[dates.length-1].date)}`
    : '';

  // Genre tags
  const genreTagsHtml = (p.genres || []).map(g =>
    `<span class="vrc-tag" style="border-color:var(--rust);color:var(--rust)">${escapeHtml(g)}</span>`
  ).join('');

  // Description truncation
  const desc = p.description || '';
  const truncated = desc.length > 200;
  const descShort = truncated ? desc.substring(0, 200).trim() + '…' : desc;
  const descHtml = `<div class="comm-description" id="desc-${p.id}">
    <span class="comm-desc-text">${escapeHtml(descShort)}</span>
    ${truncated ? `<button class="comm-read-more" onclick="expandDesc(${p.id},${JSON.stringify(desc)})">Read more</button>` : ''}
  </div>`;

  // Dates list (max 3 shown)
  const shownDates  = dates.slice(0, 3);
  const extraDates  = dates.length > 3 ? dates.length - 3 : 0;
  const datesHtml   = shownDates.map(d => {
    const key     = `${p.id}_${d.id}`;
    const status  = _myInterests[key];
    const active  = !!status;
    const btnText = active ? 'Interested ✓' : 'Interested';
    const btnCls  = active ? 'comm-interested-btn comm-interested-btn--active' : 'comm-interested-btn';
    const fmtDate = new Date(d.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const interestClick = isOwn ? '' : `onclick="handleInterested(${p.id},${d.id})"`;

    // Venue info
    let venueHtml = '';
    if (d.venue_name) {
      const rating   = d.venue_place_id ? _venueRatings[d.venue_place_id] : null;
      const starsHtml = rating
        ? (() => {
            const full  = Math.round(rating.avg);
            const stars = '★'.repeat(full) + '☆'.repeat(5 - full);
            return `<span class="comm-venue-stars">${stars}</span><span class="comm-venue-count">${rating.avg.toFixed(1)} (${rating.count})</span>`;
          })()
        : '<span class="comm-venue-no-reviews">No reviews yet</span>';
      const venueLink = d.venue_place_id
        ? `<a class="comm-venue-name" href="map.html?place=${encodeURIComponent(d.venue_place_id)}" target="_blank">${escapeHtml(d.venue_name)}</a>`
        : `<span class="comm-venue-name">${escapeHtml(d.venue_name)}</span>`;
      venueHtml = `<div class="comm-venue-row">${venueLink}<div class="comm-venue-rating">${starsHtml}</div></div>`;
    }

    return `<div class="comm-date-row">
      <div class="comm-date-row-left">
        <span class="comm-date-label">${fmtDate} · ${escapeHtml(d.city)}</span>
        ${venueHtml}
      </div>
      ${!isOwn ? `<button class="${btnCls}" ${interestClick}>${btnText}</button>` : ''}
    </div>`;
  }).join('');

  // Confirmed bands strip
  const typeWord = { tour_support: 'opener', local_opener: 'touring support', co_headlining: 'co-headliner' }[p.type] || 'band';
  const confirmedHtml = confirmed.length ? `
    <div class="comm-confirmed-strip">
      <div class="comm-confirmed-avatars">
        ${confirmed.map(b => {
          const bInit = (b.band_name || 'B').substring(0,2).toUpperCase();
          const bSlug = (b.band_name||'').toLowerCase().replace(/\s+/g,'-').replace(/[^a-z0-9-]/g,'');
          const av = b.profile_photo_url
            ? `<img src="${b.profile_photo_url}" class="comm-confirmed-avatar" title="${escapeHtml(b.band_name)}" alt="">`
            : `<div class="comm-confirmed-avatar comm-confirmed-avatar-init" title="${escapeHtml(b.band_name)}">${bInit}</div>`;
          return b.epk_theme && bSlug
            ? `<a href="epk.html?band=${bSlug}" target="_blank" class="comm-confirmed-link">${av}</a>`
            : av;
        }).join('')}
      </div>
      <div class="comm-confirmed-text">
        <span class="comm-confirmed-check">✓</span>
        ${confirmed.length === 1
          ? `<strong>${escapeHtml(confirmed[0].band_name)}</strong> is confirmed as ${typeWord}`
          : `<strong>${confirmed.map(b => escapeHtml(b.band_name)).join('</strong> &amp; <strong>')}</strong> are confirmed`}
        ${slots > 1 ? `<span class="comm-confirmed-slots"> · ${confirmed.length} of ${slots} slots filled</span>` : ''}
      </div>
    </div>` : '';

  // Posted ago + New badge
  const diffMs  = Date.now() - new Date(p.created_at).getTime();
  const diffDay = Math.floor(diffMs / 86400000);
  const postedAgo = diffDay < 1 ? 'Today' : diffDay === 1 ? '1 day ago' : `${diffDay} days ago`;
  const isNew     = diffMs < 48 * 3600000; // < 48 hours

  // Best Match badge + Similar tag
  const matchScore   = currentBandProfile && !isOwn ? _scorePosting(p) : 0;
  const isBestMatch  = matchScore >= 70;
  const bp           = currentBandProfile;
  const isSimilar    = !isOwn && bp?.genre && (p.genres || []).some(g => {
    const myGenres = bp.genre.split(',').map(x => x.trim().toLowerCase());
    return myGenres.some(mg => g.toLowerCase().includes(mg) || mg.includes(g.toLowerCase()));
  });
  const interestCount = p.interest_count || 0;

  // Slots indicator (only show if looking for more than 1)
  const slotsHtml = slots > 1
    ? `<div class="comm-slots-indicator">Looking for ${slots} band${slots > 1 ? 's' : ''} · ${slots - confirmed.length} spot${slots - confirmed.length !== 1 ? 's' : ''} remaining</div>`
    : '';

  // Footer actions
  const epkBtn = hasEpk
    ? `<a class="comm-card-btn comm-card-btn--outline" href="epk.html?band=${slug}" target="_blank">View EPK</a>`
    : '';
  const actionBtn = isOwn
    ? `<button class="comm-card-btn comm-card-btn--manage" onclick="openManageModal(${p.id})">Manage Responses</button>`
    : `<button class="comm-card-btn comm-card-btn--rust" onclick="openInterestModal(${p.id})">Express Interest</button>`;
  const ownerTools = isOwn ? `
    <button class="comm-card-btn comm-card-btn--outline" onclick="openEditModal(${p.id})" title="Edit">Edit</button>
    <button class="comm-card-btn comm-card-btn--delete" onclick="openDeleteModal(${p.id})" title="Delete">Delete</button>` : '';

  return `<article class="comm-card${isBestMatch ? ' comm-card--best-match' : ''}" id="comm-card-${p.id}">
    <div class="comm-card-header">
      <div class="comm-card-band">
        ${avatarWrapped}
        <div class="comm-band-info">
          <div class="comm-band-name">${escapeHtml(band.band_name || 'Unknown Band')}</div>
          <div class="comm-band-meta">${escapeHtml([band.genre, band.home_city].filter(Boolean).join(' · '))}</div>
          ${trustHtml}
        </div>
      </div>
      <div class="comm-card-badges">
        ${isBestMatch ? '<span class="comm-best-match-badge">Best Match</span>' : ''}
        ${isNew       ? '<span class="comm-new-badge">New</span>' : ''}
        ${badge}
      </div>
    </div>

    ${isSimilar ? '<div class="comm-similar-tag">Similar to your sound</div>' : ''}
    ${dates.length ? `<div class="comm-tour-route">${routeHtml}</div>` : ''}
    ${dateRange     ? `<div class="comm-date-range">${dateRange}</div>` : ''}
    ${slotsHtml}
    ${genreTagsHtml ? `<div class="comm-genre-tags">${genreTagsHtml}</div>` : ''}

    <div class="comm-card-title">${escapeHtml(p.title)}</div>
    ${descHtml}

    ${dates.length ? `<div class="comm-dates-list">
      ${datesHtml}
      ${extraDates ? `<div class="comm-view-all-dates" onclick="openInterestModal(${p.id})">View all ${dates.length} dates →</div>` : ''}
    </div>` : ''}

    ${confirmedHtml}

    <div class="comm-card-footer">
      <span class="comm-posted-ago">${postedAgo}${interestCount > 0 ? ` · ${interestCount} interested` : ''}</span>
      <div class="comm-card-actions">${epkBtn}${actionBtn}${ownerTools}</div>
    </div>
  </article>`;
}

function expandDesc(postingId, fullText) {
  const el = document.getElementById(`desc-${postingId}`);
  if (el) el.innerHTML = `<span class="comm-desc-text">${escapeHtml(fullText)}</span>`;
}

// ── Filters ───────────────────────────────────────────────────────────────────

function applyFilters() {
  let results = _allPostings;
  const { search, type, genre, location, length } = _filters;

  if (type !== 'all') {
    results = results.filter(p => p.type === type);
  }
  if (search) {
    const q = search.toLowerCase();
    results = results.filter(p =>
      p.title.toLowerCase().includes(q) ||
      p.description.toLowerCase().includes(q) ||
      (p.bands?.band_name || '').toLowerCase().includes(q) ||
      (p.posting_dates || []).some(d => d.city.toLowerCase().includes(q))
    );
  }
  if (genre) {
    const gq = genre.toLowerCase();
    results = results.filter(p => (p.genres || []).some(g => g.toLowerCase().includes(gq)));
  }
  if (location) {
    const lq = location.toLowerCase();
    results = results.filter(p => (p.posting_dates || []).some(d => d.city.toLowerCase().includes(lq)));
  }
  if (length === 'single')  results = results.filter(p => (p.posting_dates || []).length === 1);
  if (length === 'weekend') results = results.filter(p => (p.posting_dates || []).length >= 2 && (p.posting_dates || []).length <= 3);
  if (length === 'full')    results = results.filter(p => (p.posting_dates || []).length >= 4);

  // Sorting
  if (_filters.sort === 'best_match' && currentBandProfile) {
    results = results.map(p => ({ p, score: _scorePosting(p) }))
      .sort((a, b) => b.score - a.score)
      .map(x => x.p);
  }
  // 'recent' is already server-sorted by created_at desc

  renderFeed(results);
}

function onFilterChange() {
  _filters.search   = document.getElementById('commSearch').value.trim();
  _filters.location = document.getElementById('commLocation').value.trim();
  applyFilters();
}

function setTypeFilter(btn) {
  document.querySelectorAll('#typeChips .comm-chip').forEach(b => b.classList.remove('comm-chip--active'));
  btn.classList.add('comm-chip--active');
  _filters.type = btn.dataset.value;
  applyFilters();
}

function setGenreFilter(btn) {
  document.querySelectorAll('#genreChips .comm-chip').forEach(b => b.classList.remove('comm-chip--active'));
  btn.classList.add('comm-chip--active');
  _filters.genre = btn.dataset.value;
  applyFilters();
}

function setLengthFilter(btn) {
  document.querySelectorAll('#lengthChips .comm-chip').forEach(b => b.classList.remove('comm-chip--active'));
  btn.classList.add('comm-chip--active');
  _filters.length = btn.dataset.value;
  applyFilters();
}

function setSortFilter(btn) {
  document.querySelectorAll('#sortChips .comm-chip').forEach(b => b.classList.remove('comm-chip--active'));
  btn.classList.add('comm-chip--active');
  _filters.sort = btn.dataset.value;
  applyFilters();
}

function clearFilters() {
  _filters = { search: '', type: 'all', genre: '', location: '', length: 'all', sort: 'recent' };
  document.getElementById('commSearch').value   = '';
  document.getElementById('commLocation').value = '';
  document.querySelectorAll('#typeChips   .comm-chip').forEach((b,i) => b.classList.toggle('comm-chip--active', i===0));
  document.querySelectorAll('#genreChips  .comm-chip').forEach((b,i) => b.classList.toggle('comm-chip--active', i===0));
  document.querySelectorAll('#lengthChips .comm-chip').forEach((b,i) => b.classList.toggle('comm-chip--active', i===0));
  document.querySelectorAll('#sortChips   .comm-chip').forEach((b,i) => b.classList.toggle('comm-chip--active', i===0));
  applyFilters();
}

function _buildGenreFilters() {
  const wrap = document.getElementById('genreChips');
  GENRES.forEach(g => {
    const btn = document.createElement('button');
    btn.className    = 'comm-chip';
    btn.dataset.value = g;
    btn.textContent  = g;
    btn.onclick      = () => setGenreFilter(btn);
    wrap.appendChild(btn);
  });
}

// ── Post Modal ────────────────────────────────────────────────────────────────

function openPostModal() {
  if (!currentUser) { openAuth('login'); return; }
  if (!isBandPremium(currentBandProfile)) {
    // Show modal with a locked state explaining the requirement
    const rc = currentBandProfile?.review_count || 0;
    const needed = 3 - rc;
    document.getElementById('postModal').classList.add('open');
    // Swap modal contents to locked state
    const modal = document.querySelector('#postModal .comm-modal');
    if (!modal._originalContent) modal._originalContent = modal.innerHTML;
    modal.innerHTML = `
      <button class="modal-close" onclick="closePostModal()">✕</button>
      <div class="modal-eyebrow">Post an Opportunity</div>
      <div class="modal-title">Unlock Community Posting</div>
      <div class="comm-locked-body">
        <div class="comm-locked-icon">🔒</div>
        <p class="comm-locked-msg">To keep the community high-quality, posting requires at least <strong>3 venue reviews</strong>.</p>
        <div class="comm-locked-progress">
          <div class="comm-locked-progress-bar" style="width:${Math.min(100, (rc/3)*100)}%"></div>
        </div>
        <div class="comm-locked-count">${rc} / 3 reviews left</div>
        <p class="comm-locked-sub">You need <strong>${needed} more review${needed !== 1 ? 's' : ''}</strong> to unlock posting. Head to the venue map and share your experience.</p>
        <a href="map.html#leave-review" class="comm-submit-btn" style="display:block;text-align:center;text-decoration:none;margin-top:20px">Leave a Review →</a>
      </div>`;
    return;
  }
  _editingPostingId = null;
  _openPostForm();
}

function openEditModal(postingId) {
  const p = _allPostings.find(x => x.id === postingId);
  if (!p) return;
  _editingPostingId = postingId;
  _openPostForm(p);
}

function _openPostForm(prefill) {
  // Reset state
  _postType    = prefill?.type || null;
  _slotsNeeded = prefill?.slots_needed || 1;

  document.querySelectorAll('#postTypeCards .comm-type-card').forEach(c => {
    c.classList.toggle('comm-type-card--active', prefill && c.dataset.type === prefill.type);
  });
  document.querySelectorAll('.comm-slot-btn').forEach(b => {
    b.classList.toggle('comm-slot-btn--active', parseInt(b.dataset.value) === _slotsNeeded);
  });
  document.getElementById('postTitle').value       = prefill?.title || '';
  document.getElementById('postDescription').value = prefill?.description || '';
  document.getElementById('postDescHint').textContent = '';
  document.getElementById('postErr').textContent   = '';
  document.getElementById('postDateRows').innerHTML = '';

  const contactPref = prefill?.contact_preference || 'bandmate';
  document.querySelector(`input[name="postContact"][value="${contactPref}"]`).checked = true;
  document.getElementById('postContactEmailRow').style.display = contactPref === 'email' ? 'block' : 'none';
  if (prefill?.contact_email) document.getElementById('postContactEmail').value = prefill.contact_email;

  const submitBtn = document.getElementById('postSubmitBtn');
  submitBtn.disabled = false;
  submitBtn.textContent = _editingPostingId ? 'Save Changes →' : 'Post to Community →';

  // Eyebrow / title
  document.querySelector('#postModal .modal-eyebrow').textContent = _editingPostingId ? 'Edit Opportunity' : 'Post an Opportunity';
  document.querySelector('#postModal .modal-title').textContent   = _editingPostingId ? 'Update your posting' : 'Tell bands what you need';

  // Genre chips — use shared system
  loadGenreChips('postGenreChips').then(() => {
    if (prefill?.genres?.length) preselectGenres('postGenreChips', prefill.genres.join(','));
  });

  // Date rows
  const dates = prefill?.posting_dates || [];
  if (dates.length) {
    dates.forEach(d => addDateRow(d));
  } else {
    addDateRow();
  }

  document.getElementById('postModal').classList.add('open');

  document.getElementById('postDescription').oninput = function() {
    const len = this.value.trim().length;
    const hint = document.getElementById('postDescHint');
    hint.textContent = len < 50 ? `${50 - len} more characters needed` : '';
    hint.style.color = len < 50 ? 'var(--rust)' : 'var(--muted)';
  };
}

function closePostModal() {
  document.getElementById('postModal').classList.remove('open');
  // Restore original modal content if it was swapped to locked state
  const modal = document.querySelector('#postModal .comm-modal');
  if (modal && modal._originalContent) {
    modal.innerHTML = modal._originalContent;
    modal._originalContent = null;
  }
}

function selectPostType(card) {
  document.querySelectorAll('#postTypeCards .comm-type-card').forEach(c => c.classList.remove('comm-type-card--active'));
  card.classList.add('comm-type-card--active');
  _postType = card.dataset.type;
}


function setSlots(btn) {
  document.querySelectorAll('.comm-slot-btn').forEach(b => b.classList.remove('comm-slot-btn--active'));
  btn.classList.add('comm-slot-btn--active');
  _slotsNeeded = parseInt(btn.dataset.value);
}

function addDateRow(prefill) {
  const container = document.getElementById('postDateRows');
  if (container.children.length >= 20) return;

  const row = document.createElement('div');
  row.className = 'comm-date-entry';
  row.innerHTML = `
    <input type="date" class="comm-modal-input comm-date-input" value="${prefill?.date || ''}">
    <div class="comm-venue-search-wrap">
      <input type="text" class="comm-modal-input comm-venue-input" placeholder="Search venue name…">
      <div class="comm-venue-selected" style="display:none"></div>
    </div>
    <button class="comm-remove-date" onclick="removeDateRow(this)" title="Remove">✕</button>`;
  container.appendChild(row);

  // Pre-fill venue data if editing
  if (prefill?.venue_name) {
    row.dataset.venueName    = prefill.venue_name;
    row.dataset.venuePlaceId = prefill.venue_place_id || '';
    row.dataset.venueAddress = prefill.venue_address || '';
    row.dataset.venueCity    = prefill.city || '';
    const chip = row.querySelector('.comm-venue-selected');
    const inp  = row.querySelector('.comm-venue-input');
    chip.innerHTML = `<span class="comm-venue-chip">${escapeHtml(prefill.venue_name)}<span class="comm-venue-chip-city">${prefill.city ? ' · ' + escapeHtml(prefill.city) : ''}</span></span>
      <button class="comm-venue-clear" onclick="clearVenue(this)" title="Change venue">✕</button>`;
    chip.style.display = 'flex';
    inp.style.display  = 'none';
  } else if (prefill?.city) {
    // No venue name but has city (legacy rows)
    row.dataset.venueCity = prefill.city;
    row.querySelector('.comm-venue-input').value = prefill.city;
  }

  if (_mapsLoaded) _attachVenueAC(row.querySelector('.comm-venue-input'));
}

function removeDateRow(btn) {
  const row = btn.closest('.comm-date-entry');
  if (document.querySelectorAll('.comm-date-entry').length <= 1) return;
  row.remove();
}

function _mapsReady() {
  _mapsLoaded = true;
  document.querySelectorAll('.comm-venue-input:not([data-ac])').forEach(input => {
    _attachVenueAC(input);
  });
}

function _attachVenueAC(input) {
  if (input.dataset.ac) return;
  input.dataset.ac = '1';
  if (typeof google === 'undefined' || !google.maps?.places) return;

  const ac = new google.maps.places.Autocomplete(input, {
    types:  ['establishment'],
    fields: ['place_id', 'name', 'formatted_address', 'address_components'],
  });

  ac.addListener('place_changed', () => {
    const place = ac.getPlace();
    if (!place?.place_id) return;

    const comps   = place.address_components || [];
    const city    = comps.find(c => c.types.includes('locality'))?.long_name || '';
    const state   = comps.find(c => c.types.includes('administrative_area_level_1'))?.short_name || '';
    const cityStr = [city, state].filter(Boolean).join(', ');

    // Store data on the row
    const row = input.closest('.comm-date-entry');
    row.dataset.venueName    = place.name || '';
    row.dataset.venuePlaceId = place.place_id || '';
    row.dataset.venueAddress = place.formatted_address || '';
    row.dataset.venueCity    = cityStr;

    // Show a confirmation chip
    const wrap = row.querySelector('.comm-venue-search-wrap');
    const chip = row.querySelector('.comm-venue-selected');
    chip.innerHTML = `<span class="comm-venue-chip">${escapeHtml(place.name)}<span class="comm-venue-chip-city">${cityStr ? ' · ' + cityStr : ''}</span></span>
      <button class="comm-venue-clear" onclick="clearVenue(this)" title="Change venue">✕</button>`;
    chip.style.display = 'flex';
    input.style.display = 'none';
  });

  _cityAutocompletes.push(ac);
}

function clearVenue(btn) {
  const row  = btn.closest('.comm-date-entry');
  const chip = row.querySelector('.comm-venue-selected');
  const inp  = row.querySelector('.comm-venue-input');
  chip.style.display = 'none';
  inp.style.display  = '';
  inp.value = '';
  delete row.dataset.venueName;
  delete row.dataset.venuePlaceId;
  delete row.dataset.venueAddress;
  delete row.dataset.venueCity;
  inp.focus();
}

function toggleContactEmail(radio) {
  document.getElementById('postContactEmailRow').style.display = radio.value === 'email' ? 'block' : 'none';
}

async function submitPosting() {
  const title       = document.getElementById('postTitle').value.trim();
  const description = document.getElementById('postDescription').value.trim();
  const contactPref = document.querySelector('input[name="postContact"]:checked')?.value || 'bandmate';
  const contactEmail = document.getElementById('postContactEmail').value.trim();
  const errEl       = document.getElementById('postErr');
  errEl.textContent = '';

  if (!_postType)               { errEl.textContent = 'Please select an opportunity type.'; return; }
  if (!title)                   { errEl.textContent = 'Title is required.'; return; }
  if (description.length < 50)  { errEl.textContent = 'Description must be at least 50 characters.'; return; }
  if (contactPref === 'email' && (!contactEmail || !contactEmail.includes('@'))) {
    errEl.textContent = 'Please enter a valid email address.'; return;
  }

  // Collect dates
  const dateRows = document.querySelectorAll('.comm-date-entry');
  const dates = [];
  for (const row of dateRows) {
    const dateVal    = row.querySelector('.comm-date-input').value;
    const venueName  = row.dataset.venueName  || '';
    const placeId    = row.dataset.venuePlaceId || '';
    const address    = row.dataset.venueAddress || '';
    const city       = row.dataset.venueCity   || row.querySelector('.comm-venue-input').value.trim();
    if (dateVal && (venueName || city)) {
      dates.push({ date: dateVal, city: city || venueName, venue_name: venueName || null, venue_place_id: placeId || null, venue_address: address || null });
    }
  }
  if (!dates.length) { errEl.textContent = 'Please add at least one date and venue.'; return; }

  const genres = getSelectedGenres('postGenreChips');
  const btn    = document.getElementById('postSubmitBtn');
  btn.disabled = true; btn.textContent = _editingPostingId ? 'Saving…' : 'Posting…';

  const postPayload = {
    type:               _postType,
    title,
    description,
    genres,
    slots_needed:       _slotsNeeded,
    contact_preference: contactPref,
    contact_email:      contactPref === 'email' ? contactEmail : null,
  };

  let postingId;

  if (_editingPostingId) {
    // Update existing posting
    const { error: updErr } = await sb.from('tour_postings').update(postPayload).eq('id', _editingPostingId);
    if (updErr) {
      errEl.textContent = 'Could not save — ' + updErr.message;
      btn.disabled = false; btn.textContent = 'Save Changes →';
      return;
    }
    // Replace all dates: delete old, insert new
    await sb.from('posting_dates').delete().eq('posting_id', _editingPostingId);
    postingId = _editingPostingId;
  } else {
    // Insert new posting
    const { data: posting, error: postErr } = await sb.from('tour_postings').insert({
      band_id: currentBandProfile.id,
      ...postPayload,
    }).select().single();
    if (postErr) {
      errEl.textContent = 'Could not post — ' + postErr.message;
      btn.disabled = false; btn.textContent = 'Post to Community →';
      return;
    }
    postingId = posting.id;
  }

  // Insert dates
  const dateInserts = dates.map(d => ({
    posting_id:      postingId,
    date:            d.date,
    city:            d.city,
    venue_name:      d.venue_name,
    venue_place_id:  d.venue_place_id,
    venue_address:   d.venue_address,
  }));
  const { error: dateErr } = await sb.from('posting_dates').insert(dateInserts);
  if (dateErr) {
    errEl.textContent = 'Saved but dates failed — ' + dateErr.message;
    btn.disabled = false;
    return;
  }

  // City-based notification fanout (new postings only, not edits)
  if (!_editingPostingId) {
    _fanoutCityNotifications(postingId, dates, genres).catch(() => {});
  }

  closePostModal();
  showToast(_editingPostingId ? 'Posting updated!' : 'Opportunity posted!', 'success');
  await fetchPostings();
}

// Notify up to 50 bands whose home_city overlaps with any date city,
// who share genre overlap, and who have been active in the last 90 days.
async function _fanoutCityNotifications(postingId, dates, genres) {
  if (!dates.length) return;

  // Extract unique city terms (first word of each city string for broad matching)
  const cityTerms = [...new Set(dates.map(d => (d.city || '').split(',')[0].trim().toLowerCase()))].filter(Boolean);
  if (!cityTerms.length) return;

  const ninetyDaysAgo = new Date(Date.now() - 90 * 86400000).toISOString();

  // Fetch nearby/genre-matching bands (exclude self)
  const { data: candidates } = await sb
    .from('bands')
    .select('id, home_city, genre, email')
    .neq('id', currentBandProfile.id)
    .gte('last_seen_at', ninetyDaysAgo)
    .limit(200);

  if (!candidates?.length) return;

  // Score each candidate: city match (+2) + genre match (+1)
  const scored = candidates
    .map(b => {
      let s = 0;
      const bCity = (b.home_city || '').toLowerCase();
      if (cityTerms.some(t => bCity.includes(t))) s += 2;
      if (genres?.length && b.genre) {
        const bGenres = b.genre.toLowerCase();
        if (genres.some(g => bGenres.includes(g.toLowerCase()))) s += 1;
      }
      return { band: b, score: s };
    })
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 50);

  if (!scored.length) return;

  const notifs = scored.map(({ band: b }) => ({
    band_id:    b.id,
    type:       'new_posting_nearby',
    payload:    { from_band: currentBandProfile.band_name, posting_title: '' },
    posting_id: postingId,
    read:       false,
  }));
  await sb.from('notifications').insert(notifs);
}

// ── Interest Modal ────────────────────────────────────────────────────────────

function openInterestModal(postingId, preselectedDateId) {
  if (!currentUser) { openAuth('login'); return; }

  const posting = _allPostings.find(p => p.id === postingId);
  if (!posting) return;

  _interestPostingId = postingId;
  _interestDates     = posting.posting_dates || [];

  document.getElementById('interestModalTitle').textContent = posting.title;
  document.getElementById('interestMessage').value = '';
  document.getElementById('interestErr').textContent = '';
  const submitBtn = document.getElementById('interestSubmitBtn');
  submitBtn.disabled = false; submitBtn.textContent = 'Send Interest →';

  // My band summary
  const bp = currentBandProfile;
  const initials = (bp?.band_name || 'B').substring(0,2).toUpperCase();
  const avatarHtml = bp?.profile_photo_url
    ? `<img src="${bp.profile_photo_url}" class="comm-avatar comm-avatar-img" alt="">`
    : `<div class="comm-avatar comm-avatar-init">${initials}</div>`;
  document.getElementById('interestMyBand').innerHTML = `
    <div class="comm-my-band-row">
      ${avatarHtml}
      <div>
        <div class="comm-band-name">${escapeHtml(bp?.band_name || '')}</div>
        <div class="comm-band-meta">${escapeHtml([bp?.genre, bp?.home_city].filter(Boolean).join(' · '))}</div>
      </div>
    </div>`;

  // Date checkboxes
  const checksHtml = _interestDates.map(d => {
    const key     = `${postingId}_${d.id}`;
    const checked = preselectedDateId ? d.id == preselectedDateId : false;
    const fmtDate = new Date(d.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    return `<label class="comm-date-check">
      <input type="checkbox" name="interestDate" value="${d.id}" ${checked ? 'checked' : ''}>
      <span>${fmtDate} · ${escapeHtml(d.city)}</span>
    </label>`;
  }).join('');
  document.getElementById('interestDateChecks').innerHTML = checksHtml || '<p style="color:var(--muted);font-size:0.85rem">No dates available.</p>';

  document.getElementById('interestModal').classList.add('open');
}

function closeInterestModal() {
  document.getElementById('interestModal').classList.remove('open');
}

function handleInterested(postingId, dateId) {
  if (!currentUser) { openAuth('login'); return; }
  const key = `${postingId}_${dateId}`;
  if (_myInterests[key]) return; // already expressed
  openInterestModal(postingId, dateId);
}

async function submitInterest() {
  const selectedDateIds = [...document.querySelectorAll('input[name="interestDate"]:checked')].map(cb => parseInt(cb.value));
  const message         = document.getElementById('interestMessage').value.trim();
  const errEl           = document.getElementById('interestErr');
  errEl.textContent     = '';

  if (!selectedDateIds.length) { errEl.textContent = 'Please select at least one date.'; return; }

  const btn = document.getElementById('interestSubmitBtn');
  btn.disabled = true; btn.textContent = 'Sending…';

  const posting = _allPostings.find(p => p.id === _interestPostingId);

  // Insert one interest row per selected date
  const inserts = selectedDateIds.map(dateId => ({
    posting_id:      _interestPostingId,
    band_id:         currentBandProfile.id,
    posting_date_id: dateId,
    message:         message || null,
    status:          'pending',
  }));

  const { error } = await sb.from('posting_interests').insert(inserts);
  if (error) {
    errEl.textContent = 'Could not send — ' + (error.message || 'unknown error');
    btn.disabled = false; btn.textContent = 'Send Interest →';
    return;
  }

  // Insert notification for the posting band
  await sb.from('notifications').insert({
    band_id:    posting?.bands?.id,
    type:       'interest_received',
    payload:    { from_band: currentBandProfile.band_name, posting_title: posting?.title },
    posting_id: _interestPostingId,
    read:       false,
  });

  // Update local state
  selectedDateIds.forEach(dateId => {
    _myInterests[`${_interestPostingId}_${dateId}`] = 'pending';
  });

  closeInterestModal();
  showToast('Interest sent!', 'success');

  // Refresh the card in-place
  const updated = _allPostings.find(p => p.id === _interestPostingId);
  if (updated) {
    const el = document.getElementById(`comm-card-${_interestPostingId}`);
    if (el) el.outerHTML = renderCard(updated);
  }
}

// ── Manage Modal ──────────────────────────────────────────────────────────────

async function openManageModal(postingId) {
  _managePostingId = postingId;
  const posting = _allPostings.find(p => p.id === postingId);
  document.getElementById('manageModalTitle').textContent = posting?.title || '';
  document.getElementById('manageModalBody').innerHTML = '<div class="comm-modal-loading">Loading responses…</div>';
  document.getElementById('manageModal').classList.add('open');
  await _loadManageResponses(postingId);
}

function closeManageModal() {
  document.getElementById('manageModal').classList.remove('open');
}

async function _loadManageResponses(postingId) {
  const { data: interests, error } = await sb
    .from('posting_interests')
    .select(`*, bands(id, band_name, genre, home_city, profile_photo_url, epk_theme, review_count, email), posting_dates(id, date, city, venue_name, venue_place_id, venue_address)`)
    .eq('posting_id', postingId)
    .order('status', { ascending: true }) // accepted first
    .order('created_at', { ascending: false });

  const body = document.getElementById('manageModalBody');
  const posting = _allPostings.find(p => p.id === postingId);
  const slots = posting?.slots_needed || 1;
  const acceptedCount = (interests || []).filter(i => i.status === 'accepted').length;

  // Slots progress header
  const slotsHeader = slots > 1 ? `
    <div class="comm-manage-slots">
      <div class="comm-manage-slots-label">Slots filled: ${acceptedCount} of ${slots}</div>
      <div class="comm-manage-slots-bar"><div class="comm-manage-slots-fill" style="width:${Math.min(100,(acceptedCount/slots)*100)}%"></div></div>
    </div>` : '';

  if (error || !interests?.length) {
    body.innerHTML = slotsHeader + '<div class="comm-empty" style="padding:24px 0"><div class="comm-empty-title">No responses yet</div><div class="comm-empty-sub">When bands express interest they will appear here.</div></div>';
    return;
  }

  // Group by date
  const byDate = {};
  interests.forEach(i => {
    const key = i.posting_date_id;
    if (!byDate[key]) byDate[key] = { date: i.posting_dates, items: [] };
    byDate[key].items.push(i);
  });

  body.innerHTML = slotsHeader + Object.entries(byDate).map(([_dateId, group]) => {
    const d = group.date;
    const fmtDate = d ? new Date(d.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
    const dateLabel = fmtDate ? `${fmtDate} · ${d.city}` : 'All Dates';

    const itemsHtml = group.items.map(i => {
      const band = i.bands || {};
      const initials = (band.band_name || 'B').substring(0,2).toUpperCase();
      const slug = (band.band_name || '').toLowerCase().replace(/\s+/g,'-').replace(/[^a-z0-9-]/g,'');
      const avatarEl = band.profile_photo_url
        ? `<img src="${band.profile_photo_url}" class="comm-avatar comm-avatar-img" style="width:36px;height:36px" alt="">`
        : `<div class="comm-avatar comm-avatar-init" style="width:36px;height:36px;font-size:0.7rem">${initials}</div>`;

      const statusBadge = i.status !== 'pending'
        ? `<span class="comm-status-badge comm-status-${i.status}">${i.status}</span>`
        : '';

      const cityEsc = (d?.city || '').replace(/'/g, "\\'");
      const actions = i.status === 'pending' ? `
        <button class="comm-accept-btn" onclick="updateInterestStatus(${i.id},'accepted',${band.id},'${cityEsc}')">Accept</button>
        <button class="comm-decline-btn" onclick="updateInterestStatus(${i.id},'declined',${band.id},'${cityEsc}')">Decline</button>` : '';

      const emailLink = band.email && i.status === 'accepted'
        ? `<a href="mailto:${escapeHtml(band.email)}" class="comm-confirm-email-btn" style="font-size:0.55rem;padding:6px 11px">Email them →</a>`
        : '';

      return `<div class="comm-response-card${i.status === 'accepted' ? ' comm-response-card--accepted' : ''}">
        <div class="comm-response-header">
          ${avatarEl}
          <div style="flex:1;min-width:0">
            <div class="comm-band-name" style="font-size:0.92rem">${escapeHtml(band.band_name || '—')}</div>
            <div class="comm-band-meta">${escapeHtml([band.genre, band.home_city].filter(Boolean).join(' · '))}</div>
            ${band.review_count > 0 ? `<div class="comm-trust" style="font-size:0.6rem">★ ${band.review_count} review${band.review_count!==1?'s':''}</div>` : ''}
          </div>
          ${statusBadge}
        </div>
        ${i.message ? `<p class="comm-response-msg">"${escapeHtml(i.message)}"</p>` : ''}
        <div class="comm-response-actions">
          ${band.epk_theme && slug ? `<a class="comm-card-btn comm-card-btn--outline" href="epk.html?band=${slug}" target="_blank" style="font-size:0.55rem;padding:6px 11px">View EPK</a>` : ''}
          ${emailLink}
          ${actions}
        </div>
      </div>`;
    }).join('');

    return `<div class="comm-manage-date">
      <div class="comm-manage-date-label">${dateLabel}</div>
      ${itemsHtml}
    </div>`;
  }).join('');
}

async function updateInterestStatus(interestId, status, toBandId, city) {
  const { error } = await sb.from('posting_interests').update({ status }).eq('id', interestId);
  if (error) { showToast('Could not update — ' + error.message, 'error'); return; }

  const posting = _allPostings.find(p => p.id === _managePostingId);

  // Notify the interested band
  await sb.from('notifications').insert({
    band_id:    toBandId,
    type:       status === 'accepted' ? 'interest_accepted' : 'interest_declined',
    payload:    { posting_title: posting?.title, city },
    posting_id: _managePostingId,
    read:       false,
  });

  if (status === 'accepted') {
    // Count total accepted slots for this posting
    const { count: acceptedCount } = await sb
      .from('posting_interests')
      .select('id', { count: 'exact', head: true })
      .eq('posting_id', _managePostingId)
      .eq('status', 'accepted');

    const slotsNeeded = posting?.slots_needed || 1;
    const slotsFilled = acceptedCount >= slotsNeeded;

    // Get accepted band's full info (including email for contact)
    const { data: bandData } = await sb
      .from('bands')
      .select('id, band_name, genre, home_city, profile_photo_url, epk_theme, email')
      .eq('id', toBandId)
      .single();

    // If all slots filled, close the posting
    if (slotsFilled) {
      await sb.from('tour_postings').update({ is_active: false }).eq('id', _managePostingId);
      _allPostings = _allPostings.filter(p => p.id !== _managePostingId);
      applyFilters();
    }

    // Reload manage modal with confirmation panel at top
    await _loadManageResponses(_managePostingId);
    _showAcceptConfirmation(bandData, posting, city, slotsFilled, slotsNeeded - acceptedCount);

  } else {
    showToast('Declined — they have been notified.', 'success');
    await _loadManageResponses(_managePostingId);
  }
}

function _showAcceptConfirmation(band, posting, city, allFilled, remaining) {
  if (!band) return;
  const slug = (band.band_name || '').toLowerCase().replace(/\s+/g,'-').replace(/[^a-z0-9-]/g,'');
  const initials = (band.band_name || 'B').substring(0,2).toUpperCase();
  const avatarEl = band.profile_photo_url
    ? `<img src="${band.profile_photo_url}" class="comm-avatar" style="width:52px;height:52px" alt="">`
    : `<div class="comm-avatar-init" style="width:52px;height:52px;font-size:0.85rem;border-radius:50%;background:var(--ink);color:var(--cream);display:flex;align-items:center;justify-content:center;font-family:'Space Mono',monospace;font-weight:700;flex-shrink:0">${initials}</div>`;
  const typeWord = { tour_support: 'opener', local_opener: 'touring support', co_headlining: 'co-headliner' }[posting?.type] || 'band';
  const cityStr  = city ? ` in ${escapeHtml(city)}` : '';

  const statusLine = allFilled
    ? `All slots filled — this posting has been removed from the feed.`
    : `${remaining} slot${remaining !== 1 ? 's' : ''} still open — posting remains live.`;

  const panel = document.createElement('div');
  panel.className = 'comm-confirm-panel';
  panel.innerHTML = `
    <div class="comm-confirm-check">✓</div>
    <div class="comm-confirm-title">${escapeHtml(band.band_name)} confirmed as your ${typeWord}${cityStr}!</div>
    <div class="comm-confirm-band">
      ${avatarEl}
      <div>
        <div style="font-family:'DM Serif Display',serif;font-size:1rem;color:var(--ink)">${escapeHtml(band.band_name)}</div>
        <div style="font-family:'Outfit',sans-serif;font-size:0.78rem;color:var(--muted);margin-top:2px">${escapeHtml([band.genre, band.home_city].filter(Boolean).join(' · '))}</div>
      </div>
    </div>
    <div class="comm-confirm-contact-row">
      ${band.email ? `<a href="mailto:${escapeHtml(band.email)}" class="comm-confirm-email-btn">Email ${escapeHtml(band.band_name)} →</a>` : ''}
      <button class="comm-card-btn comm-card-btn--rust" onclick="closeManageModal();openChatModal(${band.id},${JSON.stringify(band.band_name)})">Message →</button>
      ${band.epk_theme && slug ? `<a href="epk.html?band=${slug}" target="_blank" class="comm-card-btn comm-card-btn--outline">View EPK</a>` : ''}
    </div>
    <div class="comm-confirm-status">${statusLine}</div>`;

  const body = document.getElementById('manageModalBody');
  if (body) body.insertAdjacentElement('afterbegin', panel);
}

// ── Delete Modal ──────────────────────────────────────────────────────────────

function openDeleteModal(postingId) {
  _deletePostingId = postingId;
  document.getElementById('deleteModal').classList.add('open');
}

function closeDeleteModal() {
  document.getElementById('deleteModal').classList.remove('open');
  _deletePostingId = null;
}

async function confirmDeletePosting() {
  if (!_deletePostingId) return;
  const btn = document.getElementById('deleteConfirmBtn');
  btn.disabled = true; btn.textContent = 'Deleting…';

  const { error } = await sb.from('tour_postings').update({ is_active: false }).eq('id', _deletePostingId);
  if (error) {
    showToast('Could not delete — ' + error.message, 'error');
    btn.disabled = false; btn.textContent = 'Delete Posting';
    return;
  }

  _allPostings = _allPostings.filter(p => p.id !== _deletePostingId);
  closeDeleteModal();
  showToast('Posting removed.', 'success');
  applyFilters();
}

// ── Direct Messaging ──────────────────────────────────────────────────────────

async function openChatModal(toBandId, toBandName) {
  if (!currentUser) { openAuth('login'); return; }
  if (!currentBandProfile) return;

  _chatPostingId = null; // no posting context for band-to-band DMs
  const myId = currentBandProfile.id;

  document.getElementById('chatModalTitle').textContent = `Message: ${toBandName}`;
  document.getElementById('chatMessages').innerHTML = '<div class="comm-modal-loading">Loading messages…</div>';
  document.getElementById('chatInput').value = '';
  document.getElementById('chatModal').classList.add('open');

  // Subscribe to realtime updates for this conversation
  if (_chatChannel) { sb.removeChannel(_chatChannel); _chatChannel = null; }
  _chatChannel = sb.channel(`chat_${[myId, toBandId].sort().join('_')}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'band_messages' }, payload => {
      const msg = payload.new;
      if ((msg.sender_band_id === myId && msg.recipient_band_id === toBandId) ||
          (msg.sender_band_id === toBandId && msg.recipient_band_id === myId)) {
        _appendChatMessage(msg, myId);
      }
    })
    .subscribe();

  // Store context for sendChatMessage
  document.getElementById('chatModal').dataset.toBandId   = toBandId;
  document.getElementById('chatModal').dataset.toBandName = toBandName;

  await _loadChatMessages(myId, toBandId);
}

async function _loadChatMessages(myId, toBandId) {
  const { data, error } = await sb
    .from('band_messages')
    .select('*')
    .or(`and(sender_band_id.eq.${myId},recipient_band_id.eq.${toBandId}),and(sender_band_id.eq.${toBandId},recipient_band_id.eq.${myId})`)
    .order('created_at', { ascending: true })
    .limit(100);

  const box = document.getElementById('chatMessages');
  if (error || !data?.length) {
    box.innerHTML = '<div class="comm-chat-empty">No messages yet — say hello!</div>';
    return;
  }

  box.innerHTML = '';
  data.forEach(msg => _appendChatMessage(msg, myId));
  box.scrollTop = box.scrollHeight;

  // Mark incoming as read
  const unread = data.filter(m => m.recipient_band_id === myId && !m.read).map(m => m.id);
  if (unread.length) {
    sb.from('band_messages').update({ read: true }).in('id', unread).then(() => {});
  }
}

function _appendChatMessage(msg, myId) {
  const box  = document.getElementById('chatMessages');
  if (!box) return;
  const mine = msg.sender_band_id === myId;
  const time = new Date(msg.created_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  const el   = document.createElement('div');
  el.className = `comm-chat-msg${mine ? ' comm-chat-msg--mine' : ''}`;
  el.innerHTML = `<div class="comm-chat-bubble">${escapeHtml(msg.body)}</div><div class="comm-chat-time">${time}</div>`;
  box.appendChild(el);
  box.scrollTop = box.scrollHeight;
}

async function sendChatMessage() {
  const modal   = document.getElementById('chatModal');
  const toBandId = parseInt(modal.dataset.toBandId);
  const input    = document.getElementById('chatInput');
  const body     = input.value.trim();
  if (!body || !toBandId || !currentBandProfile) return;

  input.value = '';
  const { error } = await sb.from('band_messages').insert({
    sender_band_id:    currentBandProfile.id,
    recipient_band_id: toBandId,
    body,
    read:              false,
  });
  if (error) { input.value = body; showToast('Could not send — ' + error.message, 'error'); return; }

  // Notify recipient
  sb.from('notifications').insert({
    band_id:    toBandId,
    type:       'new_message',
    payload:    { from_band: currentBandProfile.band_name, posting_title: '' },
    posting_id: null,
    read:       false,
  }).then(() => {});
}

function closeChatModal() {
  document.getElementById('chatModal').classList.remove('open');
  if (_chatChannel) { sb.removeChannel(_chatChannel); _chatChannel = null; }
}

// ── Notifications ─────────────────────────────────────────────────────────────

let _notifTrayOpen = false;

async function loadNotifCount() {
  if (!currentBandProfile) return;
  const { count } = await sb
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('band_id', currentBandProfile.id)
    .eq('read', false);

  const badge = document.getElementById('navBellBadge');
  if (!badge) return;
  if (count > 0) {
    badge.textContent   = count > 99 ? '99+' : String(count);
    badge.style.display = 'flex';
  } else {
    badge.style.display = 'none';
  }
}

function toggleNotifTray() {
  if (_notifTrayOpen) {
    _closeNotifTray();
  } else {
    _openNotifTray();
  }
}

function _closeNotifTray() {
  const tray = document.getElementById('notifTray');
  if (tray) tray.classList.remove('open');
  _notifTrayOpen = false;
}

async function _openNotifTray() {
  let tray = document.getElementById('notifTray');
  if (!tray) {
    tray = document.createElement('div');
    tray.id        = 'notifTray';
    tray.className = 'notif-tray';
    document.body.appendChild(tray);
    document.addEventListener('click', function _ntClose(e) {
      const bell = document.getElementById('navBell');
      if (!document.getElementById('notifTray')?.contains(e.target) && !bell?.contains(e.target)) {
        _closeNotifTray();
        document.removeEventListener('click', _ntClose);
      }
    });
  }

  _notifTrayOpen = true;
  tray.innerHTML = '<div class="notif-tray-loading">Loading…</div>';
  tray.classList.add('open');

  const { data: notifs } = await sb
    .from('notifications')
    .select('*')
    .eq('band_id', currentBandProfile.id)
    .order('created_at', { ascending: false })
    .limit(15);

  // Mark all as read
  if ((notifs || []).some(n => !n.read)) {
    await sb.from('notifications').update({ read: true })
      .eq('band_id', currentBandProfile.id).eq('read', false);
    const badge = document.getElementById('navBellBadge');
    if (badge) badge.style.display = 'none';
  }

  _renderNotifTray(tray, notifs || []);
}

function _renderNotifTray(tray, notifs) {
  const itemsHtml = notifs.map(n => {
    const pl    = n.payload || {};
    const band  = pl.from_band   || '';
    const city  = pl.city        || '';
    const title = pl.posting_title || '';
    let desc;
    if (n.type === 'interest_received')  desc = `${escapeHtml(band)} expressed interest in your posting`;
    else if (n.type === 'interest_accepted') desc = `Your interest was accepted${city ? ' for ' + escapeHtml(city) : title ? ' for ' + escapeHtml(title) : ''}`;
    else if (n.type === 'interest_declined') desc = `Your interest was declined${city ? ' for ' + escapeHtml(city) : title ? ' for ' + escapeHtml(title) : ''}`;
    else if (n.type === 'new_posting_nearby') desc = `${escapeHtml(band)} posted a new opportunity near you`;
    else if (n.type === 'new_message') desc = `New message from ${escapeHtml(band)}`;
    else desc = n.type;

    const diffMs  = Date.now() - new Date(n.created_at).getTime();
    const diffMin = Math.floor(diffMs / 60000);
    const ago = diffMin < 1 ? 'just now' : diffMin < 60 ? `${diffMin}m ago` : diffMin < 1440 ? `${Math.floor(diffMin/60)}h ago` : `${Math.floor(diffMin/1440)}d ago`;

    return `<div class="notif-item" onclick="closeManageModal();window.location.href='community.html'">
      <div class="notif-body">
        <div class="notif-desc">${desc}</div>
        <div class="notif-time">${ago}</div>
      </div>
    </div>`;
  }).join('');

  tray.innerHTML = `
    <div class="notif-tray-header">
      <span class="notif-tray-title">Notifications</span>
    </div>
    <div class="notif-list">${itemsHtml || '<div class="notif-tray-empty">No notifications yet — this is where you\'ll see interest in your postings.</div>'}</div>`;
}
