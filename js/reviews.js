// Review / venue-page state
let currentVenuePlaceId    = null;
let currentVenueName       = null;
let vrfStarRating          = 0;
let _currentSubmittedVenue = null;
let _editingReviewId       = null;
let _draftSaveTimer        = null;
let _reviewSortMode        = 'newest';
let _cachedReviews         = null;
let _myVotedIds            = new Set();
let _voteCountById         = {};
let _reviewDataById        = {};

// ── Swipe-right to close venue page (mobile) ──────────────────────────────────
(function() {
  let _sx = 0, _sy = 0;
  document.addEventListener('DOMContentLoaded', () => {
    const el = document.getElementById('venuePage');
    if (!el) return;
    el.addEventListener('touchstart', e => {
      _sx = e.touches[0].clientX;
      _sy = e.touches[0].clientY;
    }, { passive: true });
    el.addEventListener('touchend', e => {
      const dx = e.changedTouches[0].clientX - _sx;
      const dy = Math.abs(e.changedTouches[0].clientY - _sy);
      if (dx > 72 && dy < dx * 0.75) closevenuePage();
    }, { passive: true });
  });
})();

function copyVenueLink() {
  if (!currentVenuePlaceId) return;
  const url = `${location.origin}${location.pathname.replace(/\/[^/]*$/, '/')  }map.html?place=${encodeURIComponent(currentVenuePlaceId)}`;
  navigator.clipboard.writeText(url).then(() => {
    const btn = document.getElementById('vpShareBtn');
    if (btn) { const orig = btn.innerHTML; btn.textContent = 'Copied!'; setTimeout(() => btn.innerHTML = orig, 2000); }
    showToast('Venue link copied to clipboard', 'success');
  }).catch(() => showToast('Could not copy — try manually', 'error'));
}

// ── Draft helpers (localStorage) ──────────────────────────────────────────────
function _draftKey(placeId) { return 'bm_draft_' + placeId; }

function saveDraftNow() {
  if (!currentVenuePlaceId) return;
  const ranges = document.querySelectorAll('#venueReviewForm input[type=range]');
  const text   = document.getElementById('vrfText')?.value || '';
  if (text.length < 10 && !vrfStarRating) return; // nothing worth saving
  const draft = {
    placeId:     currentVenuePlaceId,
    venueName:   currentVenueName,
    text,
    starRating:  vrfStarRating,
    sound:       parseInt(ranges[0]?.value || 3),
    comms:       parseInt(ranges[1]?.value || 3),
    merch:       parseInt(ranges[2]?.value || 3),
    parking:     parseInt(ranges[3]?.value || 3),
    tip:         document.getElementById('vrfTip')?.value || '',
    isAnon:      document.getElementById('vrfAnon')?.checked || false,
    wouldReturn: _vrfReturnAnswer,
    savedAt:     new Date().toISOString()
  };
  localStorage.setItem(_draftKey(currentVenuePlaceId), JSON.stringify(draft));
}

function scheduleDraftSave() {
  clearTimeout(_draftSaveTimer);
  _draftSaveTimer = setTimeout(saveDraftNow, 2000);
}

function _loadDraft(placeId) {
  try { return JSON.parse(localStorage.getItem(_draftKey(placeId))); } catch (_) { return null; }
}

function clearDraft(placeId) {
  localStorage.removeItem(_draftKey(placeId || currentVenuePlaceId));
  const banner = document.getElementById('vpDraftBanner');
  if (banner) banner.style.display = 'none';
}

function discardDraft() {
  clearDraft();
  showToast('Draft discarded.', 'info');
}

function resumeDraft() {
  const draft = _loadDraft(currentVenuePlaceId);
  if (!draft) return;
  document.getElementById('vrfText').value = draft.text || '';
  updateCharCount();
  if (draft.starRating) setVrfStar(draft.starRating);
  if (draft.wouldReturn) setReturnAnswer(draft.wouldReturn);
  const tip = document.getElementById('vrfTip');
  if (tip && draft.tip) { tip.value = draft.tip; updateTipCount(); }
  const anonBox = document.getElementById('vrfAnon');
  if (anonBox) anonBox.checked = !!draft.isAnon;
  const ranges = document.querySelectorAll('#venueReviewForm input[type=range]');
  const labels = ['vrfSoundVal','vrfCommVal','vrfMerchVal','vrfParkVal'];
  [draft.sound, draft.comms, draft.merch, draft.parking].forEach((v, i) => {
    if (ranges[i] && v) {
      ranges[i].value = v;
      const lbl = document.getElementById(labels[i]);
      if (lbl) lbl.textContent = v;
    }
  });
  const form = document.getElementById('venueReviewForm');
  form.classList.add('visible');
  form.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const banner = document.getElementById('vpDraftBanner');
  if (banner) banner.style.display = 'none';
}

