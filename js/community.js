// community.js — Bandmate Community feed: postings, interests, notifications

// ── Module state ──────────────────────────────────────────────────────────────

let _allPostings  = [];    // all active postings from Supabase
let _myInterests  = {};    // { "postingId_dateId": 'pending'|'accepted'|'declined' }
let _filters      = { search: '', type: 'all', genre: '', location: '', length: 'all' };
let _postType     = null;  // selected type in post modal
let _postGenres   = [];    // selected genres in post modal
let _interestPostingId = null;
let _interestDates     = [];
let _managePostingId   = null;
let _mapsLoaded        = false;
let _cityAutocompletes = []; // Google Places autocomplete instances

const TYPE_LABELS = { tour_support: 'Tour Support', local_opener: 'Local Opener', co_headlining: 'Co-Headlining' };
const GENRES = ['Rock','Indie','Folk','Alternative','Country','Jazz','Blues','Hip-Hop','Electronic','Punk','Metal','R&B','Soul','Acoustic','Americana','Pop','Experimental'];

// ── Init ─────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  await initAuth();
  _buildGenreFilters();
  _buildPostGenreChips();
  renderSkeletons();
  await fetchPostings();
});

function _mapsReady() {
  _mapsLoaded = true;
  // Wire autocomplete on any date rows already in the DOM
  document.querySelectorAll('.comm-city-input:not([data-ac])').forEach(_attachCityAC);
}

// ── Data fetching ─────────────────────────────────────────────────────────────

