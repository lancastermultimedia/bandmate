// shows.js — Show document management: per-show details, bill, payment, gear

let _showsList       = [];
let _currentShowId   = null;
let _pendingByPosting = {};

const SHOW_COLORS      = ['#d94535', '#7a8a3a', '#3a7a8a', '#c8a53a'];
const SHOW_COLORS_DARK = ['#a82c22', '#546030', '#2a5868', '#8a7020'];

function _escH(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function _fmtDate(dateStr, opts = { weekday:'long', month:'long', day:'numeric', year:'numeric' }) {
  if (!dateStr) return '';
  return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-US', opts);
}

// ── Shows Tab ──────────────────────────────────────────────────────

async function loadShowsTab() {
  const el = document.getElementById('showsTabContent');
  if (!el) return;
  if (typeof currentBandProfile === 'undefined' || !currentBandProfile) {
    el.innerHTML = '<div class="profile-empty-state">Log in to view your shows.</div>';
    return;
  }

  el.innerHTML = '<div class="prof-loading">Loading shows…</div>';
  const bandId = currentBandProfile.id;

  // Shows where this band is headliner
  const { data: headlinerShows } = await (async () => {
    try {
      return await sb.from('shows')
        .select('*, show_bands(*, bands(id, band_name, profile_photo_url))')
        .eq('headliner_id', bandId)
        .order('show_date', { ascending: false });
    } catch(e) { return { data: [] }; }
  })();

  // Shows where this band is an opener
  const { data: openerRows } = await (async () => {
    try {
      return await sb.from('show_bands')
        .select('show_id, shows(*, show_bands(*, bands(id, band_name, profile_photo_url)))')
        .eq('band_id', bandId)
        .neq('role', 'headliner');
    } catch(e) { return { data: [] }; }
  })();

  const seen = new Set();
  _showsList = [];
  (headlinerShows || []).forEach(s => { seen.add(s.id); _showsList.push({ ...s, _isHeadliner: true }); });
  (openerRows || []).forEach(row => {
    const s = row.shows;
    if (s && !seen.has(s.id)) { seen.add(s.id); _showsList.push({ ...s, _isHeadliner: false }); }
  });
  _showsList.sort((a, b) => {
    if (!a.show_date && !b.show_date) return 0;
    if (!a.show_date) return 1;
    if (!b.show_date) return -1;
    return new Date(b.show_date) - new Date(a.show_date);
  });

  // Fetch pending applicant counts for headliner shows that have a posting
  const headlinerPostingIds = _showsList
    .filter(s => s._isHeadliner && s.posting_id)
    .map(s => s.posting_id);
  _pendingByPosting = {};
  if (headlinerPostingIds.length) {
    const { data: pendingRows } = await (async () => {
      try {
        return await sb.from('posting_interests')
          .select('posting_id')
          .in('posting_id', headlinerPostingIds)
          .eq('status', 'pending');
      } catch(e) { return { data: [] }; }
    })();
    (pendingRows || []).forEach(r => {
      _pendingByPosting[r.posting_id] = (_pendingByPosting[r.posting_id] || 0) + 1;
    });
  }

  if (!_showsList.length) {
    el.innerHTML = `
      <div class="shows-empty">
        <div class="shows-empty-icon">♪</div>
        <div class="shows-empty-title">No shows yet</div>
        <div class="shows-empty-sub">Post a show on Community seeking an opener and it'll appear here automatically. You can then fill in times, payment splits, and gear details so everyone on the bill is on the same page before load-in.</div>
        <a href="community.html" class="shows-empty-cta">Post to Community →</a>
      </div>`;
    return;
  }

  const now = new Date(); now.setHours(0,0,0,0);
  const upcoming = _showsList.filter(s => !s.show_date || new Date(s.show_date + 'T12:00:00') >= now);
  const past     = _showsList.filter(s => s.show_date && new Date(s.show_date + 'T12:00:00') < now);

  let html = '';
  if (upcoming.length) {
    html += '<div class="shows-section-label">Upcoming</div>';
    html += upcoming.map((s, i) => _renderShowCard(s, i, false, _pendingByPosting[s.posting_id] || 0)).join('');
  }
  if (past.length) {
    html += '<div class="shows-section-label shows-section-label--past">Past Shows</div>';
    html += past.map((s, i) => _renderShowCard(s, upcoming.length + i, true, 0)).join('');
  }

  el.innerHTML = html;
}

function _renderShowCard(show, idx, isPast = false, pendingCount = 0) {
  const color     = SHOW_COLORS[idx % 4];
  const darkColor = SHOW_COLORS_DARK[idx % 4];
  const dateShort = show.show_date ? _fmtDate(show.show_date, { weekday:'short', month:'short', day:'numeric' }) : 'Date TBD';
  const venue     = show.venue_name || 'Venue TBD';
  const city      = show.city || '';

  const bands  = (show.show_bands || []);
  const openers = bands.filter(b => b.role !== 'headliner');
  const openerText = openers.length
    ? openers.map(o => _escH(o.bands?.band_name || 'TBD')).join(', ')
    : 'No openers yet';

  const statusMap   = { draft: 'Draft', shared: 'Shared', past: 'Done' };
  const statusLabel = isPast ? 'Done' : (statusMap[show.status] || 'Draft');
  const statusCls   = isPast ? 'past' : (show.status || 'draft');

  const myRole   = show._isHeadliner ? 'Headliner' : 'Opener';
  const roleCls  = show._isHeadliner ? 'show-card-role--hl' : 'show-card-role--op';

  // Past shows: prompt for feedback if not yet given
  const needsFeedback = isPast && show._isHeadliner && openers.length > 0;

  return `
    <div class="show-card" onclick="openShowDocument(${show.id})" style="--show-color:${color};--show-dark:${darkColor}">
      <div class="show-card-stripe"></div>
      <div class="show-card-body">
        <div class="show-card-top">
          <div class="show-card-main">
            <div class="show-card-venue">${_escH(venue)}</div>
            <div class="show-card-date">${_escH(dateShort)}${city ? ' · ' + _escH(city) : ''}</div>
          </div>
          <div class="show-card-badges">
            <div class="show-card-role ${roleCls}">${myRole}</div>
            <div class="show-card-status show-card-status--${statusCls}">${statusLabel}</div>
          </div>
        </div>
        <div class="show-card-bill">Supporting: ${openerText}</div>
        ${!isPast && show._isHeadliner && pendingCount > 0 ? `
          <div class="show-card-applicants" onclick="event.stopPropagation();openApplicantsModal(${show.id})">
            ${pendingCount} band${pendingCount !== 1 ? 's' : ''} want${pendingCount === 1 ? 's' : ''} to play this show — Review →
          </div>` : ''}
        ${needsFeedback ? `
          <div class="show-card-feedback" onclick="event.stopPropagation();openPostShowFeedback(${show.id})">
            How did the show go? Leave private feedback →
          </div>` : ''}
      </div>
    </div>`;
}

// ── Show Document Modal ────────────────────────────────────────────

async function openShowDocument(showId) {
  _currentShowId = showId;
  _injectShowModal();

  const overlay = document.getElementById('showDocOverlay');
  const content = document.getElementById('showDocContent');
  content.innerHTML = '<div class="show-doc-loading">Loading show details…</div>';
  overlay.style.display = 'flex';
  document.body.style.overflow = 'hidden';

  const { data: show } = await (async () => {
    try {
      return await sb.from('shows')
        .select('*, show_bands(*, bands(id, band_name, profile_photo_url, genre, home_city))')
        .eq('id', showId)
        .single();
    } catch(e) { return { data: null }; }
  })();

  if (!show) {
    content.innerHTML = '<div class="show-doc-loading">Could not load show.</div>';
    return;
  }

  const isHeadliner  = currentBandProfile && show.headliner_id === currentBandProfile.id;
  const colorIdx     = show.id % 4;
  const headerColor  = SHOW_COLORS[colorIdx];
  const allBands     = (show.show_bands || []).sort((a, b) => a.role === 'headliner' ? -1 : 1);
  const openers      = allBands.filter(b => b.role !== 'headliner');
  const setOrder     = Array.isArray(show.set_order) ? show.set_order : [];

  const dateDisplay  = show.show_date ? _fmtDate(show.show_date) : '';

  const statusBadge  = show.status === 'shared'
    ? `<div class="show-doc-status-badge show-doc-status-badge--shared">✓ Shared with bill</div>`
    : `<div class="show-doc-status-badge show-doc-status-badge--draft">Draft</div>`;

  // ── Bill section rows ──
  const billRows = allBands.length
    ? allBands.map(sb_row => {
        const b = sb_row.bands || {};
        const initials = (b.band_name || '?').substring(0, 2).toUpperCase();
        const avatar = b.profile_photo_url
          ? `<img src="${_escH(b.profile_photo_url)}" class="show-band-avatar show-band-avatar--img" alt="">`
          : `<div class="show-band-avatar show-band-avatar--init">${initials}</div>`;
        const roleLabel = { headliner: 'Headliner', opener: 'Opener', co_headliner: 'Co-Headliner' }[sb_row.role] || 'Opener';
        const existing  = setOrder.find(s => s.band_id === sb_row.band_id) || {};
        return `
          <div class="show-band-row">
            ${avatar}
            <div class="show-band-info">
              <div class="show-band-name">${_escH(b.band_name || 'Unknown Band')}</div>
              <div class="show-band-role-chip">${roleLabel}</div>
            </div>
            ${isHeadliner ? `
              <div class="show-band-times">
                <input class="show-time-input" type="text" placeholder="Set time" value="${_escH(existing.set_time || '')}" data-band="${sb_row.band_id}" data-field="set_time" aria-label="Set time">
                <input class="show-time-input show-time-input--short" type="number" placeholder="Min" min="1" max="180" value="${existing.set_length_min || ''}" data-band="${sb_row.band_id}" data-field="set_length_min" aria-label="Set length in minutes">
              </div>` : `
              <div class="show-band-times-ro">
                ${existing.set_time ? _escH(existing.set_time) : '—'}${existing.set_length_min ? ' · ' + existing.set_length_min + ' min' : ''}
              </div>`}
          </div>`;
      }).join('')
    : `<div class="show-doc-no-bands">No bands on the bill yet. Accept an opener from Community and they'll appear here.</div>`;

  // ── Timeline rows ──
  const timelineFields = [
    { label: 'Load-in',    field: 'load_in_time',    placeholder: 'e.g. 5:00 PM' },
    { label: 'Soundcheck', field: 'soundcheck_time',  placeholder: 'e.g. 6:30 PM' },
    { label: 'Doors',      field: 'doors_time',       placeholder: 'e.g. 7:00 PM' },
  ];
  const timelineRows = timelineFields.map(({ label, field, placeholder }) => `
    <div class="show-timeline-row">
      <div class="show-timeline-label">${label}</div>
      ${isHeadliner
        ? `<input class="show-time-input" type="text" id="showField_${field}" placeholder="${placeholder}" value="${_escH(show[field] || '')}">`
        : `<div class="show-timeline-val">${show[field] ? _escH(show[field]) : '<span class="show-empty-val">—</span>'}</div>`}
    </div>`).join('');

  // ── Text section helper ──
  const textSection = (field, placeholder, hint) => isHeadliner
    ? `${hint ? `<div class="show-doc-hint">${hint}</div>` : ''}
       <textarea class="show-doc-textarea" id="showField_${field}" placeholder="${placeholder}" rows="3">${_escH(show[field] || '')}</textarea>`
    : `${hint ? `<div class="show-doc-hint">${hint}</div>` : ''}
       <div class="show-doc-field-ro">${show[field] ? _escH(show[field]) : '<span class="show-empty-val">Not filled in yet</span>'}</div>`;

  // ── Footer ──
  let footer;
  if (isHeadliner) {
    const canShare = openers.length > 0 && show.status === 'draft';
    const alreadyShared = show.status === 'shared';
    footer = `
      <div class="show-doc-footer">
        <button class="show-doc-save-btn" onclick="saveShowDocument()">Save</button>
        ${canShare
          ? `<button class="show-doc-share-btn" onclick="saveAndShareShow()">Save + Share with Openers →</button>`
          : alreadyShared
          ? `<div class="show-doc-shared-note">✓ Shared with supporting acts — they can see this document</div>`
          : `<button class="show-doc-share-btn show-doc-share-btn--dim" disabled title="Accept an opener from Community first">Share with Openers</button>`}
      </div>`;
  } else {
    footer = `
      <div class="show-doc-footer">
        <div class="show-doc-viewer-note">You're on the bill — the headliner manages show details. Details appear here once they're filled in.</div>
      </div>`;
  }

  content.innerHTML = `
    <div class="show-doc-header" style="background:${headerColor}">
      <button class="show-doc-close" onclick="closeShowDocument()">✕</button>
      <div class="show-doc-venue-name">${_escH(show.venue_name || 'Venue TBD')}</div>
      <div class="show-doc-header-meta">
        ${dateDisplay ? _escH(dateDisplay) : ''}${show.city ? (dateDisplay ? ' · ' : '') + _escH(show.city) : ''}
      </div>
      ${statusBadge}
    </div>

    <div class="show-doc-body">

      <div class="show-doc-section">
        <div class="show-doc-section-label">The Bill</div>
        <div class="show-band-list">${billRows}</div>
        ${isHeadliner && allBands.length > 0 ? `<div class="show-doc-hint" style="margin-top:8px">Enter each band's set time and length in minutes.</div>` : ''}
      </div>

      <div class="show-doc-section">
        <div class="show-doc-section-label">Timeline</div>
        <div class="show-timeline">${timelineRows}</div>
      </div>

      <div class="show-doc-section show-doc-section--money">
        <div class="show-doc-section-label">Payment</div>
        ${textSection('payment_notes',
          'e.g. Door split: 60% headliner / 40% opener after $200 guarantee for each. Paid at end of night in cash or Venmo.',
          'Be explicit — amounts, format, and when each band gets paid. This is the section that prevents end-of-night confusion.')}
      </div>

      <div class="show-doc-section">
        <div class="show-doc-section-label">Backline + Gear</div>
        ${textSection('backline_notes',
          'e.g. Venue provides PA and monitors. Headliner has full drum kit available to openers. Each band brings their own amps.',
          'What the venue provides, what the headliner has, what each opener needs to bring.')}
      </div>

      <div class="show-doc-section">
        <div class="show-doc-section-label">Notes</div>
        ${textSection('other_notes',
          'e.g. Load in through the side alley on Oak St. Street parking only within 2 blocks. Bands keep 100% of merch — no house cut.',
          'Parking, load-in entrance, merch policy, anything else openers need to know.')}
      </div>

    </div>
    ${footer}`;
}

function closeShowDocument() {
  const overlay = document.getElementById('showDocOverlay');
  if (overlay) overlay.style.display = 'none';
  document.body.style.overflow = '';
}

async function saveShowDocument() {
  if (!_currentShowId) return;

  const payload = {};
  ['load_in_time', 'soundcheck_time', 'doors_time', 'payment_notes', 'backline_notes', 'other_notes'].forEach(field => {
    const el = document.getElementById('showField_' + field);
    if (el) payload[field] = el.value.trim() || null;
  });

  // Collect per-band set times from inputs
  const setMap = {};
  document.querySelectorAll('.show-time-input[data-band]').forEach(input => {
    const bandId = parseInt(input.dataset.band);
    const field  = input.dataset.field;
    if (!setMap[bandId]) setMap[bandId] = { band_id: bandId };
    setMap[bandId][field] = field === 'set_length_min'
      ? (parseInt(input.value) || null)
      : (input.value.trim() || null);
  });
  const setOrder = Object.values(setMap).filter(e => e.set_time || e.set_length_min);
  if (setOrder.length) payload.set_order = setOrder;

  payload.updated_at = new Date().toISOString();

  const { error } = await sb.from('shows').update(payload).eq('id', _currentShowId);
  if (error) { showToast('Save failed — ' + error.message, 'error'); return; }
  showToast('Show document saved.', 'success');
}

async function saveAndShareShow() {
  await saveShowDocument();
  if (!_currentShowId) return;

  const { error } = await sb.from('shows').update({ status: 'shared' }).eq('id', _currentShowId);
  if (error) { showToast('Could not share — ' + error.message, 'error'); return; }

  // Notify openers
  const { data: openerRows } = await sb.from('show_bands')
    .select('band_id, shows(venue_name, show_date)')
    .eq('show_id', _currentShowId)
    .neq('role', 'headliner');

  if (openerRows?.length) {
    const show = openerRows[0]?.shows || {};
    const notifs = openerRows.map(row => ({
      band_id: row.band_id,
      type:    'show_document_shared',
      payload: { show_id: _currentShowId, venue_name: show.venue_name || '', show_date: show.show_date || '' },
      read:    false,
    }));
    await sb.from('notifications').insert(notifs);
  }

  showToast('Show details shared with your supporting acts.', 'success');
  closeShowDocument();
  loadShowsTab();
}

// ── Post-show Feedback ─────────────────────────────────────────────

function openPostShowFeedback(showId) {
  const show = _showsList.find(s => s.id === showId);
  if (!show) return;
  const openers = (show.show_bands || []).filter(b => b.role !== 'headliner');
  if (!openers.length) { showToast('No supporting acts recorded for this show.'); return; }

  const existing = document.getElementById('postShowFeedbackOverlay');
  if (existing) existing.remove();

  const venueName  = show.venue_name || 'the show';
  const dateLine   = show.show_date ? _fmtDate(show.show_date, { month: 'long', day: 'numeric', year: 'numeric' }) : '';

  document.body.insertAdjacentHTML('beforeend', `
    <div class="show-doc-overlay" id="postShowFeedbackOverlay" onclick="if(event.target===this)document.getElementById('postShowFeedbackOverlay').remove()">
      <div class="show-feedback-modal">
        <button class="show-doc-close" onclick="document.getElementById('postShowFeedbackOverlay').remove()">✕</button>
        <div class="show-feedback-eyebrow">Private Feedback</div>
        <div class="show-feedback-title">How did the show go?</div>
        <div class="show-feedback-sub">${_escH(venueName)}${dateLine ? ' · ' + dateLine : ''}</div>
        <div class="show-feedback-disclaimer">This feedback is only visible to you. It helps Bandmate keep the community trustworthy — patterns of negative feedback are reviewed internally.</div>
        <div id="feedbackBandList">
          ${openers.map(row => {
            const b = row.bands || {};
            return `
              <div class="show-feedback-band">
                <div class="show-feedback-band-name">${_escH(b.band_name || 'Unknown Band')}</div>
                <div class="show-feedback-opts">
                  <label class="show-feedback-opt"><input type="radio" name="pfb_${row.band_id}" value="yes"><span>Yes, I'd play with them again</span></label>
                  <label class="show-feedback-opt"><input type="radio" name="pfb_${row.band_id}" value="maybe"><span>Maybe</span></label>
                  <label class="show-feedback-opt"><input type="radio" name="pfb_${row.band_id}" value="no"><span>No</span></label>
                </div>
                <textarea class="show-feedback-notes" placeholder="Anything we should know? (optional, private)" data-band="${row.band_id}" rows="2"></textarea>
              </div>`;
          }).join('')}
        </div>
        <button class="show-doc-save-btn" style="width:100%;margin-top:16px" onclick="submitPostShowFeedback(${showId})">Submit Feedback →</button>
      </div>
    </div>`);
  document.getElementById('postShowFeedbackOverlay').style.display = 'flex';
}

async function submitPostShowFeedback(showId) {
  if (!currentBandProfile) return;
  const show = _showsList.find(s => s.id === showId);
  if (!show) return;

  const openers = (show.show_bands || []).filter(b => b.role !== 'headliner');
  const inserts = [];
  openers.forEach(row => {
    const selected = document.querySelector(`input[name="pfb_${row.band_id}"]:checked`);
    const notes    = document.querySelector(`textarea[data-band="${row.band_id}"]`);
    if (selected) {
      inserts.push({
        show_id:         showId,
        from_band_id:    currentBandProfile.id,
        about_band_id:   row.band_id,
        would_play_again: selected.value,
        notes:            notes?.value?.trim() || null,
      });
    }
  });

  if (!inserts.length) { showToast('Select at least one rating.', 'error'); return; }

  const { error } = await sb.from('post_show_feedback').upsert(inserts, { onConflict: 'show_id,from_band_id,about_band_id' });
  if (error) { showToast('Could not save — ' + error.message, 'error'); return; }

  document.getElementById('postShowFeedbackOverlay')?.remove();
  showToast('Feedback saved. Thank you for keeping the community honest.', 'success');
  loadShowsTab();
}

// ── Applicants Modal ───────────────────────────────────────────────

async function openApplicantsModal(showId) {
  const show = _showsList.find(s => s.id === showId);
  if (!show || !show.posting_id) return;

  _injectApplicantsModal();
  const overlay     = document.getElementById('applicantsOverlay');
  const modal       = document.getElementById('applicantsModal');
  const colorIdx    = show.id % 4;
  const headerColor = SHOW_COLORS[colorIdx];
  const dateShort   = show.show_date ? _fmtDate(show.show_date, { weekday:'short', month:'short', day:'numeric' }) : 'Date TBD';

  modal.innerHTML = `
    <div class="show-doc-header" style="background:${headerColor}">
      <button class="show-doc-close" onclick="closeApplicantsModal()">✕</button>
      <div class="show-doc-venue-name">${_escH(show.venue_name || 'Show')}</div>
      <div class="show-doc-header-meta">${_escH(dateShort)}${show.city ? ' · ' + _escH(show.city) : ''}</div>
    </div>
    <div class="show-doc-body" id="applicantsBody">
      <div class="show-doc-loading">Loading applicants…</div>
    </div>`;

  overlay.style.display = 'flex';
  document.body.style.overflow = 'hidden';

  const { data: interests } = await (async () => {
    try {
      return await sb.from('posting_interests')
        .select('id, status, message, band_id, bands(id, band_name, genre, home_city, profile_photo_url, epk_theme, email), posting_dates(city, date)')
        .eq('posting_id', show.posting_id)
        .order('status', { ascending: true })
        .order('created_at', { ascending: false });
    } catch(e) { return { data: [] }; }
  })();

  const body = document.getElementById('applicantsBody');
  if (!body) return;

  if (!interests?.length) {
    body.innerHTML = `
      <div class="show-doc-section" style="text-align:center;padding:32px 0">
        <div class="show-doc-hint">No applicants yet. When bands express interest on Community they'll appear here.</div>
      </div>`;
    return;
  }

  body.innerHTML = `
    <div class="show-doc-section">
      <div class="show-doc-section-label">Applicants</div>
      <div class="show-band-list">
        ${interests.map(i => {
          const band = i.bands || {};
          const init = (band.band_name || 'B').substring(0, 2).toUpperCase();
          const av   = band.profile_photo_url
            ? `<img src="${_escH(band.profile_photo_url)}" class="show-band-avatar show-band-avatar--img" alt="">`
            : `<div class="show-band-avatar show-band-avatar--init">${init}</div>`;
          const meta = [band.genre, band.home_city].filter(Boolean).map(_escH).join(' · ');
          const statusBadge = i.status !== 'pending'
            ? `<div class="show-card-status show-card-status--${i.status === 'accepted' ? 'shared' : 'draft'}" style="flex-shrink:0;margin-left:auto">${i.status}</div>`
            : '';
          const actions = i.status === 'pending' ? `
            <div style="display:flex;gap:8px;margin-top:10px;padding-left:52px">
              <button class="show-doc-share-btn" style="padding:6px 16px;font-size:0.65rem"
                onclick="_handleApplicantResponse(${i.id},${band.id},${showId},'accepted')">Accept</button>
              <button class="show-doc-save-btn" style="padding:6px 16px;font-size:0.65rem;background:rgba(15,15,12,0.07);color:var(--ink)"
                onclick="_handleApplicantResponse(${i.id},${band.id},${showId},'declined')">Decline</button>
            </div>` : '';
          return `
            <div class="show-band-row" style="flex-wrap:wrap;row-gap:0">
              <div style="display:flex;align-items:center;gap:12px;flex:1;min-width:0">
                ${av}
                <div class="show-band-info">
                  <div class="show-band-name">${_escH(band.band_name || 'Unknown Band')}</div>
                  ${meta ? `<div class="show-band-role-chip">${meta}</div>` : ''}
                </div>
              </div>
              ${statusBadge}
              ${i.message ? `<div style="width:100%;font-size:0.75rem;font-style:italic;padding-left:52px;margin-top:6px;opacity:0.7">"${_escH(i.message)}"</div>` : ''}
              ${actions}
            </div>`;
        }).join('')}
      </div>
    </div>`;
}

function closeApplicantsModal() {
  const overlay = document.getElementById('applicantsOverlay');
  if (overlay) overlay.style.display = 'none';
  document.body.style.overflow = '';
}

async function _handleApplicantResponse(interestId, bandId, showId, status) {
  const { error } = await sb.from('posting_interests').update({ status }).eq('id', interestId);
  if (error) { showToast('Could not update — ' + error.message, 'error'); return; }

  // Notify the applicant
  (async () => {
    try {
      await sb.from('notifications').insert({
        band_id: bandId,
        type:    status === 'accepted' ? 'interest_accepted' : 'interest_declined',
        payload: { from_band: currentBandProfile?.band_name },
        read:    false,
      });
    } catch(_) {}
  })();

  if (status === 'accepted') {
    // Add to show_bands
    (async () => {
      try {
        await sb.from('show_bands').upsert({
          show_id:     showId,
          band_id:     bandId,
          role:        'opener',
          status:      'invited',
          interest_id: interestId,
        }, { onConflict: 'show_id,band_id' });
      } catch(_) {}
    })();

    // Also propagate to tour stops if the posting is linked to a tour
    (async () => {
      try {
        const show = _showsList.find(s => s.id === showId);
        if (!show?.posting_id) return;
        const { data: posting } = await sb
          .from('tour_postings')
          .select('linked_tour_id, linked_stop_ids, type')
          .eq('id', show.posting_id)
          .maybeSingle();
        if (!posting?.linked_tour_id) return;
        const roleMap = { tour_support: 'opener', local_opener: 'support', co_headlining: 'co-headliner' };
        const role = roleMap[posting.type] || 'support';
        const upd  = { supporting_band_id: bandId, supporting_role: role };
        if (posting.linked_stop_ids?.length) {
          await sb.from('tour_stops').update(upd).in('id', posting.linked_stop_ids);
        } else {
          await sb.from('tour_stops').update(upd).eq('tour_id', posting.linked_tour_id);
        }
      } catch(_) {}
    })();
  }

  showToast(status === 'accepted' ? 'Accepted!' : 'Declined', status === 'accepted' ? 'success' : '');
  closeApplicantsModal();
  loadShowsTab();
}

function _injectApplicantsModal() {
  if (document.getElementById('applicantsOverlay')) return;
  document.body.insertAdjacentHTML('beforeend', `
    <div class="show-doc-overlay" id="applicantsOverlay" onclick="if(event.target===this)closeApplicantsModal()">
      <div class="show-doc-modal" id="applicantsModal"></div>
    </div>`);
}

// ── DOM injection ──────────────────────────────────────────────────

function _injectShowModal() {
  if (document.getElementById('showDocOverlay')) return;
  document.body.insertAdjacentHTML('beforeend', `
    <div class="show-doc-overlay" id="showDocOverlay" onclick="if(event.target===this)closeShowDocument()">
      <div class="show-doc-modal" id="showDocContent"></div>
    </div>`);
}

// ── Hooks called by community.js ───────────────────────────────────

window.loadShowsTab             = loadShowsTab;
window.openShowDocument         = openShowDocument;
window.closeShowDocument        = closeShowDocument;
window.saveShowDocument         = saveShowDocument;
window.saveAndShareShow         = saveAndShareShow;
window.openPostShowFeedback     = openPostShowFeedback;
window.submitPostShowFeedback   = submitPostShowFeedback;
window.openApplicantsModal      = openApplicantsModal;
window.closeApplicantsModal     = closeApplicantsModal;
window._handleApplicantResponse = _handleApplicantResponse;