function getAllDrafts() {
  const drafts = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key.startsWith('bm_draft_')) continue;
    try { drafts.push(JSON.parse(localStorage.getItem(key))); } catch (_) {}
  }
  return drafts.sort((a, b) => new Date(b.savedAt) - new Date(a.savedAt));
}

async function openVenuePage(placeId, name, address) {
  currentVenuePlaceId    = placeId;
  currentVenueName       = name;
  _currentSubmittedVenue = null;

  const isSubmitted = placeId.startsWith('sv_');

  document.getElementById('vpEyebrow').textContent  = isSubmitted ? 'DIY Venue' : address;
  document.getElementById('vpName').textContent     = name;
  document.getElementById('vpAddress').textContent  = isSubmitted ? address + ' · Contact for exact address' : address;
  document.getElementById('vrfVenueName').textContent = name;

  // Type tag
  const typeTagEl = document.getElementById('vpTypeTag');
  if (typeTagEl) typeTagEl.style.display = 'none';

  // Hide DIY info section initially
  const diyInfo = document.getElementById('vpDiyInfo');
  if (diyInfo) diyInfo.style.display = 'none';

  ['vpOverall','vpSound','vpComms','vpMerch','vpParking'].forEach(id =>
    document.getElementById(id).textContent = '—'
  );

  document.getElementById('reviewsList').innerHTML = `
    <div class="no-reviews">
      <div class="no-reviews-icon">— —</div>
      <div class="no-reviews-title">Loading reviews...</div>
    </div>`;

  if (isSubmitted) {
    // Load submitted venue data for extra info
    try {
      const { data: sv } = await sb
        .from('submitted_venues')
        .select('*')
        .eq('synthetic_place_id', placeId)
        .single();
      if (sv) {
        _currentSubmittedVenue = sv;
        _renderSubmittedVenueExtras(sv);
      }
    } catch (_) {}

    document.getElementById('vpContactBtn').onclick = () => {
      const diy = document.getElementById('vpDiyInfo');
      if (diy) diy.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
  } else {
    // Wire up contact button (openContactModal is defined in auth.js)
    document.getElementById('vpContactBtn').onclick = () =>
      openContactModal(placeId, name, address);
  }

  // Venue hero photo (Google Places only)
  const vpPhoto    = document.getElementById('vpHeroPhoto');
  const vpPhotoImg = document.getElementById('vpHeroPhotoImg');
  if (vpPhoto && vpPhotoImg) {
    vpPhoto.style.display = 'none';
    vpPhotoImg.src = '';
    if (!isSubmitted && typeof window.getVenuePhotoUrl === 'function') {
      window.getVenuePhotoUrl(placeId, (url) => {
        if (url) {
          vpPhotoImg.src        = url;
          vpPhoto.style.display = '';
        }
      });
    }
  }

  document.getElementById('venueReviewForm').classList.remove('visible');
  _editingReviewId = null;
  const submitBtn = document.getElementById('vrfSubmitBtn');
  if (submitBtn) submitBtn.textContent = 'Post Review';
  document.getElementById('venuePage').classList.add('open');
  document.body.style.overflow = 'hidden';

  // Show draft resume banner if a draft exists for this venue
  const draft  = _loadDraft(placeId);
  const banner = document.getElementById('vpDraftBanner');
  if (banner) banner.style.display = (draft && draft.text && draft.text.length >= 10) ? 'flex' : 'none';

  await loadVenueReviews(placeId, name);
}

function _renderSubmittedVenueExtras(sv) {
  const typeTagEl = document.getElementById('vpTypeTag');
  if (typeTagEl) {
    const label = sv.venue_type === 'house_show' ? 'House Show' : 'DIY Venue';
    const color = sv.venue_type === 'house_show' ? 'var(--sage)' : 'var(--rust)';
    typeTagEl.innerHTML = `<span class="sv-type-tag" style="background:${color}">${label}</span>`;
    typeTagEl.style.display = 'block';
  }

  const diyInfo = document.getElementById('vpDiyInfo');
  if (!diyInfo) return;

  const grid = document.getElementById('vpDiyGrid');
  const items = [];

  if (sv.capacity_min || sv.capacity_max) {
    const cap = sv.capacity_min && sv.capacity_max
      ? `${sv.capacity_min}–${sv.capacity_max}`
      : sv.capacity_max || sv.capacity_min;
    items.push({ icon: '👥', label: 'Capacity', val: cap });
  }
  if (sv.has_pa)       items.push({ icon: '🎙', label: 'PA / Sound', val: 'Available' });
  if (sv.has_backline)  items.push({ icon: '🎸', label: 'Backline', val: 'Available' });
  if (sv.all_ages)      items.push({ icon: '✓', label: 'All Ages', val: 'Yes' });
  if (sv.overnight_stay) items.push({ icon: '🛏', label: 'Overnight Stay', val: 'Offered' });
  if (sv.genre_lean)    items.push({ icon: '♪', label: 'Genre Lean', val: sv.genre_lean });
  if (sv.door_type) {
    const doorLabels = {
      pass_the_hat: 'Pass the Hat', door_split: 'Door Split',
      flat_guarantee: 'Flat Guarantee', donation_only: 'Donation Only'
    };
    items.push({ icon: '💰', label: 'Door Deal', val: doorLabels[sv.door_type] || sv.door_type });
  }
  if (sv.booking_status === 'dormant') items.push({ icon: '⏸', label: 'Booking', val: 'Currently Dormant' });

  grid.innerHTML = items.map(it =>
    `<div class="sv-info-item"><span class="sv-info-icon">${it.icon}</span><div><div class="sv-info-item-label">${it.label}</div><div class="sv-info-item-val">${it.val}</div></div></div>`
  ).join('') || '<div style="color:var(--muted);font-size:0.82rem">No details added yet.</div>';

  if (sv.description) {
    grid.innerHTML += `<div class="sv-description">${sv.description}</div>`;
  }

  // Contact links
  const contactArea = document.getElementById('vpDiyContact');
  const contactLinks = document.getElementById('vpDiyContactLinks');
  const links = [];
  if (sv.contact_email)    links.push(`<a href="mailto:${sv.contact_email}" class="sv-contact-link">✉ Email →</a>`);
  if (sv.contact_instagram) links.push(`<a href="${sv.contact_instagram}" target="_blank" rel="noopener" class="sv-contact-link">📷 Instagram →</a>`);
  if (sv.contact_website)  links.push(`<a href="${sv.contact_website}" target="_blank" rel="noopener" class="sv-contact-link">🌐 Website →</a>`);

  if (links.length) {
    contactLinks.innerHTML = `<div class="sv-contact-links">${links.join('')}</div>`;
    contactArea.style.display = 'block';
  } else {
    contactArea.style.display = 'none';
  }

  diyInfo.style.display = 'block';
}

function closevenuePage() {
  document.getElementById('venuePage').classList.remove('open');
  document.body.style.overflow = '';
  document.getElementById('venueReviewForm').classList.remove('visible');
}
window.closevenuePage = closevenuePage;
window.closeVenuePage = closevenuePage;

function toggleReviewForm() {
  const form = document.getElementById('venueReviewForm');
  if (!form.classList.contains('visible')) {
    form.classList.add('visible');
    if (currentUser && currentBandProfile) {
      document.getElementById('vrfLoginPrompt').style.display  = 'none';
      document.getElementById('vrfFormFields').style.display   = 'block';
      loadGenreChips('vrfGenreChips');
    } else {
      document.getElementById('vrfLoginPrompt').style.display  = 'block';
      document.getElementById('vrfFormFields').style.display   = 'none';
    }
    form.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } else {
    form.classList.remove('visible');
  }
}

var currentPlaceId = null;

async function loadVenueReviews(placeId, venueName) {
  currentPlaceId   = placeId;
  currentVenueName = venueName;
  const { data: reviews, error } = await sb
    .from('reviews')
    .select('*, bands(band_name, genre, home_city, profile_photo_url, epk_theme)')
    .eq('google_place_id', placeId)
    .order('created_at', { ascending: false });

  if (error || !reviews || reviews.length === 0) {
    _cachedReviews = [];
    document.getElementById('reviewsList').innerHTML = `
      <div class="no-reviews">
        <div class="no-reviews-icon">— —</div>
        <div class="no-reviews-title">No reviews yet</div>
        <p>Be the first band to review ${venueName}!</p>
      </div>`;
    const sortRow = document.getElementById('reviewSortRow');
    if (sortRow) sortRow.style.display = 'none';
    return;
  }

  // Load vote counts + my own votes in one query
  _myVotedIds   = new Set();
  _voteCountById = {};
  try {
    const reviewIds = reviews.map(r => r.id);
    const { data: votes } = await sb.from('review_votes')
      .select('review_id, band_id')
      .in('review_id', reviewIds);
    (votes || []).forEach(v => {
      _voteCountById[v.review_id] = (_voteCountById[v.review_id] || 0) + 1;
      if (currentBandProfile?.id && v.band_id === currentBandProfile.id) _myVotedIds.add(v.review_id);
    });
  } catch (_) {}

  const avg = key => (reviews.reduce((s, r) => s + (r[key] || 0), 0) / reviews.length).toFixed(1);
  document.getElementById('vpOverall').textContent = avg('overall_rating');
  document.getElementById('vpSound').textContent   = avg('sound_rating');
  document.getElementById('vpComms').textContent   = avg('comms_rating');
  document.getElementById('vpMerch').textContent   = avg('merch_rating');
  document.getElementById('vpParking').textContent = avg('parking_rating');
  document.getElementById('reviewsTitle').textContent = `Band Reviews (${reviews.length})`;

  // "Would you play here again?" aggregate
  const withReturn = reviews.filter(r => r.would_return);
  const returnStat = document.getElementById('vpReturnStat');
  if (returnStat && withReturn.length > 0) {
    const yesCount = withReturn.filter(r => r.would_return === 'yes').length;
    const pct      = Math.round(yesCount / withReturn.length * 100);
    returnStat.innerHTML = `
      <span class="vp-return-icon">${pct >= 70 ? '✓' : pct >= 40 ? '~' : '✕'}</span>
      <span><strong>${pct}%</strong> of bands would play here again</span>
      <span class="vp-return-count">(${withReturn.length} answered)</span>`;
    returnStat.style.display = 'flex';
  } else if (returnStat) {
    returnStat.style.display = 'none';
  }

  // Show sort row when there are reviews
  const sortRow = document.getElementById('reviewSortRow');
  if (sortRow) sortRow.style.display = reviews.length > 1 ? 'flex' : 'none';

  _cachedReviews = reviews;
  _renderReviews(reviews);
}

function setReviewSort(mode) {
  _reviewSortMode = mode;
  document.querySelectorAll('.rst-btn').forEach(b =>
    b.classList.toggle('rst-btn--active', b.dataset.sort === mode)
  );
  if (_cachedReviews) _renderReviews(_cachedReviews);
}

function _renderReviews(reviews) {
  const sorted = [...reviews].sort((a, b) => {
    if (_reviewSortMode === 'helpful') {
      return (_voteCountById[b.id] || 0) - (_voteCountById[a.id] || 0);
    }
    return new Date(b.created_at) - new Date(a.created_at);
  });

  // Store review data for edit pre-fill
  _reviewDataById = {};
  sorted.forEach(r => { _reviewDataById[r.id] = r; });

  const myId    = window.currentBandProfile?.id;
  const isAdmin = !!(window.currentBandProfile?.is_admin);

  document.getElementById('reviewsList').innerHTML = sorted.map(r => {
    const band  = r.bands || {};
    const stars = '★'.repeat(r.overall_rating) + '☆'.repeat(5 - r.overall_rating);
    const date  = new Date(r.created_at).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
    const editedBadge = r.is_edited
      ? `<span class="ri-edited">Edited ${new Date(r.edited_at).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}</span>`
      : '';

    let avatarWrapped, nameEl, metaLine;
    if (r.is_anonymous) {
      avatarWrapped = `<div class="ri-avatar ri-avatar-anon">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2">
          <circle cx="8" cy="5.5" r="2.5"/><path d="M3 13c0-2.76 2.24-5 5-5s5 2.24 5 5"/>
        </svg>
      </div>`;
      nameEl   = `<div class="ri-band ri-band-anon">Verified Band — Identity Protected</div>`;
      metaLine = date;
    } else {
      const initials = (band.band_name || 'B').substring(0, 2).toUpperCase();
      const slug     = (band.band_name || '').toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
      const epkHref  = band.epk_theme && slug ? `epk.html?band=${slug}` : null;
      const avatarEl = band.profile_photo_url
        ? `<img src="${band.profile_photo_url}" class="ri-avatar ri-avatar-img" alt="${escapeHtml(band.band_name || '')}">`
        : `<div class="ri-avatar">${initials}</div>`;
      avatarWrapped = epkHref
        ? `<a href="${epkHref}" class="ri-avatar-link" title="View ${escapeHtml(band.band_name)}'s EPK">${avatarEl}</a>`
        : avatarEl;
      nameEl   = epkHref
        ? `<a href="${epkHref}" class="ri-band ri-band-link">${escapeHtml(band.band_name || 'Anonymous Band')}</a>`
        : `<div class="ri-band">${escapeHtml(band.band_name || 'Anonymous Band')}</div>`;
      metaLine = `${escapeHtml(band.genre || '')} · ${escapeHtml(band.home_city || '')} · ${date}`;
    }

    const returnLabel = { yes: '✓ Would play here again', maybe: '~ Would consider returning', no: '✕ Would not return' };
    const returnClass = { yes: 'ri-return--yes', maybe: 'ri-return--maybe', no: 'ri-return--no' };
    const returnBadge = r.would_return
      ? `<div class="ri-return ${returnClass[r.would_return] || ''}">${returnLabel[r.would_return] || ''}</div>`
      : '';
    const tipBlock = r.band_tip
      ? `<div class="ri-tip"><span class="ri-tip-label">Tip for bands</span>${escapeHtml(r.band_tip)}</div>`
      : '';

    // Helpful vote button
    const voteCount  = _voteCountById[r.id] || 0;
    const iVoted     = _myVotedIds.has(r.id);
    const helpfulBtn = `<button class="ri-helpful${iVoted ? ' ri-helpful--voted' : ''}" onclick="toggleHelpful(${r.id})">
      ${iVoted ? '✓ Useful' : 'Did you find this useful?'}${voteCount > 0 ? ` <span class="ri-helpful-count">(${voteCount})</span>` : ''}
    </button>`;

    // Own review controls (edit + delete)
    const isOwn = myId && r.band_id === myId;
    const ownControls = (isOwn || isAdmin)
      ? `<div class="ri-own-controls">
          ${isOwn ? `<button class="ri-own-btn" onclick="editReview(${r.id})">Edit</button>` : ''}
          <button class="ri-own-btn ri-own-btn--delete" onclick="deleteReview(${r.id})">Delete</button>
        </div>`
      : '';

    return `<div class="review-item" id="ri-${r.id}">
      <div class="ri-header">
        ${avatarWrapped}
        <div style="flex:1;min-width:0">
          ${nameEl}
          <div class="ri-meta">${metaLine}${editedBadge}</div>
        </div>
        <div class="ri-stars">${stars}</div>
      </div>
      ${r.genre_played ? `<div style="font-family:'Space Mono',monospace;font-size:0.55rem;text-transform:uppercase;letter-spacing:0.06em;color:var(--sage);margin-bottom:10px">Played as: ${escapeHtml(r.genre_played)}</div>` : ''}
      <p class="ri-text">${escapeHtml(r.review_text)}</p>
      ${tipBlock}
      <div class="ri-scores">
        <div class="ri-score"><div class="ri-score-dot"></div>Sound <strong>${r.sound_rating}/5</strong></div>
        <div class="ri-score"><div class="ri-score-dot"></div>Communication <strong>${r.comms_rating}/5</strong></div>
        <div class="ri-score"><div class="ri-score-dot"></div>Merch <strong>${r.merch_rating}/5</strong></div>
        <div class="ri-score"><div class="ri-score-dot"></div>Parking <strong>${r.parking_rating}/5</strong></div>
      </div>
      ${returnBadge}
      <div class="ri-footer">
        ${helpfulBtn}
        ${ownControls}
      </div>
    </div>`;
  }).join('');
}

async function toggleHelpful(reviewId) {
  if (!currentBandProfile?.id) { showToast('Sign in to mark reviews as useful', 'info'); return; }
  if (_myVotedIds.has(reviewId)) {
    // Remove vote
    await sb.from('review_votes').delete()
      .eq('review_id', reviewId).eq('band_id', currentBandProfile.id);
    _myVotedIds.delete(reviewId);
    _voteCountById[reviewId] = Math.max(0, (_voteCountById[reviewId] || 1) - 1);
  } else {
    await sb.from('review_votes').insert({ review_id: reviewId, band_id: currentBandProfile.id });
    _myVotedIds.add(reviewId);
    _voteCountById[reviewId] = (_voteCountById[reviewId] || 0) + 1;
  }
  if (_cachedReviews) _renderReviews(_cachedReviews);
}

function editReview(reviewId) {
  const r = _reviewDataById[reviewId];
  if (!r) return;
  _editingReviewId = reviewId;

  document.getElementById('vrfText').value = r.review_text || '';
  updateCharCount();
  if (r.overall_rating) setVrfStar(r.overall_rating);
  if (r.would_return)   setReturnAnswer(r.would_return);
  const tip = document.getElementById('vrfTip');
  if (tip) { tip.value = r.band_tip || ''; updateTipCount(); }
  const anonBox = document.getElementById('vrfAnon');
  if (anonBox) anonBox.checked = !!r.is_anonymous;

  const ranges = document.querySelectorAll('#venueReviewForm input[type=range]');
  const labels = ['vrfSoundVal','vrfCommVal','vrfMerchVal','vrfParkVal'];
  [r.sound_rating, r.comms_rating, r.merch_rating, r.parking_rating].forEach((v, i) => {
    if (ranges[i] && v) { ranges[i].value = v; const lbl = document.getElementById(labels[i]); if (lbl) lbl.textContent = v; }
  });

  const btn = document.getElementById('vrfSubmitBtn');
  btn.textContent = 'Update Review';
  btn.disabled    = false;
  const form = document.getElementById('venueReviewForm');
  form.classList.add('visible');
  form.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function deleteReview(reviewId) {
  if (!confirm('Delete this review? This cannot be undone.')) return;
  const { error } = await sb.from('reviews').delete().eq('id', reviewId);
  if (error) { showToast('Delete failed: ' + error.message, 'error'); return; }
  showToast('Review deleted.', 'success');
  await loadVenueReviews(currentPlaceId, currentVenueName);
}

function setVrfStar(val) {
  vrfStarRating = val;
  document.querySelectorAll('#vrfStars .star-btn').forEach((s, i) =>
    s.classList.toggle('active', i < val)
  );
  updateSubmitBtn();
  scheduleDraftSave();
}

let _vrfReturnAnswer = null;

function setReturnAnswer(val) {
  _vrfReturnAnswer = val;
  document.querySelectorAll('.vrf-return-btn').forEach(b => {
    b.classList.toggle('vrf-return-btn--active', b.dataset.val === val);
  });
  scheduleDraftSave();
}

function updateCharCount() {
  const len  = document.getElementById('vrfText').value.length;
  const bar  = document.getElementById('vrfProgressBar');
  const el   = document.getElementById('vrfCharCount');
  const pct  = Math.min(len / 50 * 100, 100);
  if (bar) {
    bar.style.width = pct + '%';
    bar.style.background = len >= 50 ? 'var(--teal)' : 'var(--grey)';
  }
  if (len < 50) {
    el.textContent = `${50 - len} characters to unlock`;
    el.className   = 'vrf-char-count too-short';
  } else {
    el.textContent = `${len} characters ✓`;
    el.className   = 'vrf-char-count';
  }
  updateSubmitBtn();
  scheduleDraftSave();
}

function updateTipCount() {
  const el  = document.getElementById('vrfTip');
  const cnt = document.getElementById('vrfTipCount');
  if (!el || !cnt) return;
  const remaining = 240 - el.value.length;
  cnt.textContent = remaining < 40 ? `${remaining} left` : '';
  scheduleDraftSave();
}

function updateSubmitBtn() {
  const text = document.getElementById('vrfText').value;
  document.getElementById('vrfSubmitBtn').disabled = !(vrfStarRating > 0 && text.length >= 50);
}

async function submitReview() {
  if (!currentUser || !currentBandProfile) { openAuth(); return; }

  if (!currentBandProfile.id) {
    console.error('Band profile missing id — cannot submit review:', currentBandProfile);
    showToast('Profile error — please sign out and back in', 'error');
    return;
  }

  const text  = document.getElementById('vrfText').value.trim();
  const genres  = getSelectedGenres('vrfGenreChips');
  const genre   = genres.length ? genres.join(', ') : null;
  const tip     = document.getElementById('vrfTip')?.value.trim() || null;
  if (!vrfStarRating)    { showToast('Please select a star rating', 'error'); return; }
  if (text.length < 50)  { showToast('Please write at least 50 characters', 'error'); return; }

  const ranges = document.querySelectorAll('#venueReviewForm input[type=range]');
  const isAnon  = document.getElementById('vrfAnon')?.checked || false;
  const reviewData = {
    google_place_id: currentVenuePlaceId,
    venue_name:      currentVenueName,
    venue_city:      '',
    band_id:         currentBandProfile.id,
    overall_rating:  vrfStarRating,
    sound_rating:    parseInt(ranges[0].value),
    comms_rating:    parseInt(ranges[1].value),
    merch_rating:    parseInt(ranges[2].value),
    parking_rating:  parseInt(ranges[3].value),
    genre_played:    genre || null,
    review_text:     text,
    is_anonymous:    isAnon,
    would_return:    _vrfReturnAnswer || null,
    band_tip:        tip || null
  };

  devLog('Submitting review:', reviewData);

  const btn = document.getElementById('vrfSubmitBtn');
  btn.textContent = 'Posting...';
  btn.disabled    = true;

  let opError;
  if (_editingReviewId) {
    // Editing an existing review
    const { error } = await sb.from('reviews')
      .update({ ...reviewData, is_edited: true, edited_at: new Date().toISOString() })
      .eq('id', _editingReviewId)
      .eq('band_id', currentBandProfile.id);
    opError = error;
    _editingReviewId = null;
  } else {
    // New review
    const { error } = await sb.from('reviews').insert(reviewData);
    opError = error;
    if (!error) {
      // Increment review_count on the band — used for community premium threshold
      const prevCount = currentBandProfile.review_count || 0;
      const newCount  = prevCount + 1;
      await sb.from('bands').update({ review_count: newCount }).eq('email', currentUser.email);
      currentBandProfile.review_count = newCount;
      updateNavAuth();
      if (prevCount < 3 && newCount >= 3) {
        setTimeout(() => showUnlockCelebration(currentBandProfile.band_name), 800);
      }
    }
  }

  if (opError) {
    console.error('Review save failed:', opError);
    showToast(`Save failed: ${opError.message}`, 'error');
    btn.textContent = _editingReviewId ? 'Update Review' : 'Post Review';
    btn.disabled    = false;
    return;
  }

  clearDraft(currentVenuePlaceId);
  showToast(_editingReviewId === null ? 'Review posted — thanks for helping the community.' : 'Review updated.', 'success');
  document.getElementById('venueReviewForm').classList.remove('visible');
  btn.textContent = 'Post Review';
  document.getElementById('vrfText').value = '';
  const anonBox = document.getElementById('vrfAnon');
  if (anonBox) anonBox.checked = false;
  const tipBox = document.getElementById('vrfTip');
  if (tipBox) tipBox.value = '';
  _vrfReturnAnswer = null;
  document.querySelectorAll('.vrf-return-btn').forEach(b => b.classList.remove('vrf-return-btn--active'));
  const bar = document.getElementById('vrfProgressBar');
  if (bar) { bar.style.width = '0%'; }
  vrfStarRating = 0;
  document.querySelectorAll('#vrfStars .star-btn').forEach(s => s.classList.remove('active'));
  await loadVenueReviews(currentVenuePlaceId, currentVenueName);
}

// Scroll reveal
const observer = new IntersectionObserver(entries => {
  entries.forEach(e => { if (e.isIntersecting) e.target.classList.add('visible'); });
}, { threshold: 0.1 });
document.querySelectorAll('.reveal').forEach(el => observer.observe(el));