async function fetchPostings() {
  const { data, error } = await sb
    .from('tour_postings')
    .select(`*, bands(id, band_name, genre, home_city, profile_photo_url, epk_theme, review_count), posting_dates(id, date, city)`)
    .eq('is_active', true)
    .order('created_at', { ascending: false });

  if (error) {
    document.getElementById('commFeed').innerHTML = `<div class="comm-empty"><p class="comm-empty-title">Could not load postings</p><p class="comm-empty-sub">${escapeHtml(error.message)}</p></div>`;
    return;
  }

  // Sort dates within each posting chronologically
  (data || []).forEach(p => {
    if (p.posting_dates) p.posting_dates.sort((a, b) => a.date.localeCompare(b.date));
  });

  _allPostings = data || [];

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
    const btnText = active ? `Interested ✓` : 'Interested';
    const btnCls  = active ? 'comm-interested-btn comm-interested-btn--active' : 'comm-interested-btn';
    const fmtDate = new Date(d.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const interestClick = isOwn ? '' : `onclick="handleInterested(${p.id},${d.id})"`;
    return `<div class="comm-date-row">
      <span class="comm-date-label">${fmtDate} · ${escapeHtml(d.city)}</span>
      ${!isOwn ? `<button class="${btnCls}" ${interestClick}>${btnText}</button>` : ''}
    </div>`;
  }).join('');

  // Posted ago
  const diffMs  = Date.now() - new Date(p.created_at).getTime();
  const diffDay = Math.floor(diffMs / 86400000);
  const postedAgo = diffDay < 1 ? 'Today' : diffDay === 1 ? '1 day ago' : `${diffDay} days ago`;

  // Footer actions
  const epkBtn = hasEpk
    ? `<a class="comm-card-btn comm-card-btn--outline" href="epk.html?band=${slug}" target="_blank">View EPK</a>`
    : '';
  const actionBtn = isOwn
    ? `<button class="comm-card-btn comm-card-btn--manage" onclick="openManageModal(${p.id})">Manage Responses</button>`
    : `<button class="comm-card-btn comm-card-btn--rust" onclick="openInterestModal(${p.id})">Express Interest</button>`;

  return `<article class="comm-card" id="comm-card-${p.id}">
    <div class="comm-card-header">
      <div class="comm-card-band">
        ${avatarWrapped}
        <div class="comm-band-info">
          <div class="comm-band-name">${escapeHtml(band.band_name || 'Unknown Band')}</div>
          <div class="comm-band-meta">${escapeHtml([band.genre, band.home_city].filter(Boolean).join(' · '))}</div>
          ${trustHtml}
        </div>
      </div>
      ${badge}
    </div>

    ${dates.length ? `<div class="comm-tour-route">${routeHtml}</div>` : ''}
    ${dateRange     ? `<div class="comm-date-range">${dateRange}</div>` : ''}
    ${genreTagsHtml ? `<div class="comm-genre-tags">${genreTagsHtml}</div>` : ''}

    <div class="comm-card-title">${escapeHtml(p.title)}</div>
    ${descHtml}

    ${dates.length ? `<div class="comm-dates-list">
      ${datesHtml}
      ${extraDates ? `<div class="comm-view-all-dates" onclick="openInterestModal(${p.id})">View all ${dates.length} dates →</div>` : ''}
    </div>` : ''}

    <div class="comm-card-footer">
      <span class="comm-posted-ago">${postedAgo}</span>
      <div class="comm-card-actions">${epkBtn}${actionBtn}</div>
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

function clearFilters() {
  _filters = { search: '', type: 'all', genre: '', location: '', length: 'all' };
  document.getElementById('commSearch').value   = '';
  document.getElementById('commLocation').value = '';
  document.querySelectorAll('#typeChips   .comm-chip').forEach((b,i) => b.classList.toggle('comm-chip--active', i===0));
  document.querySelectorAll('#genreChips  .comm-chip').forEach((b,i) => b.classList.toggle('comm-chip--active', i===0));
  document.querySelectorAll('#lengthChips .comm-chip').forEach((b,i) => b.classList.toggle('comm-chip--active', i===0));
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
  // Reset state
  _postType   = null;
  _postGenres = [];
  document.querySelectorAll('#postTypeCards .comm-type-card').forEach(c => c.classList.remove('comm-type-card--active'));
  document.getElementById('postTitle').value       = '';
  document.getElementById('postDescription').value = '';
  document.getElementById('postDescHint').textContent = '';
  document.getElementById('postErr').textContent   = '';
  document.getElementById('postDateRows').innerHTML = '';
  document.querySelectorAll('#postGenreChips .comm-chip').forEach(b => b.classList.remove('comm-chip--active'));
  document.querySelector('input[name="postContact"][value="bandmate"]').checked = true;
  document.getElementById('postContactEmailRow').style.display = 'none';
  const submitBtn = document.getElementById('postSubmitBtn');
  submitBtn.disabled = false; submitBtn.textContent = 'Post to Community →';
  addDateRow(); // start with one date row
  document.getElementById('postModal').classList.add('open');

  // Wire description character hint
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

function _buildPostGenreChips() {
  const wrap = document.getElementById('postGenreChips');
  GENRES.forEach(g => {
    const btn = document.createElement('button');
    btn.className   = 'comm-chip';
    btn.textContent = g;
    btn.onclick = () => {
      const active = btn.classList.toggle('comm-chip--active');
      if (active) { if (!_postGenres.includes(g)) _postGenres.push(g); }
      else         { _postGenres = _postGenres.filter(x => x !== g); }
    };
    wrap.appendChild(btn);
  });
}

function addDateRow() {
  const container = document.getElementById('postDateRows');
  const idx       = container.children.length;
  if (idx >= 20) return;

  const row = document.createElement('div');
  row.className = 'comm-date-entry';
  row.innerHTML = `
    <input type="date" class="comm-modal-input comm-date-input" style="flex:1">
    <input type="text" class="comm-modal-input comm-city-input" placeholder="City, State" style="flex:2">
    <button class="comm-remove-date" onclick="removeDateRow(this)" title="Remove">✕</button>`;
  container.appendChild(row);

  const cityInput = row.querySelector('.comm-city-input');
  if (_mapsLoaded) {
    _attachCityAC(cityInput);
  }
  // else: _mapsReady() will wire it when Maps loads
}

function removeDateRow(btn) {
  const row = btn.closest('.comm-date-entry');
  if (document.querySelectorAll('.comm-date-entry').length <= 1) return; // keep at least 1
  row.remove();
}

function _attachCityAC(input) {
  if (input.dataset.ac) return;
  input.dataset.ac = '1';
  if (typeof google === 'undefined' || !google.maps?.places) return;
  const ac = new google.maps.places.Autocomplete(input, {
    types:  ['(cities)'],
    fields: ['name', 'address_components'],
  });
  ac.addListener('place_changed', () => {
    const place = ac.getPlace();
    if (place?.address_components) {
      const city  = place.address_components.find(c => c.types.includes('locality'))?.long_name || '';
      const state = place.address_components.find(c => c.types.includes('administrative_area_level_1'))?.short_name || '';
      if (city && state) input.value = `${city}, ${state}`;
    }
  });
  _cityAutocompletes.push(ac);
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
    const dateVal = row.querySelector('.comm-date-input').value;
    const cityVal = row.querySelector('.comm-city-input').value.trim();
    if (dateVal && cityVal) dates.push({ date: dateVal, city: cityVal });
  }
  if (!dates.length) { errEl.textContent = 'Please add at least one date and city.'; return; }

  const btn = document.getElementById('postSubmitBtn');
  btn.disabled = true; btn.textContent = 'Posting…';

  const { data: posting, error: postErr } = await sb.from('tour_postings').insert({
    band_id:            currentBandProfile.id,
    type:               _postType,
    title,
    description,
    genres:             _postGenres,
    contact_preference: contactPref,
    contact_email:      contactPref === 'email' ? contactEmail : null,
  }).select().single();

  if (postErr) {
    errEl.textContent = 'Could not post — ' + postErr.message;
    btn.disabled = false; btn.textContent = 'Post to Community →';
    return;
  }

  // Insert dates
  const dateInserts = dates.map(d => ({ posting_id: posting.id, date: d.date, city: d.city }));
  const { error: dateErr } = await sb.from('posting_dates').insert(dateInserts);
  if (dateErr) {
    errEl.textContent = 'Posting saved but dates failed — ' + dateErr.message;
    btn.disabled = false; btn.textContent = 'Post to Community →';
    return;
  }

  closePostModal();
  showToast('Opportunity posted!', 'success');
  await fetchPostings();
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
    .select(`*, bands(id, band_name, genre, home_city, profile_photo_url, epk_theme, review_count), posting_dates(date, city)`)
    .eq('posting_id', postingId)
    .order('created_at', { ascending: false });

  const body = document.getElementById('manageModalBody');

  if (error || !interests?.length) {
    body.innerHTML = '<div class="comm-empty" style="padding:24px 0"><div class="comm-empty-title">No responses yet</div><div class="comm-empty-sub">When bands express interest they will appear here.</div></div>';
    return;
  }

  // Group by date
  const byDate = {};
  interests.forEach(i => {
    const key = i.posting_date_id;
    if (!byDate[key]) byDate[key] = { date: i.posting_dates, items: [] };
    byDate[key].items.push(i);
  });

  body.innerHTML = Object.entries(byDate).map(([dateId, group]) => {
    const d = group.date;
    const fmtDate = d ? new Date(d.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
    const dateLabel = fmtDate ? `${fmtDate} · ${d.city}` : 'Date TBD';

    const itemsHtml = group.items.map(i => {
      const band = i.bands || {};
      const initials = (band.band_name || 'B').substring(0,2).toUpperCase();
      const slug = (band.band_name || '').toLowerCase().replace(/\s+/g,'-').replace(/[^a-z0-9-]/g,'');
      const avatarEl = band.profile_photo_url
        ? `<img src="${band.profile_photo_url}" class="comm-avatar comm-avatar-img" style="width:32px;height:32px" alt="">`
        : `<div class="comm-avatar comm-avatar-init" style="width:32px;height:32px;font-size:0.7rem">${initials}</div>`;

      const statusBadge = i.status !== 'pending'
        ? `<span class="comm-status-badge comm-status-${i.status}">${i.status}</span>`
        : '';

      const actions = i.status === 'pending' ? `
        <button class="comm-accept-btn" onclick="updateInterestStatus(${i.id},'accepted',${band.id},${JSON.stringify(d?.city||'')})">Accept</button>
        <button class="comm-decline-btn" onclick="updateInterestStatus(${i.id},'declined',${band.id},${JSON.stringify(d?.city||'')})">Decline</button>` : '';

      return `<div class="comm-response-card">
        <div class="comm-response-header">
          ${avatarEl}
          <div style="flex:1">
            <div class="comm-band-name" style="font-size:0.9rem">${escapeHtml(band.band_name || '—')}</div>
            <div class="comm-band-meta">${escapeHtml([band.genre, band.home_city].filter(Boolean).join(' · '))}</div>
            ${band.review_count > 0 ? `<div class="comm-trust" style="font-size:0.6rem">★ ${band.review_count} review${band.review_count!==1?'s':''}</div>` : ''}
          </div>
          ${statusBadge}
        </div>
        ${i.message ? `<p class="comm-response-msg">${escapeHtml(i.message)}</p>` : ''}
        <div class="comm-response-actions">
          ${band.epk_theme && slug ? `<a class="comm-card-btn comm-card-btn--outline" href="epk.html?band=${slug}" target="_blank" style="font-size:0.58rem;padding:6px 12px">View EPK</a>` : ''}
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
  const notifType = status === 'accepted' ? 'interest_accepted' : 'interest_declined';
  await sb.from('notifications').insert({
    band_id:    toBandId,
    type:       notifType,
    payload:    { posting_title: posting?.title, city },
    posting_id: _managePostingId,
    read:       false,
  });

  showToast(status === 'accepted' ? 'Accepted — they've been notified.' : 'Declined.', 'success');
  await _loadManageResponses(_managePostingId);
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
  const typeLabel = {
    interest_received: '✉ expressed interest in your',
    interest_accepted: '✓ accepted your interest for',
    interest_declined: '— declined your interest for',
  };

  const itemsHtml = notifs.map(n => {
    const p      = n.payload || {};
    const label  = typeLabel[n.type] || n.type;
    const band   = p.from_band   || '';
    const city   = p.city        || '';
    const title  = p.posting_title || '';
    let desc;
    if (n.type === 'interest_received') desc = `${escapeHtml(band)} ${label} posting`;
    else                                desc = `Your interest ${n.type === 'interest_accepted' ? 'was accepted' : 'was declined'} for ${escapeHtml(city || title)}`;

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
