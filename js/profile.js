// profile.js — Band Profile & EPK management

const FREE_PRESS_LIMIT  = 10;
const FREE_QUOTES_LIMIT = 5;

// Guard: form fields are populated exactly once per session so that
// TOKEN_REFRESHED / periodic auth events never wipe unsaved edits.
let formPopulated = false;

// Only run profile-page DOM operations when on the actual profile page.
const _IS_PROFILE_PAGE = !!document.getElementById('profilePage');

// ── Save button helper — three states ─────────────────────────────────────────
// Returns { saving(), success(), error(msg) } for a given button element.
function saveBtnCtrl(btnId, defaultLabel) {
  const btn = document.getElementById(btnId);
  if (!btn) return { saving(){}, success(){}, error(){} };
  return {
    saving() {
      btn.textContent = 'Saving…';
      btn.disabled    = true;
    },
    success() {
      btn.textContent = 'Saved ✓';
      btn.disabled    = false;
      setTimeout(() => { btn.textContent = defaultLabel; }, 2000);
    },
    error(msg) {
      console.error(`[profile save] ${btnId}:`, msg);
      btn.textContent = (msg && msg.length < 60) ? `Error: ${msg}` : 'Save failed — see console';
      btn.disabled    = false;
      setTimeout(() => { btn.textContent = defaultLabel; }, 5000);
    },
  };
}

// ── Populate content forms (used by both profile.html and epk-builder.html) ────

function populateContentForms(bp) {
  if (!bp) return;
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val || ''; };

  set('profileBio',  bp.bio);
  set('profileCity', bp.home_city);
  const chipsEl = document.getElementById('profileGenreChips');
  if (chipsEl) loadGenreChips('profileGenreChips').then(() => preselectGenres('profileGenreChips', bp.genre));

  set('linkSpotify',    bp.spotify_url);
  set('linkYoutube',    bp.youtube_url);
  set('linkSoundcloud', bp.soundcloud_url);
  set('linkAppleMusic', bp.apple_music_url);
  set('linkBandcamp',   bp.bandcamp_url);
  set('linkWebsite',    bp.website);
  set('linkInstagram',  bp.instagram_url);
  set('linkTiktok',     bp.tiktok_url);
  set('linkFacebook',   bp.facebook_url);

  if (bp.bandcamp_embed) {
    set('linkBandcampEmbed', bp.bandcamp_embed);
    const toggle = document.getElementById('bandcampEmbedToggle');
    const field  = document.getElementById('bandcampEmbedField');
    if (toggle) toggle.checked = true;
    if (field)  field.style.display = 'block';
  }
}

// ── Init ──────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  await initAuth();
  renderProfile();

  sb.auth.onAuthStateChange(async (event) => {
    if (event !== 'SIGNED_IN' && event !== 'SIGNED_OUT') return;
    if (event === 'SIGNED_OUT') { formPopulated = false; renderProfile(); return; }
    await new Promise(r => setTimeout(r, 350));
    await loadBandProfile();
    formPopulated = false;
    renderProfile();
  });

  // Press photos drag-and-drop (null-safe)
  const uploadArea = document.getElementById('pressUploadArea');
  if (uploadArea) {
    uploadArea.addEventListener('click', () => document.getElementById('pressPhotoInput').click());
    uploadArea.addEventListener('dragover', e => { e.preventDefault(); uploadArea.classList.add('drag-over'); });
    uploadArea.addEventListener('dragleave', () => uploadArea.classList.remove('drag-over'));
    uploadArea.addEventListener('drop', e => {
      e.preventDefault();
      uploadArea.classList.remove('drag-over');
      handlePressPhotoUpload({ files: e.dataTransfer.files });
    });
  }

  const stagePlotArea = document.getElementById('stagePlotUploadArea');
  if (stagePlotArea) stagePlotArea.addEventListener('click', () => document.getElementById('stagePlotInput').click());

  const authModal = document.getElementById('authModal');
  if (authModal) authModal.addEventListener('click', function(e) { if (e.target === this) closeAuth(); });

  document.body.style.visibility = 'visible';
});

// ── Main render ───────────────────────────────────────────────────────────────

async function renderProfile() {
  if (!_IS_PROFILE_PAGE) return;

  if (!currentUser || !currentBandProfile) {
    document.getElementById('profilePage').style.display      = 'none';
    document.getElementById('profileNotAuthed').style.display = 'block';
    return;
  }

  document.getElementById('profileNotAuthed').style.display = 'none';
  document.getElementById('profilePage').style.display      = 'block';

  const bp        = currentBandProfile;
  const isPremium = isBandPremium(bp);

  // ── Hero ──
  renderAvatarEl(bp.profile_photo_url, bp.band_name, 'profilePhotoEl');
  document.getElementById('profileName').textContent = bp.band_name || '—';
  document.getElementById('profileMeta').textContent =
    [bp.genre, bp.home_city].filter(Boolean).join(' · ');

  if (isPremium) {
    document.getElementById('profileBadge').style.display   = 'inline-block';
    document.getElementById('profileActions').style.display = 'flex';
  } else {
    document.getElementById('profileBadge').style.display   = 'none';
    document.getElementById('profileActions').style.display = 'none';
  }

  // ── Sections visibility ──
  document.getElementById('editSection').style.display        = isPremium ? 'block' : 'none';
  document.getElementById('epkSettingsSection').style.display = isPremium ? 'block' : 'none';

  // ── Form fields — populate ONCE per session ──
  if (isPremium && !formPopulated) {
    formPopulated = true;
    populateContentForms(bp);
  }

  // ── Progress & upgrade (free only) ──
  if (!isPremium) {
    const count = bp.review_count || 0;
    const pct   = Math.min((count / 3) * 100, 100);
    document.getElementById('progressSection').style.display = 'block';
    document.getElementById('progressLabel').textContent     = `${count} of 3 reviews`;
    document.getElementById('progressFill').style.width      = `${pct}%`;
    document.getElementById('upgradeSection').style.display  = 'block';
    document.getElementById('upgradeRemaining').textContent  =
      count >= 3
        ? 'You\'ve unlocked full access!'
        : `${3 - count} more review${3 - count !== 1 ? 's' : ''} to unlock full access`;
  } else {
    document.getElementById('progressSection').style.display = 'none';
    document.getElementById('upgradeSection').style.display  = 'none';
  }

  // ── Review history ──
  loadReviewHistory(bp.id);

  // ── Community tab badge (shows unread notification count) ──
  updateCommBadge(bp.id);

  // ── Reset tab state so switching back to EPK tab works cleanly ──
  _commTabLoaded = false;
  _tourTabLoaded = false;
  switchProfileTab('epk');
}

// ── Community: My Postings ────────────────────────────────────────────────────

async function loadMyPostings(bandId) {
  const section = document.getElementById('myPostingsSection');
  const list    = document.getElementById('myPostingsList');
  if (!section || !list) return;

  const { data, error } = await sb
    .from('tour_postings')
    .select('id, title, type, is_active, is_paused, created_at, interest_count, posting_dates(city)')
    .eq('band_id', bandId)
    .order('created_at', { ascending: false })
    .limit(10);

  if (error || !data?.length) {
    section.style.display = 'none';
    return;
  }

  section.style.display = 'block';
  const typeLabels = { tour_support: 'Tour Support', local_opener: 'Local Opener', co_headlining: 'Co-Headlining' };

  list.innerHTML = data.map(p => {
    const cities   = (p.posting_dates || []).map(d => d.city.split(',')[0]).slice(0, 3).join(', ');
    const label    = typeLabels[p.type] || p.type;
    const status   = !p.is_active ? 'Closed' : p.is_paused ? 'Paused' : 'Active';
    const statusCls= !p.is_active ? 'prof-posting-status--closed' : p.is_paused ? 'prof-posting-status--paused' : 'prof-posting-status--active';
    const interests = p.interest_count || 0;
    return `<div class="prof-posting-row">
      <div class="prof-posting-info">
        <div class="prof-posting-title">${escapeHtml(p.title)}</div>
        <div class="prof-posting-meta">${label}${cities ? ' · ' + escapeHtml(cities) : ''} · ${interests} interested</div>
      </div>
      <div class="prof-posting-right">
        <span class="prof-posting-status ${statusCls}">${status}</span>
        <a href="community.html" class="prof-posting-link">View →</a>
      </div>
    </div>`;
  }).join('');
}

// ── Community: Activity (expressed interests) ─────────────────────────────────

async function loadCommunityActivity(bandId) {
  const section = document.getElementById('communityActivitySection');
  const list    = document.getElementById('communityActivityList');
  if (!section || !list) return;

  const { data, error } = await sb
    .from('posting_interests')
    .select('id, status, created_at, posting_dates(city, date), tour_postings(id, title, type, bands(band_name))')
    .eq('band_id', bandId)
    .order('created_at', { ascending: false })
    .limit(8);

  if (error || !data?.length) {
    section.style.display = 'none';
    return;
  }

  section.style.display = 'block';
  const statusIcon = { pending: '⏳', accepted: '✓', declined: '—' };

  list.innerHTML = data.map(i => {
    const tp      = i.tour_postings || {};
    const d       = i.posting_dates || {};
    const bandName = tp.bands?.band_name || '—';
    const city     = d.city || '';
    const fmtDate  = d.date ? new Date(d.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';
    const icon     = statusIcon[i.status] || '';
    const cls      = `prof-interest-status--${i.status}`;
    return `<div class="prof-interest-row">
      <div class="prof-interest-info">
        <div class="prof-posting-title">${escapeHtml(tp.title || '—')}</div>
        <div class="prof-posting-meta">${escapeHtml(bandName)}${fmtDate ? ' · ' + fmtDate : ''}${city ? ' · ' + escapeHtml(city) : ''}</div>
      </div>
      <span class="prof-interest-status ${cls}">${icon} ${i.status}</span>
    </div>`;
  }).join('');
}

// ── Profile avatar ────────────────────────────────────────────────────────────

function renderAvatarEl(photoUrl, bandName, containerId) {
  const el = document.getElementById(containerId);
  if (!el) return;
  const initial = (bandName || 'B')[0].toUpperCase();
  el.innerHTML = photoUrl
    ? `<img src="${photoUrl}" class="profile-photo" alt="${bandName}">`
    : `<div class="profile-photo-init">${initial}</div>`;
}

async function handlePhotoUpload(input) {
  const file = input.files?.[0];
  if (!file || !currentBandProfile) return;

  if (file.size > 5 * 1024 * 1024) { showToast('Photo must be under 5 MB', 'error'); return; }

  const reader = new FileReader();
  reader.onload = e => {
    document.getElementById('profilePhotoEl').innerHTML =
      `<img src="${e.target.result}" class="profile-photo" alt="">`;
  };
  reader.readAsDataURL(file);

  showToast('Uploading photo…');

  const ext  = file.name.split('.').pop().toLowerCase();
  const path = `${currentBandProfile.id}.${ext}`;

  const { error: uploadError } = await sb.storage
    .from('band-photos')
    .upload(path, file, { upsert: true, contentType: file.type });

  if (uploadError) {
    renderAvatarEl(currentBandProfile.profile_photo_url, currentBandProfile.band_name, 'profilePhotoEl');
    showToast('Upload failed — check that the band-photos bucket exists', 'error');
    return;
  }

  const { data: { publicUrl } } = sb.storage.from('band-photos').getPublicUrl(path);

  const { error: dbError } = await sb.from('bands')
    .update({ profile_photo_url: publicUrl })
    .eq('email', currentUser.email);

  if (dbError) {
    console.error('[profile] photo DB save failed:', dbError);
    showToast('Photo uploaded but DB save failed — ' + dbError.message, 'error');
    return;
  }

  currentBandProfile.profile_photo_url = publicUrl;
  updateNavAuth();
  showToast('Photo saved', 'success');
}

// ── Save profile basics ───────────────────────────────────────────────────────

async function saveProfileEdits() {
  console.log('[save] currentUser:', currentUser?.email, '| is_premium:', currentBandProfile?.is_premium, '| review_count:', currentBandProfile?.review_count, '| isBandPremium:', isBandPremium(currentBandProfile));
  if (!currentUser || !currentBandProfile || !isBandPremium(currentBandProfile)) {
    showToast('Save blocked — not premium. Check console.', 'error');
    return;
  }

  const s = saveBtnCtrl('profileSaveBtn', 'Save Changes →');
  s.saving();

  const bio   = document.getElementById('profileBio').value.trim();
  const city  = document.getElementById('profileCity').value.trim();
  const genre = getSelectedGenres('profileGenreChips').join(', ') || currentBandProfile.genre || '';

  const { data, error } = await sb.from('bands')
    .update({ bio, home_city: city, genre })
    .eq('email', currentUser.email)
    .select();

  if (error) {
    console.error('[profile] saveProfileEdits failed:', JSON.stringify(error));
    s.error(error.message);
    showToast('Save failed — ' + error.message, 'error');
    return;
  }

  devLog('[profile] saveProfileEdits succeeded:', data);
  currentBandProfile.bio       = bio;
  currentBandProfile.home_city = city;
  currentBandProfile.genre     = genre;

  const metaEl = document.getElementById('profileMeta');
  if (metaEl) metaEl.textContent = [genre, city].filter(Boolean).join(' · ');

  s.success();
  showToast('Profile saved', 'success');
}

// ── Music & Links ─────────────────────────────────────────────────────────────

async function saveMusicLinks() {
  devLog('[profile] saveMusicLinks — currentUser:', currentUser?.email, 'bp.id:', currentBandProfile?.id);
  if (!currentUser || !currentBandProfile || !isBandPremium(currentBandProfile)) return;

  const s = saveBtnCtrl('musicLinksSaveBtn', 'Save Links →');
  s.saving();

  const useEmbed = document.getElementById('bandcampEmbedToggle')?.checked;
  const rawEmbed = document.getElementById('linkBandcampEmbed')?.value.trim() || '';
  // Sanitize embed: verify iframe src hostname is exactly bandcamp.com
  function _isSafeBandcampEmbed(html) {
    const m = html.match(/src=["']([^"']+)["']/i);
    if (!m) return false;
    try { const h = new URL(m[1]).hostname; return h === 'bandcamp.com' || h.endsWith('.bandcamp.com'); }
    catch { return false; }
  }
  const safeEmbed = (useEmbed && rawEmbed && _isSafeBandcampEmbed(rawEmbed)) ? rawEmbed : null;

  const updates = {
    spotify_url:     document.getElementById('linkSpotify').value.trim()    || null,
    youtube_url:     document.getElementById('linkYoutube').value.trim()    || null,
    soundcloud_url:  document.getElementById('linkSoundcloud').value.trim() || null,
    apple_music_url: document.getElementById('linkAppleMusic').value.trim() || null,
    bandcamp_url:    document.getElementById('linkBandcamp').value.trim()   || null,
    bandcamp_embed:  safeEmbed,
    website:         document.getElementById('linkWebsite').value.trim()    || null,
    instagram_url:   document.getElementById('linkInstagram').value.trim()  || null,
    tiktok_url:      document.getElementById('linkTiktok').value.trim()     || null,
    facebook_url:    document.getElementById('linkFacebook').value.trim()   || null,
  };

  const { data, error } = await sb.from('bands')
    .update(updates)
    .eq('email', currentUser.email)
    .select();

  if (error) {
    console.error('[profile] saveMusicLinks failed:', JSON.stringify(error));
    s.error(error.message);
    showToast('Save failed — ' + error.message, 'error');
    return;
  }

  devLog('[profile] saveMusicLinks succeeded:', data);
  Object.assign(currentBandProfile, updates);
  s.success();
  showToast('Links saved', 'success');
}

// ── Press Quotes ──────────────────────────────────────────────────────────────

async function loadQuotes(bandId) {
  const { data: quotes } = await sb
    .from('band_quotes')
    .select('*')
    .eq('band_id', bandId)
    .order('id');

  const container = document.getElementById('quotesContainer');
  if (!container) return;
  container.innerHTML = '';
  (quotes || []).forEach(q => addQuoteCard(q));
  updateQuotesUsage();
}

function addQuoteCard(q) {
  const container = document.getElementById('quotesContainer');
  if (!container) return;

  const isPremium  = currentBandProfile && isBandPremium(currentBandProfile);
  const existing   = container.querySelectorAll('.pf-quote-card').length;
  if (!isPremium && existing >= FREE_QUOTES_LIMIT) {
    showToast(`Free accounts can add up to ${FREE_QUOTES_LIMIT} press quotes`, 'error');
    return;
  }

  const card = document.createElement('div');
  card.className = 'pf-quote-card';
  card.innerHTML = `
    <div class="pf-quote-card-header">
      <span class="pf-quote-card-num">Quote ${existing + 1}</span>
      <button class="pf-quote-delete" onclick="this.closest('.pf-quote-card').remove();updateQuotesUsage()">✕ Remove</button>
    </div>
    <div class="profile-field">
      <label>Quote Text</label>
      <textarea class="pf-quote-text" rows="3" placeholder="Enter the press quote here...">${escProfileStr(q?.quote_text || '')}</textarea>
    </div>
    <div class="pf-quote-meta-row">
      <div class="profile-field" style="flex:1;margin-bottom:0">
        <label>Source</label>
        <input type="text" class="pf-quote-source" value="${escProfileStr(q?.source_name || '')}" placeholder="e.g. Rolling Stone">
      </div>
      <div class="profile-field" style="flex:1;margin-bottom:0">
        <label>Link (optional)</label>
        <input type="url" class="pf-quote-url" value="${escProfileStr(q?.source_url || '')}" placeholder="https://...">
      </div>
    </div>
  `;
  container.appendChild(card);
  updateQuotesUsage();
}

function updateQuotesUsage() {
  const container = document.getElementById('quotesContainer');
  const usage     = document.getElementById('quotesUsage');
  if (!container || !usage) return;

  const count     = container.querySelectorAll('.pf-quote-card').length;
  const isPremium = currentBandProfile && isBandPremium(currentBandProfile);

  usage.textContent = isPremium
    ? `${count} quote${count !== 1 ? 's' : ''}`
    : `${count} of ${FREE_QUOTES_LIMIT}${count >= FREE_QUOTES_LIMIT ? ' — upgrade for unlimited' : ''}`;

  const addBtn = document.getElementById('addQuoteBtn');
  if (addBtn) {
    const atLimit = !isPremium && count >= FREE_QUOTES_LIMIT;
    addBtn.style.opacity       = atLimit ? '0.4' : '1';
    addBtn.style.pointerEvents = atLimit ? 'none' : 'auto';
  }
}

async function saveQuotes() {
  devLog('[profile] saveQuotes — currentUser:', currentUser?.email, 'bp.id:', currentBandProfile?.id);
  const bp = currentBandProfile;
  if (!currentUser || !bp) return;

  const s = saveBtnCtrl('saveQuotesBtn', 'Save Quotes →');
  s.saving();

  const cards  = Array.from(document.querySelectorAll('.pf-quote-card'));
  const quotes = cards.map(card => ({
    band_id:     bp.id,
    quote_text:  card.querySelector('.pf-quote-text').value.trim(),
    source_name: card.querySelector('.pf-quote-source').value.trim() || null,
    source_url:  card.querySelector('.pf-quote-url').value.trim()   || null,
  })).filter(q => q.quote_text);

  const { error: delErr } = await sb.from('band_quotes').delete().eq('band_id', bp.id);
  if (delErr) {
    console.error('[profile] saveQuotes delete failed:', JSON.stringify(delErr));
    s.error(delErr.message);
    showToast('Delete failed — ' + delErr.message, 'error');
    return;
  }

  if (quotes.length) {
    const { data: insData, error: insErr } = await sb.from('band_quotes').insert(quotes).select();
    if (insErr) {
      console.error('[profile] saveQuotes insert failed:', JSON.stringify(insErr));
      s.error(insErr.message);
      showToast('Insert failed — ' + insErr.message, 'error');
      return;
    }
    devLog('[profile] saveQuotes insert succeeded:', insData);
  }

  s.success();
  showToast(`${quotes.length} quote${quotes.length !== 1 ? 's' : ''} saved`, 'success');
  updateQuotesUsage();
}

// ── Stage Plot ────────────────────────────────────────────────────────────────

async function handleStagePlotUpload(input) {
  const file = input.files?.[0];
  if (!file || !currentBandProfile) return;

  if (!file.type.includes('pdf') && !file.name.toLowerCase().endsWith('.pdf')) {
    showToast('Please upload a PDF file', 'error');
    return;
  }
  if (file.size > 10 * 1024 * 1024) { showToast('PDF must be under 10 MB', 'error'); return; }

  showToast('Uploading stage plot…');

  const path = `${currentBandProfile.id}/stage-plot.pdf`;

  const { error: upErr } = await sb.storage
    .from('stage-plots')
    .upload(path, file, { upsert: true, contentType: 'application/pdf' });

  if (upErr) {
    showToast('Upload failed — check that the stage-plots bucket exists in Supabase Storage', 'error');
    return;
  }

  const { data: { publicUrl } } = sb.storage.from('stage-plots').getPublicUrl(path);

  const { data: dbData, error: dbErr } = await sb.from('bands')
    .update({ stage_plot_url: publicUrl })
    .eq('email', currentUser.email)
    .select();

  if (dbErr) {
    console.error('[profile] stage plot DB save failed:', JSON.stringify(dbErr));
    showToast('Uploaded but DB save failed — ' + dbErr.message, 'error');
    return;
  }
  devLog('[profile] stage plot DB save succeeded:', dbData);

  currentBandProfile.stage_plot_url = publicUrl;
  renderStagePlotStatus();
  showToast('Stage plot uploaded', 'success');
  input.value = '';
}

function renderStagePlotStatus() {
  const el = document.getElementById('stagePlotStatus');
  if (!el || !currentBandProfile) return;

  if (currentBandProfile.stage_plot_url) {
    el.innerHTML = `
      <div class="pf-file-status">
        <div class="pf-file-info">
          <span class="pf-file-icon">↓</span>
          <div>
            <div class="pf-file-name">Stage Plot PDF</div>
            <a href="${currentBandProfile.stage_plot_url}" target="_blank" rel="noopener" class="pf-file-link">View / Download →</a>
          </div>
        </div>
        <button class="pf-file-delete" onclick="deleteStagePlot()">Remove</button>
      </div>`;
  } else {
    el.innerHTML = '';
  }
}

async function deleteStagePlot() {
  devLog('[profile] deleteStagePlot — currentUser:', currentUser?.email, 'bp.id:', currentBandProfile?.id);
  if (!currentUser || !currentBandProfile) return;

  const { data, error } = await sb.from('bands')
    .update({ stage_plot_url: null })
    .eq('email', currentUser.email)
    .select();

  if (error) {
    console.error('[profile] deleteStagePlot failed:', JSON.stringify(error));
    showToast('Could not remove — ' + error.message, 'error');
    return;
  }
  devLog('[profile] deleteStagePlot succeeded:', data);

  try {
    await sb.storage.from('stage-plots').remove([`${currentBandProfile.id}/stage-plot.pdf`]);
  } catch (_) {}

  currentBandProfile.stage_plot_url = null;
  renderStagePlotStatus();
  showToast('Stage plot removed', 'success');
}

// ── Live Video ────────────────────────────────────────────────────────────────

async function loadVideos(bandId) {
  const { data: videos } = await sb
    .from('band_videos')
    .select('*')
    .eq('band_id', bandId)
    .order('display_order');

  const inputs = document.querySelectorAll('.pf-video-input');
  inputs.forEach((input, i) => {
    const v = videos?.[i];
    input.value = v?.video_url || '';
    previewVideoThumb(input, i);
  });
}

function extractYoutubeId(url) {
  const m = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
  return m ? m[1] : null;
}

function previewVideoThumb(input, index) {
  const url   = input.value.trim();
  const thumb = document.getElementById(`videoThumb${index}`);
  if (!thumb) return;
  const ytId = extractYoutubeId(url);
  if (ytId) {
    thumb.innerHTML = `<img src="https://img.youtube.com/vi/${ytId}/mqdefault.jpg" alt="" class="pf-video-thumb-img">`;
  } else if (url.includes('vimeo.com')) {
    thumb.innerHTML = `<div class="pf-video-thumb-label">Vimeo ▶</div>`;
  } else {
    thumb.innerHTML = '';
  }
}

async function saveVideos() {
  devLog('[profile] saveVideos — currentUser:', currentUser?.email, 'bp.id:', currentBandProfile?.id);
  const bp = currentBandProfile;
  if (!currentUser || !bp) return;

  const s = saveBtnCtrl('saveVideosBtn', 'Save Videos →');
  s.saving();

  const inputs = Array.from(document.querySelectorAll('.pf-video-input'));
  const videos = inputs
    .map((input, i) => ({ band_id: bp.id, video_url: input.value.trim(), display_order: i }))
    .filter(v => v.video_url);

  const { error: delErr } = await sb.from('band_videos').delete().eq('band_id', bp.id);
  if (delErr) {
    console.error('[profile] saveVideos delete failed:', JSON.stringify(delErr));
    s.error(delErr.message);
    showToast('Delete failed — ' + delErr.message, 'error');
    return;
  }

  if (videos.length) {
    const { data: insData, error: insErr } = await sb.from('band_videos').insert(videos).select();
    if (insErr) {
      console.error('[profile] saveVideos insert failed:', JSON.stringify(insErr));
      s.error(insErr.message);
      showToast('Insert failed — ' + insErr.message, 'error');
      return;
    }
    devLog('[profile] saveVideos insert succeeded:', insData);
  }

  s.success();
  showToast(`${videos.length} video${videos.length !== 1 ? 's' : ''} saved`, 'success');
}

// ── EPK Theme & Settings ──────────────────────────────────────────────────────

function updateEpkThemeStatus() {
  const el = document.getElementById('epkCurrentTheme');
  if (!el || !currentBandProfile) return;
  const theme  = currentBandProfile.epk_theme;
  const labels = { clean: 'Clean', bold: 'Bold', vibrant: 'Vibrant', static: 'Static', torn: 'Torn', signal: 'Signal' };
  el.innerHTML = theme
    ? `Current theme: <strong>${labels[theme] || theme}</strong>`
    : 'No theme selected yet — click <strong>View Your EPK</strong> to choose one';
}

function toggleBandcampEmbed(checked) {
  document.getElementById('bandcampEmbedField').style.display = checked ? 'block' : 'none';
}

function viewEpk() {
  const bp = currentBandProfile;
  if (!bp) return;
  if (!bp.epk_theme) {
    openThemeSelector();
  } else {
    window.open(`epk.html?band=${bandSlug(bp.band_name)}`, '_blank');
  }
}

function copyEpkLink() {
  const bp = currentBandProfile;
  if (!bp) return;
  const url = `${window.location.origin}/epk.html?band=${bandSlug(bp.band_name)}`;
  if (navigator.clipboard) {
    navigator.clipboard.writeText(url)
      .then(() => showToast('EPK link copied!', 'success'))
      .catch(() => _fallbackCopyText(url));
  } else {
    _fallbackCopyText(url);
  }
}

function _fallbackCopyText(text) {
  const el = document.createElement('input');
  el.value = text;
  document.body.appendChild(el);
  el.select();
  document.execCommand('copy');
  document.body.removeChild(el);
  showToast('EPK link copied!', 'success');
}

function openThemeSelector() {
  const bp = currentBandProfile;
  if (!bp) return;
  ['tpvNameClean', 'tpvNameBold', 'tpvNameVibrant', 'tpvNameStatic', 'tpvNameTorn', 'tpvNameSignal'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = bp.band_name || 'Your Band';
  });
  // Reset button text
  document.querySelectorAll('.theme-select-btn').forEach(b => {
    b.textContent = 'Select →';
    b.disabled    = false;
  });
  document.getElementById('themeSelectOverlay').classList.add('open');
}

function closeThemeSelector() {
  document.getElementById('themeSelectOverlay').classList.remove('open');
}

async function selectTheme(theme) {
  devLog('[profile] selectTheme — theme:', theme, 'currentUser:', currentUser?.email, 'bp.id:', currentBandProfile?.id);
  const bp = currentBandProfile;
  if (!currentUser || !bp) return;

  const btn = document.querySelector(`.theme-select-btn-${theme}`);
  if (btn) { btn.textContent = 'Saving…'; btn.disabled = true; }

  // .select() forces Supabase to flush its schema cache before executing,
  // which resolves "column not found" errors on recently-added columns.
  const runUpdate = () =>
    sb.from('bands')
      .update({ epk_theme: theme })
      .eq('email', currentUser.email)
      .select();

  let { data, error } = await runUpdate();
  devLog('[profile] selectTheme attempt 1 — data:', data, 'error:', error ? JSON.stringify(error) : null);

  // If the first attempt hits a schema cache error, wait 2 s and retry once.
  if (error) {
    console.warn('[profile] selectTheme attempt 1 failed — retrying in 2 s:', error.message);
    await new Promise(r => setTimeout(r, 2000));
    ({ data, error } = await runUpdate());
    devLog('[profile] selectTheme attempt 2 — data:', data, 'error:', error ? JSON.stringify(error) : null);
  }

  if (error) {
    console.error('[profile] selectTheme failed after retry:', JSON.stringify(error));
    showToast('Could not save theme — ' + error.message, 'error');
    if (btn) { btn.textContent = 'Select →'; btn.disabled = false; }
    return;
  }

  devLog('[profile] selectTheme succeeded:', data);
  bp.epk_theme = theme;
  closeThemeSelector();
  updateEpkThemeStatus();
  window.location.href = `epk.html?band=${bandSlug(bp.band_name)}`;
}

// ── Review history ────────────────────────────────────────────────────────────

async function loadReviewHistory(bandId) {
  const { data: reviews, error } = await sb
    .from('reviews')
    .select('venue_name, overall_rating, review_text, created_at')
    .eq('band_id', bandId)
    .order('created_at', { ascending: false });

  const list = document.getElementById('reviewHistoryList');

  if (error || !reviews?.length) {
    list.innerHTML = `<div class="profile-no-reviews">No reviews yet — <a href="index.html" style="color:var(--rust)">find a venue to review</a></div>`;
    return;
  }

  list.innerHTML = reviews.map(r => {
    const stars = '★'.repeat(r.overall_rating || 0) + '☆'.repeat(5 - (r.overall_rating || 0));
    const date  = new Date(r.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    const blurb = (r.review_text || '').substring(0, 140).trim();
    return `<div class="review-history-item">
      <div class="rhi-stars">${stars}</div>
      <div class="rhi-body">
        <div class="rhi-venue">${r.venue_name || 'Unknown Venue'}</div>
        <div class="rhi-meta">${date}</div>
        ${blurb ? `<div class="rhi-text">${blurb}${r.review_text?.length > 140 ? '…' : ''}</div>` : ''}
      </div>
    </div>`;
  }).join('');
}

// ── Press Photos ──────────────────────────────────────────────────────────────

async function renderPressPhotos() {
  if (!currentBandProfile) return;
  const bp        = currentBandProfile;
  const isPremium = isBandPremium(bp);

  const { data: photos } = await sb
    .from('band_photos')
    .select('id, photo_url')
    .eq('band_id', bp.id)
    .order('created_at', { ascending: false });

  const list    = photos || [];
  const count   = list.length;
  const atLimit = !isPremium && count >= FREE_PRESS_LIMIT;

  document.getElementById('pressPhotosUsage').textContent = isPremium
    ? `${count} photo${count !== 1 ? 's' : ''}`
    : `${count} of ${FREE_PRESS_LIMIT} slots used${atLimit ? ' — upgrade for unlimited' : ''}`;

  const area = document.getElementById('pressUploadArea');
  area.style.opacity       = atLimit ? '0.45' : '1';
  area.style.pointerEvents = atLimit ? 'none'  : 'auto';

  document.getElementById('pressPhotosGrid').innerHTML = list.map(p => `
    <div class="press-photo-thumb" id="ppt-${p.id}">
      <img src="${p.photo_url}" alt="Press photo" loading="lazy">
      <button class="press-photo-delete" title="Delete photo" onclick="deletePressPhoto('${p.id}','${p.photo_url}')">✕</button>
    </div>`).join('');
}

async function handlePressPhotoUpload(input) {
  const files = Array.from(input.files || []);
  if (!files.length || !currentBandProfile) return;

  const bp        = currentBandProfile;
  const isPremium = isBandPremium(bp);

  const { count: existing } = await sb
    .from('band_photos')
    .select('id', { count: 'exact', head: true })
    .eq('band_id', bp.id);

  const used = existing || 0;

  if (!isPremium && used >= FREE_PRESS_LIMIT) {
    showToast(`Free accounts can upload up to ${FREE_PRESS_LIMIT} press photos`, 'error');
    return;
  }

  const slotsLeft = isPremium ? Infinity : FREE_PRESS_LIMIT - used;
  const toUpload  = files.slice(0, slotsLeft);

  showToast(toUpload.length < files.length
    ? `Only ${slotsLeft} slot${slotsLeft !== 1 ? 's' : ''} remaining — uploading first ${toUpload.length}`
    : `Uploading ${toUpload.length} photo${toUpload.length !== 1 ? 's' : ''}…`);

  let uploaded = 0;
  for (const file of toUpload) {
    if (file.size > 10 * 1024 * 1024) {
      showToast(`${file.name} exceeds 10 MB — skipped`, 'error');
      continue;
    }
    const ext  = file.name.split('.').pop().toLowerCase();
    const path = `${bp.id}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

    const { error: upErr } = await sb.storage
      .from('press-photos')
      .upload(path, file, { contentType: file.type });

    if (upErr) { showToast(`Failed to upload ${file.name}`, 'error'); continue; }

    const { data: { publicUrl } } = sb.storage.from('press-photos').getPublicUrl(path);
    await sb.from('band_photos').insert({ band_id: bp.id, photo_url: publicUrl });
    uploaded++;
  }

  if (input.value !== undefined) input.value = '';
  if (uploaded > 0) showToast(`${uploaded} photo${uploaded !== 1 ? 's' : ''} uploaded`, 'success');
  await renderPressPhotos();
}

async function deletePressPhoto(photoId, photoUrl) {
  if (!currentBandProfile) return;

  const { error } = await sb.from('band_photos').delete().eq('id', photoId);
  if (error) { showToast('Delete failed', 'error'); return; }

  try {
    const match = photoUrl.match(/\/press-photos\/(.+)$/);
    if (match) await sb.storage.from('press-photos').remove([decodeURIComponent(match[1])]);
  } catch (_) {}

  document.getElementById(`ppt-${photoId}`)?.remove();
  await renderPressPhotos();
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function bandSlug(name) {
  return (name || '').toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
}

function escProfileStr(s) {
  return (s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ═══════════════════════════════════════════════════════════════
// THREE-TAB PROFILE SYSTEM
// ═══════════════════════════════════════════════════════════════

let _activeProfileTab = 'epk';
let _commTabLoaded    = false;
let _tourTabLoaded    = false;

function switchProfileTab(tab) {
  _activeProfileTab = tab;
  document.querySelectorAll('.ptab').forEach(b =>
    b.classList.toggle('ptab--active', b.dataset.tab === tab)
  );
  document.querySelectorAll('.profile-tab-panel').forEach(p => p.style.display = 'none');
  const panel = document.getElementById('tab-' + tab);
  if (panel) panel.style.display = 'block';

  const bp = currentBandProfile;
  if (!bp) return;

  if (tab === 'community' && !_commTabLoaded) {
    _commTabLoaded = true;
    loadCommunityTab(bp.id);
  }
  if (tab === 'tour' && !_tourTabLoaded) {
    _tourTabLoaded = true;
    loadTourManager(bp.id);
  }
}

// Update the red badge on the Community tab button
async function updateCommBadge(bandId) {
  if (!bandId) return;
  const { count } = await sb
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('band_id', bandId)
    .eq('read', false);
  const badge = document.getElementById('commTabBadge');
  if (!badge) return;
  if (count > 0) {
    badge.textContent = count > 9 ? '9+' : count;
    badge.style.display = 'inline-flex';
  } else {
    badge.style.display = 'none';
  }
}

// ── Community Tab ─────────────────────────────────────────────

async function loadCommunityTab(bandId) {
  await Promise.all([
    loadMessageThreads(bandId),
    loadMyPostingsWithResponses(bandId),
    loadCommunityActivity(bandId),
    loadNotifications(bandId),
  ]);
  updateCommBadge(bandId);
}

async function loadMessageThreads(bandId) {
  const el = document.getElementById('messageThreadsList');
  if (!el) return;

  const { data, error } = await sb
    .from('band_messages')
    .select('id, sender_band_id, receiver_band_id, message_text, created_at, is_read')
    .or(`sender_band_id.eq.${bandId},receiver_band_id.eq.${bandId}`)
    .order('created_at', { ascending: false })
    .limit(200);

  if (error || !data?.length) {
    el.innerHTML = '<div class="comm-chat-empty">No messages yet. Message a band from the Community page to get started.</div>';
    return;
  }

  // Group by conversation partner
  const threads = {};
  data.forEach(msg => {
    const otherId = String(msg.sender_band_id) === String(bandId) ? msg.receiver_band_id : msg.sender_band_id;
    if (!threads[otherId]) threads[otherId] = { otherId, messages: [], unread: 0 };
    threads[otherId].messages.push(msg);
    if (String(msg.receiver_band_id) === String(bandId) && !msg.is_read) threads[otherId].unread++;
  });

  const otherIds = Object.keys(threads);
  const { data: bands } = await sb.from('bands').select('id, band_name, profile_photo_url').in('id', otherIds);
  const bandMap = {};
  (bands || []).forEach(b => { bandMap[b.id] = b; });

  const html = otherIds
    .sort((a, b) => new Date(threads[b].messages[0].created_at) - new Date(threads[a].messages[0].created_at))
    .map(otherId => {
      const t    = threads[otherId];
      const band = bandMap[otherId] || {};
      const last = t.messages[0];
      const prev = escapeHtml((last.message_text || '').substring(0, 60)) + (last.message_text?.length > 60 ? '…' : '');
      const time = new Date(last.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      const init = (band.band_name || '?')[0].toUpperCase();
      const av   = band.profile_photo_url
        ? `<img src="${band.profile_photo_url}" class="mt-avatar-img" alt="">`
        : `<div class="mt-avatar-init">${init}</div>`;
      return `<div class="msg-thread" onclick="openInlineChat(${otherId},'${escapeHtml(band.band_name || 'Unknown')}','${escapeHtml(band.profile_photo_url || '')}')">
        <div class="mt-avatar">${av}</div>
        <div class="mt-body">
          <div class="mt-name">${escapeHtml(band.band_name || 'Unknown Band')}</div>
          <div class="mt-preview">${prev}</div>
        </div>
        <div class="mt-right">
          <div class="mt-time">${time}</div>
          ${t.unread > 0 ? `<div class="mt-unread">${t.unread}</div>` : ''}
        </div>
      </div>`;
    }).join('');

  el.innerHTML = html || '<div class="comm-chat-empty">No messages yet.</div>';
}

// ── Inline Chat ───────────────────────────────────────────────

let _chatOtherBandId   = null;
let _chatRealtimeSub   = null;
let _bandSearchTimer   = null;
let _bandSearchResults = [];

// ── Band search (new conversation) ────────────────────────────
function searchBandsInput(val) {
  clearTimeout(_bandSearchTimer);
  const results = document.getElementById('bandSearchResults');
  if (!results) return;
  if (!val.trim()) { results.innerHTML = ''; results.style.display = 'none'; return; }
  _bandSearchTimer = setTimeout(async () => {
    const { data } = await sb
      .from('bands')
      .select('id, band_name, genre, home_city, profile_photo_url')
      .ilike('band_name', `%${val.trim()}%`)
      .neq('id', currentBandProfile?.id || 0)
      .limit(8);
    _bandSearchResults = data || [];
    if (!_bandSearchResults.length) {
      results.innerHTML = '<div class="band-search-empty">No bands found</div>';
      results.style.display = 'block';
      return;
    }
    results.innerHTML = _bandSearchResults.map((b, i) => {
      const init = (b.band_name || '?')[0].toUpperCase();
      const av   = b.profile_photo_url
        ? `<img src="${escapeHtml(b.profile_photo_url)}" class="bsr-avatar bsr-avatar--img" alt="">`
        : `<div class="bsr-avatar bsr-avatar--init">${init}</div>`;
      const meta = [b.genre, b.home_city].filter(Boolean).join(' · ');
      return `<div class="band-search-result" onmousedown="openInlineChatFromSearch(${i})">
        ${av}
        <div class="bsr-info">
          <div class="bsr-name">${escapeHtml(b.band_name)}</div>
          ${meta ? `<div class="bsr-meta">${escapeHtml(meta)}</div>` : ''}
        </div>
        <svg viewBox="0 0 14 14" width="11" height="11" fill="none" class="bsr-arrow"><line x1="2" y1="7" x2="11" y2="7" stroke="currentColor" stroke-width="1.2"/><polygon points="8,4 13,7 8,10" fill="currentColor"/></svg>
      </div>`;
    }).join('');
    results.style.display = 'block';
  }, 280);
}

function openInlineChatFromSearch(idx) {
  const b = _bandSearchResults[idx];
  if (!b) return;
  const input = document.getElementById('bandSearchInput');
  const results = document.getElementById('bandSearchResults');
  if (input) input.value = '';
  if (results) { results.innerHTML = ''; results.style.display = 'none'; }
  openInlineChat(b.id, b.band_name, b.profile_photo_url || '');
}

function clearBandSearch() {
  const results = document.getElementById('bandSearchResults');
  if (results) { results.innerHTML = ''; results.style.display = 'none'; }
}

// ── Inline Chat ───────────────────────────────────────────────

function openInlineChat(bandId, bandName, photoUrl) {
  _chatOtherBandId = bandId;
  const panel = document.getElementById('inlineChatPanel');
  const title  = document.getElementById('chatPanelTitle');
  if (!panel || !title) return;
  title.textContent = bandName;

  // Set header avatar
  const avatarEl = document.getElementById('chatPanelAvatar');
  if (avatarEl) {
    const init = (bandName || '?')[0].toUpperCase();
    avatarEl.innerHTML = photoUrl
      ? `<img src="${escapeHtml(photoUrl)}" class="cp-avatar-img" alt="">`
      : `<div class="cp-avatar-init">${init}</div>`;
  }

  // Show backdrop + panel
  document.getElementById('chatPanelBackdrop')?.classList.add('open');
  panel.classList.add('open');
  loadInlineChatMessages();

  // Mark messages as read
  if (currentBandProfile) {
    sb.from('band_messages')
      .update({ is_read: true })
      .eq('receiver_band_id', currentBandProfile.id)
      .eq('sender_band_id', bandId)
      .eq('is_read', false)
      .then(() => {});
  }

  // Real-time subscription
  if (_chatRealtimeSub) sb.removeChannel(_chatRealtimeSub);
  _chatRealtimeSub = sb.channel(`profile-chat-${bandId}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'band_messages' }, payload => {
      const msg   = payload.new;
      const myId  = String(currentBandProfile?.id);
      const thId  = String(_chatOtherBandId);
      if ((String(msg.sender_band_id) === myId && String(msg.receiver_band_id) === thId) ||
          (String(msg.sender_band_id) === thId && String(msg.receiver_band_id) === myId)) {
        loadInlineChatMessages();
      }
    })
    .subscribe();
}

function closeInlineChat() {
  const panel = document.getElementById('inlineChatPanel');
  if (panel) panel.classList.remove('open');
  document.getElementById('chatPanelBackdrop')?.classList.remove('open');
  if (_chatRealtimeSub) { sb.removeChannel(_chatRealtimeSub); _chatRealtimeSub = null; }
  _chatOtherBandId = null;
}

async function loadInlineChatMessages() {
  const myId   = currentBandProfile?.id;
  const theirId = _chatOtherBandId;
  const box    = document.getElementById('inlineChatMessages');
  if (!myId || !theirId || !box) return;

  const { data, error } = await sb
    .from('band_messages')
    .select('*')
    .or(`and(sender_band_id.eq.${myId},receiver_band_id.eq.${theirId}),and(sender_band_id.eq.${theirId},receiver_band_id.eq.${myId})`)
    .order('created_at', { ascending: true })
    .limit(100);

  if (error || !data?.length) {
    box.innerHTML = '<div class="comm-chat-empty">No messages yet — say hello!</div>';
    return;
  }

  const now       = new Date();
  const todayStr  = now.toDateString();
  const yestDate  = new Date(now); yestDate.setDate(yestDate.getDate() - 1);
  const yestStr   = yestDate.toDateString();
  const dayLabel  = d => {
    const s = new Date(d).toDateString();
    if (s === todayStr)  return 'Today';
    if (s === yestStr)   return 'Yesterday';
    return new Date(d).toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
  };

  let lastDay = null;
  const html = data.map(msg => {
    const mine    = String(msg.sender_band_id) === String(myId);
    const time    = new Date(msg.created_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    const dayStr  = new Date(msg.created_at).toDateString();
    let sep = '';
    if (dayStr !== lastDay) {
      sep = `<div class="chat-day-sep"><span>${dayLabel(msg.created_at)}</span></div>`;
      lastDay = dayStr;
    }

    let bubble;
    if (msg.message_type === 'itinerary') {
      const meta = msg.metadata || {};
      if (meta.itinerary_html) _sharedItineraries[msg.id] = meta;
      bubble = `<div class="chat-bubble chat-bubble--itinerary ${mine ? 'chat-bubble--mine' : 'chat-bubble--theirs'}">
        <div class="chat-itin-icon">◉</div>
        <div class="chat-itin-body">
          <div class="chat-itin-label">Shared Itinerary</div>
          <div class="chat-itin-name">${escapeHtml(meta.tour_name || 'Tour Itinerary')}</div>
          ${meta.itinerary_html ? `<button class="chat-itin-open" onclick="openSharedItinerary('${msg.id}')">View & Print →</button>` : ''}
        </div>
        <div class="chat-bubble-time">${time}</div>
      </div>`;
    } else {
      bubble = `<div class="chat-bubble ${mine ? 'chat-bubble--mine' : 'chat-bubble--theirs'}">
        <div class="chat-bubble-text">${escapeHtml(msg.message_text)}</div>
        <div class="chat-bubble-time">${time}</div>
      </div>`;
    }
    return sep + bubble;
  }).join('');

  box.innerHTML = html;
  box.scrollTop = box.scrollHeight;
}

async function sendInlineChatMessage() {
  const input   = document.getElementById('inlineChatInput');
  const content = input?.value.trim();
  if (!content || !_chatOtherBandId || !currentBandProfile) return;
  input.value = '';

  const { error } = await sb.from('band_messages').insert({
    sender_band_id:   currentBandProfile.id,
    receiver_band_id: parseInt(_chatOtherBandId),
    message_text:     content,
    is_read:          false,
  });
  if (error) { showToast('Message failed — ' + error.message, 'error'); input.value = content; return; }

  // Notify recipient
  await sb.from('notifications').insert({
    band_id: parseInt(_chatOtherBandId),
    type:    'new_message',
    payload: { from_band: currentBandProfile.band_name, preview: content.substring(0, 60) },
    read:    false,
  });

  await loadInlineChatMessages();
}

// ── Notifications ─────────────────────────────────────────────

async function loadNotifications(bandId) {
  const el = document.getElementById('notificationsList');
  if (!el) return;

  const { data, error } = await sb
    .from('notifications')
    .select('*')
    .eq('band_id', bandId)
    .order('created_at', { ascending: false })
    .limit(30);

  if (error || !data?.length) {
    el.innerHTML = '<div class="comm-chat-empty">No notifications yet.</div>';
    return;
  }

  const labels = {
    interest_received:   'expressed interest in your posting',
    message:             'sent you a message',
    new_posting_nearby:  'posted a new opportunity near you',
    interest_accepted:   'accepted your interest',
    interest_declined:   'declined your interest',
    tour_response:       'responded to your tour inquiry',
  };

  el.innerHTML = data.map(n => {
    const p    = n.payload || {};
    const from = escapeHtml(p.from_band || 'A band');
    const lbl  = labels[n.type] || n.type;
    const time = new Date(n.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const cls  = n.read ? '' : 'notif-item--unread';
    const extra = p.posting_title ? `: <em>${escapeHtml(p.posting_title)}</em>` : '';
    return `<div class="notif-item ${cls}">
      <div class="notif-dot"></div>
      <div class="notif-body">
        <div class="notif-text"><strong>${from}</strong> ${lbl}${extra}</div>
        <div class="notif-time">${time}</div>
      </div>
    </div>`;
  }).join('');
}

async function markAllNotifsRead() {
  if (!currentBandProfile) return;
  await sb.from('notifications').update({ read: true })
    .eq('band_id', currentBandProfile.id)
    .eq('read', false);
  loadNotifications(currentBandProfile.id);
  updateCommBadge(currentBandProfile.id);
}

// ── My Postings with expandable responses ─────────────────────

async function loadMyPostingsWithResponses(bandId) {
  const section = document.getElementById('myPostingsSection');
  const list    = document.getElementById('myPostingsList');
  if (!section || !list) return;

  const { data, error } = await sb
    .from('tour_postings')
    .select('id, title, type, is_active, is_paused, created_at, interest_count, posting_dates(city)')
    .eq('band_id', bandId)
    .order('created_at', { ascending: false })
    .limit(10);

  if (error || !data?.length) { section.style.display = 'none'; return; }
  section.style.display = 'block';

  const typeLabels = { tour_support: 'Tour Support', local_opener: 'Local Opener', co_headlining: 'Co-Headlining' };

  list.innerHTML = data.map(p => {
    const cities    = (p.posting_dates || []).map(d => d.city.split(',')[0]).slice(0, 3).join(', ');
    const label     = typeLabels[p.type] || p.type;
    const status    = !p.is_active ? 'Closed' : p.is_paused ? 'Paused' : 'Active';
    const statusCls = !p.is_active ? 'prof-posting-status--closed' : p.is_paused ? 'prof-posting-status--paused' : 'prof-posting-status--active';
    const interests = p.interest_count || 0;
    return `<div class="prof-posting-expanded" id="posting-block-${p.id}">
      <div class="prof-posting-row" onclick="togglePostingResponses('${p.id}')">
        <div class="prof-posting-info">
          <div class="prof-posting-title">${escapeHtml(p.title)}</div>
          <div class="prof-posting-meta">${label}${cities ? ' · ' + escapeHtml(cities) : ''} · <strong>${interests} interested</strong></div>
        </div>
        <div class="prof-posting-right" style="display:flex;align-items:center;gap:8px">
          <span class="prof-posting-status ${statusCls}">${status}</span>
          <span class="prof-posting-expand-icon" id="expand-icon-${p.id}">▾</span>
        </div>
      </div>
      <div class="prof-posting-responses" id="responses-${p.id}" style="display:none"></div>
    </div>`;
  }).join('');
}

async function togglePostingResponses(postingId) {
  const el   = document.getElementById(`responses-${postingId}`);
  const icon = document.getElementById(`expand-icon-${postingId}`);
  if (!el) return;

  if (el.style.display !== 'none') {
    el.style.display = 'none';
    if (icon) icon.textContent = '▾';
    return;
  }

  el.style.display = 'block';
  if (icon) icon.textContent = '▴';
  el.innerHTML = '<div class="prof-loading">Loading responses…</div>';

  const { data, error } = await sb
    .from('posting_interests')
    .select('id, status, created_at, band_id, bands(id, band_name, genre, home_city, profile_photo_url, epk_theme), posting_dates(city, date)')
    .eq('posting_id', postingId)
    .order('created_at', { ascending: false });

  if (error || !data?.length) {
    el.innerHTML = '<div class="comm-chat-empty">No responses yet.</div>';
    return;
  }

  el.innerHTML = data.map(i => {
    const band = i.bands || {};
    const pd   = i.posting_dates || {};
    const init = (band.band_name || '?')[0].toUpperCase();
    const av   = band.profile_photo_url
      ? `<img src="${band.profile_photo_url}" class="resp-avatar-img" alt="">`
      : `<div class="resp-avatar-init">${init}</div>`;
    const date = pd.date ? new Date(pd.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';
    const city = pd.city ? pd.city.split(',')[0] : '';
    const slug = band.epk_theme && band.band_name ? bandSlug(band.band_name) : null;
    const nameHtml = slug
      ? `<a href="epk.html?band=${slug}" class="resp-name resp-name-link" target="_blank">${escapeHtml(band.band_name)}</a>`
      : `<div class="resp-name">${escapeHtml(band.band_name || 'Unknown Band')}</div>`;
    let actions = i.status === 'pending'
      ? `<button class="resp-btn resp-btn--accept" onclick="handleInterestResponse('${i.id}',${band.id},'accepted','${postingId}')">Accept</button>
         <button class="resp-btn resp-btn--decline" onclick="handleInterestResponse('${i.id}',${band.id},'declined','${postingId}')">Decline</button>`
      : `<span class="resp-status resp-status--${i.status}">${i.status}</span>`;
    actions += `<button class="resp-btn resp-btn--msg" onclick="switchProfileTab('community');openInlineChat(${band.id},'${escapeHtml(band.band_name || '')}','${escapeHtml(band.profile_photo_url || '')}')">Message</button>`;
    return `<div class="resp-row">
      <div class="resp-avatar">${av}</div>
      <div class="resp-body">
        ${nameHtml}
        <div class="resp-meta">${escapeHtml(band.genre || '')}${city ? ' · ' + escapeHtml(city) : ''}${date ? ' · ' + date : ''}</div>
      </div>
      <div class="resp-actions">${actions}</div>
    </div>`;
  }).join('');
}

async function handleInterestResponse(interestId, bandId, status, postingId) {
  const { error } = await sb.from('posting_interests').update({ status }).eq('id', interestId);
  if (error) { showToast('Failed to update — ' + error.message, 'error'); return; }

  await sb.from('notifications').insert({
    band_id: bandId,
    type:    status === 'accepted' ? 'interest_accepted' : 'interest_declined',
    payload: { from_band: currentBandProfile?.band_name },
    read:    false,
  });

  // If accepted and the posting is linked to a tour, write the band into those stops
  if (status === 'accepted') {
    const { data: posting } = await sb
      .from('tour_postings')
      .select('linked_tour_id, linked_stop_ids, type')
      .eq('id', postingId)
      .single();

    if (posting?.linked_tour_id) {
      const roleMap = { tour_support: 'opener', local_opener: 'support', co_headlining: 'co-headliner' };
      const role    = roleMap[posting.type] || 'support';

      if (posting.type === 'co_headlining') {
        await _createCoHeadlinerTour(posting.linked_tour_id, bandId);
      } else {
        const update = { supporting_band_id: bandId, supporting_role: role };
        if (posting.linked_stop_ids?.length) {
          await sb.from('tour_stops').update(update).in('id', posting.linked_stop_ids);
        } else {
          await sb.from('tour_stops').update(update).eq('tour_id', posting.linked_tour_id);
        }
      }
    }
  }

  showToast(status === 'accepted' ? 'Accepted!' : 'Declined', status === 'accepted' ? 'success' : '');
  const el = document.getElementById(`responses-${postingId}`);
  if (el) el.style.display = 'none';
  const icon = document.getElementById(`expand-icon-${postingId}`);
  if (icon) icon.textContent = '▾';
  if (currentBandProfile) loadMyPostingsWithResponses(currentBandProfile.id);
}

// ── Tour Manager ──────────────────────────────────────────────

let _tours = [];
let _sharedItineraries = {}; // msgId → { tour_name, itinerary_html }

async function loadTourManager(bandId) {
  const list = document.getElementById('tourManagerList');
  if (!list) return;
  list.innerHTML = '<div class="prof-loading">Loading tours…</div>';

  const { data: tours, error } = await sb
    .from('saved_tours')
    .select('*, tour_stops(*, supporting_band:bands!supporting_band_id(id, band_name, profile_photo_url)), co_headliner:bands!co_headliner_band_id(id, band_name, profile_photo_url)')
    .eq('band_id', bandId)
    .order('created_at', { ascending: false });

  if (error) { list.innerHTML = '<div class="prof-loading">Failed to load tours.</div>'; return; }

  _tours = tours || [];

  const localTour = _getLocalStorageTour();
  const migrateHtml = (localTour?.legs?.length)
    ? `<div class="tour-migrate-banner">
        <div class="tour-migrate-text">You have an unsaved route from the Tour Planner — save it here?</div>
        <button class="resp-btn resp-btn--accept" onclick="migrateLocalTour()">Save Tour →</button>
       </div>` : '';

  if (!_tours.length) {
    list.innerHTML = migrateHtml + `<div class="tour-empty">
      <div class="tour-empty-text">No saved tours yet.</div>
      <button class="profile-action-btn profile-action-btn-primary" onclick="openCreateTourModal()">+ Create Your First Tour</button>
      <a href="tour.html" class="profile-action-btn profile-action-btn-secondary" style="text-decoration:none;display:inline-block;margin-top:4px">Build a Route →</a>
    </div>`;
    return;
  }

  list.innerHTML = migrateHtml + _tours.map(t => renderTourCard(t)).join('');
}

function _getLocalStorageTour() {
  try { return JSON.parse(localStorage.getItem('bandmate_tour') || 'null'); } catch { return null; }
}

function renderTourCard(tour) {
  const stops  = (tour.tour_stops || []).slice().sort((a, b) => a.position - b.position);
  const total  = stops.length;
  const booked = stops.filter(s => s.status === 'yes').length;
  const pct    = total ? Math.round((booked / total) * 100) : 0;
  const fullyBooked = total > 0 && pct === 100;
  const coH    = tour.co_headliner; // joined band object or null

  const stopsHtml = stops.length
    ? stops.map((s, i) => renderTourStop(s, i + 1)).join('')
    : `<div class="comm-chat-empty" style="padding:12px 16px">No stops yet — <a href="tour.html" style="color:var(--teal)">build a route in Tour Planner</a>, then save it here.</div>`;

  const coHeaderHtml = coH ? `
    <div class="tour-co-header">
      <div class="tour-co-avatars">
        ${coH.profile_photo_url
          ? `<img src="${escapeHtml(coH.profile_photo_url)}" class="tour-co-avatar" alt="">`
          : `<div class="tour-co-avatar tour-co-avatar--init">${escapeHtml((coH.band_name || 'B').charAt(0).toUpperCase())}</div>`}
      </div>
      <div class="tour-co-info">
        <div class="tour-co-label">Co-Headlining Tour with</div>
        <div class="tour-co-name">${escapeHtml(coH.band_name)}</div>
      </div>
      ${tour.itinerary_html
        ? `<button class="tour-co-send-btn" onclick="sendSharedItinerary('${tour.id}')">Send Itinerary ↗</button>`
        : ''}
    </div>` : '';

  const bookedBanner = fullyBooked ? `
    <div class="tour-booked-banner">
      <svg viewBox="0 0 26 26" width="22" height="22" fill="none" class="tour-booked-globe">
        <circle cx="13" cy="13" r="11" stroke="#f2efe6" stroke-width="1"/>
        <ellipse cx="13" cy="13" rx="11" ry="4" stroke="#f2efe6" stroke-width="0.8" opacity="0.6"/>
        <ellipse cx="13" cy="9" rx="9.5" ry="2.8" stroke="#f2efe6" stroke-width="0.5" opacity="0.3"/>
        <ellipse cx="13" cy="17" rx="9.5" ry="2.8" stroke="#f2efe6" stroke-width="0.5" opacity="0.3"/>
        <ellipse cx="13" cy="13" rx="4.5" ry="11" stroke="#f2efe6" stroke-width="0.8" opacity="0.6"/>
        <ellipse cx="13" cy="13" rx="4.5" ry="11" stroke="#f2efe6" stroke-width="0.5" opacity="0.3" transform="rotate(60 13 13)"/>
        <ellipse cx="13" cy="13" rx="4.5" ry="11" stroke="#f2efe6" stroke-width="0.5" opacity="0.3" transform="rotate(-60 13 13)"/>
      </svg>
      <span class="tour-booked-text">Tour Fully Booked!</span>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <button class="tour-download-btn" onclick="downloadTourItinerary('${tour.id}')">↓ Download Itinerary</button>
        <button class="tour-download-btn tour-download-btn--route" onclick="startCreateRoute('${tour.id}')">+ Create Curated Route</button>
      </div>
    </div>` : '';

  return `<div class="tour-card${fullyBooked ? ' tour-card--booked' : ''}" id="tour-card-${tour.id}">
    ${coHeaderHtml}
    <div class="tour-card-header">
      <div class="tour-card-name">${escapeHtml(tour.name)}</div>
      <div class="tour-card-actions">
        <button class="tour-action-btn" onclick="renameTour('${tour.id}')" title="Rename">✎</button>
        <button class="tour-action-btn tour-action-btn--delete" onclick="deleteTour('${tour.id}')" title="Delete tour">✕</button>
      </div>
    </div>
    ${total > 0 ? `<div class="tour-progress">
      <div class="tour-progress-bar-track"><div class="tour-progress-bar-fill${fullyBooked ? ' tour-progress-bar-fill--complete' : ''}" style="width:${pct}%"></div></div>
      <div class="tour-progress-label">${booked} / ${total} booked — ${pct}%</div>
    </div>` : ''}
    ${bookedBanner}
    <div class="tour-stops-list">${stopsHtml}</div>
    <div class="tour-notes-section">
      <div class="tour-notes-label">Tour Notes</div>
      <textarea class="tour-notes-area" id="tour-notes-${tour.id}" placeholder="General notes, contacts, logistics…" onblur="saveTourNotes('${tour.id}')">${escapeHtml(tour.notes || '')}</textarea>
    </div>
    <div class="tour-post-section">
      <div class="tour-post-label">Find other bands for this tour</div>
      <div class="tour-post-hint">Post a listing to the community board — accepted bands will appear beside their venue in your Tour Manager</div>
      <div class="tour-post-btns">
        <button class="tour-post-btn" onclick="postTourToCommForType('${tour.id}','tour_support')">
          <svg viewBox="0 0 14 14" width="12" height="12" fill="none"><polygon points="7,2 13,12 1,12" stroke="currentColor" stroke-width="1.2" fill="none"/></svg>
          Find Opener
        </button>
        <button class="tour-post-btn" onclick="postTourToCommForType('${tour.id}','co_headlining')">
          <svg viewBox="0 0 18 10" width="16" height="10" fill="none"><circle cx="5" cy="5" r="4" stroke="currentColor" stroke-width="1.2"/><circle cx="13" cy="5" r="4" stroke="currentColor" stroke-width="1.2"/></svg>
          Find Co-Headliner
        </button>
      </div>
    </div>
    <div class="tour-card-footer">
      <a href="tour.html" class="tour-footer-link">Add stops →</a>
      ${fullyBooked ? `<button class="tour-footer-link" onclick="downloadTourItinerary('${tour.id}')">↓ Itinerary</button>` : ''}
    </div>
  </div>`;
}

function renderTourStop(stop, num) {
  const statusBtns = ['yes', 'pending', 'no'].map(s => {
    const labels = { yes: '✓ Yes', pending: '?', no: '✕ No' };
    const active = stop.status === s ? 'stop-active' : '';
    return `<button class="stop-status-btn stop-status-btn--${s} ${active}" onclick="updateStopStatus('${stop.id}','${s}','${stop.tour_id}')">${labels[s]}</button>`;
  }).join('');
  const loc = [stop.city, stop.state].filter(Boolean).join(', ');
  const hasNote = !!(stop.notes && stop.notes.trim());
  const sb_band = stop.supporting_band;
  const roleLabel = { opener: 'Opening', support: 'Support Act', 'co-headliner': 'Co-Headlining' }[stop.supporting_role] || '';
  const supportHtml = sb_band ? `<div class="stop-support-band">
    ${sb_band.profile_photo_url
      ? `<img src="${escapeHtml(sb_band.profile_photo_url)}" class="stop-support-avatar" alt="">`
      : `<div class="stop-support-avatar stop-support-avatar--init">${escapeHtml((sb_band.band_name || 'B').charAt(0).toUpperCase())}</div>`}
    <div class="stop-support-info">
      <div class="stop-support-name">${escapeHtml(sb_band.band_name)}</div>
      ${roleLabel ? `<div class="stop-support-role">${roleLabel}</div>` : ''}
    </div>
  </div>` : '';
  return `<div class="tour-stop-row" id="stop-row-${stop.id}">
    <div class="stop-num">${num}</div>
    <div class="stop-body">
      <div class="stop-venue">${escapeHtml(stop.venue_name)}</div>
      ${loc ? `<div class="stop-city">${escapeHtml(loc)}</div>` : ''}
      ${supportHtml}
      <div class="stop-action-links">
        ${stop.place_id ? `<a href="map.html?place=${stop.place_id}" target="_blank" class="stop-action-link">View / Review ↗</a>` : ''}
        ${stop.place_id ? `<button class="stop-action-link stop-action-link--contact" data-place-id="${stop.place_id}" data-name="${escapeHtml(stop.venue_name || '')}" data-loc="${escapeHtml(loc)}" onclick="openContactModal(this.dataset.placeId,this.dataset.name,this.dataset.loc)">Contact →</button>` : ''}
      </div>
      <button class="stop-note-toggle" onclick="toggleStopNote('${stop.id}')">${hasNote ? '↳ note' : '+ note'}</button>
      <div class="stop-note-wrap${hasNote ? ' stop-note-wrap--open' : ''}" id="stop-note-wrap-${stop.id}">
        <textarea class="stop-note-area" id="stop-note-${stop.id}" placeholder="Contact, address, load-in time…" onblur="saveStopNotes('${stop.id}','${stop.tour_id}')">${escapeHtml(stop.notes || '')}</textarea>
      </div>
    </div>
    <div class="stop-right">
      <div class="stop-status-group">${statusBtns}</div>
      <button class="stop-delete" onclick="deleteStop('${stop.id}','${stop.tour_id}')" title="Remove stop">✕</button>
    </div>
  </div>`;
}

async function updateStopStatus(stopId, status, tourId) {
  const { error } = await sb.from('tour_stops').update({ status }).eq('id', stopId);
  if (error) { showToast('Failed to update — ' + error.message, 'error'); return; }
  if (status === 'no') showToast('Marked as No. Go to Tour Planner to find a replacement venue.');
  await _reloadTourCard(tourId);
}

async function deleteStop(stopId, tourId) {
  if (!confirm('Remove this stop?')) return;
  const { error } = await sb.from('tour_stops').delete().eq('id', stopId);
  if (error) { showToast('Failed to remove — ' + error.message, 'error'); return; }
  showToast('Stop removed.');
  await _reloadTourCard(tourId);
}

async function _reloadTourCard(tourId) {
  const prevTour   = _tours.find(t => String(t.id) === String(tourId));
  const prevBooked = (prevTour?.tour_stops || []).filter(s => s.status === 'yes').length;

  const { data: tour } = await sb.from('saved_tours').select('*, tour_stops(*, supporting_band:bands!supporting_band_id(id, band_name, profile_photo_url)), co_headliner:bands!co_headliner_band_id(id, band_name, profile_photo_url)').eq('id', tourId).single();
  if (!tour) return;

  // Preserve any unsaved tour notes currently in the DOM
  const noteEl = document.getElementById(`tour-notes-${tourId}`);
  if (noteEl) tour.notes = noteEl.value;

  const card = document.getElementById(`tour-card-${tourId}`);
  if (card) card.outerHTML = renderTourCard(tour);
  _tours = _tours.map(t => String(t.id) === String(tourId) ? tour : t);

  // Fire celebration if this action just completed the tour
  const stops  = tour.tour_stops || [];
  const total  = stops.length;
  const booked = stops.filter(s => s.status === 'yes').length;
  if (total > 0 && booked === total && prevBooked < total) {
    _launchBookedCelebration(tour.name);
  }
}

function openCreateTourModal() {
  const modal = document.getElementById('createTourModal');
  if (modal) { modal.classList.add('open'); document.getElementById('newTourName').focus(); }
}

function closeCreateTourModal() {
  const modal = document.getElementById('createTourModal');
  if (modal) modal.classList.remove('open');
  const inp = document.getElementById('newTourName');
  if (inp) inp.value = '';
}

async function createTour() {
  const name = document.getElementById('newTourName')?.value.trim();
  if (!name) { showToast('Please enter a tour name', 'error'); return; }
  if (!currentBandProfile) return;

  const { data, error } = await sb.from('saved_tours').insert({
    band_id: currentBandProfile.id,
    name,
  }).select('*, tour_stops(*)').single();

  if (error) { showToast('Failed to create — ' + error.message, 'error'); return; }

  closeCreateTourModal();
  _tours.unshift(data);
  const list   = document.getElementById('tourManagerList');
  const empty  = list?.querySelector('.tour-empty');
  if (empty) empty.remove();
  list?.insertAdjacentHTML('afterbegin', renderTourCard(data));
  showToast('Tour created!', 'success');
}

async function deleteTour(tourId) {
  if (!confirm('Delete this tour? This cannot be undone.')) return;
  const { error } = await sb.from('saved_tours').delete().eq('id', tourId);
  if (error) { showToast('Failed to delete — ' + error.message, 'error'); return; }
  document.getElementById(`tour-card-${tourId}`)?.remove();
  _tours = _tours.filter(t => t.id !== tourId);
  if (!_tours.length) {
    const list = document.getElementById('tourManagerList');
    if (list) list.innerHTML = `<div class="tour-empty"><div class="tour-empty-text">No saved tours yet.</div><button class="profile-action-btn profile-action-btn-primary" onclick="openCreateTourModal()">+ Create Your First Tour</button></div>`;
  }
  showToast('Tour deleted.', 'success');
}

async function renameTour(tourId) {
  const tour    = _tours.find(t => t.id === tourId);
  const newName = prompt('Rename tour:', tour?.name || '');
  if (!newName?.trim() || newName.trim() === tour?.name) return;
  const { error } = await sb.from('saved_tours').update({ name: newName.trim() }).eq('id', tourId);
  if (error) { showToast('Failed to rename — ' + error.message, 'error'); return; }
  const el = document.querySelector(`#tour-card-${tourId} .tour-card-name`);
  if (el) el.textContent = newName.trim();
  _tours = _tours.map(t => t.id === tourId ? { ...t, name: newName.trim() } : t);
  showToast('Renamed!', 'success');
}

async function toggleTourPublic(tourId, makePublic) {
  const { error } = await sb.from('saved_tours').update({ is_public: makePublic }).eq('id', tourId);
  if (error) { showToast('Failed — ' + error.message, 'error'); return; }
  showToast(makePublic ? 'Tour is now shareable via link.' : 'Tour is now private.', 'success');
  await _reloadTourCard(tourId);
}

function shareTourLink(tourId, shareToken) {
  const url = `${window.location.origin.replace(/\/[^/]*$/, '')}/tour.html?share=${shareToken}`;
  if (navigator.clipboard) {
    navigator.clipboard.writeText(url)
      .then(() => showToast('Share link copied!', 'success'))
      .catch(() => _fallbackCopyText(url));
  } else {
    _fallbackCopyText(url);
  }
}

async function migrateLocalTour() {
  const local = _getLocalStorageTour();
  if (!local?.legs?.length || !currentBandProfile) return;

  const name = `Tour — ${new Date().toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}`;
  const { data: tour, error } = await sb.from('saved_tours')
    .insert({ band_id: currentBandProfile.id, name })
    .select().single();
  if (error) { showToast('Migration failed — ' + error.message, 'error'); return; }

  const stops = (local.legs || []).reduce((acc, leg, idx) => {
    const vname = leg.venue_name || leg.destination || leg.end_address || null;
    if (vname) acc.push({ tour_id: tour.id, venue_name: vname, city: leg.city || '', state: leg.state || '', place_id: leg.place_id || null, position: idx, status: 'pending' });
    return acc;
  }, []);

  if (stops.length) await sb.from('tour_stops').insert(stops);

  document.querySelector('.tour-migrate-banner')?.remove();
  showToast('Tour saved to your profile!', 'success');
  _tourTabLoaded = false;
  loadTourManager(currentBandProfile.id);
}

function toggleStopNote(stopId) {
  const wrap = document.getElementById(`stop-note-wrap-${stopId}`);
  if (!wrap) return;
  const isOpen = wrap.classList.toggle('stop-note-wrap--open');
  const btn = document.querySelector(`#stop-row-${stopId} .stop-note-toggle`);
  if (btn) btn.textContent = isOpen ? '↳ note' : '+ note';
  if (isOpen) wrap.querySelector('textarea')?.focus();
}

async function saveTourNotes(tourId) {
  const val = document.getElementById(`tour-notes-${tourId}`)?.value || '';
  const { error } = await sb.from('saved_tours').update({ notes: val }).eq('id', tourId);
  if (!error) _tours = _tours.map(t => String(t.id) === String(tourId) ? { ...t, notes: val } : t);
}

async function saveStopNotes(stopId, tourId) {
  const val = document.getElementById(`stop-note-${stopId}`)?.value || '';
  const { error } = await sb.from('tour_stops').update({ notes: val }).eq('id', stopId);
  if (!error) {
    _tours = _tours.map(t => {
      if (String(t.id) !== String(tourId)) return t;
      return { ...t, tour_stops: (t.tour_stops || []).map(s => String(s.id) === String(stopId) ? { ...s, notes: val } : s) };
    });
  }
}

function startCreateRoute(tourId) {
  const tour = _tours.find(t => String(t.id) === String(tourId));
  if (!tour) return;
  const stops = (tour.tour_stops || []).slice().sort((a, b) => a.position - b.position);
  const cities = stops.map(s => [s.city, s.state].filter(Boolean).join(', ')).filter(Boolean);

  // Estimate duration from actual show dates
  let estimatedDays = '';
  const dated = stops.filter(s => s.show_date).sort((a, b) => new Date(a.show_date) - new Date(b.show_date));
  if (dated.length >= 2) {
    const first = new Date(dated[0].show_date);
    const last  = new Date(dated[dated.length - 1].show_date);
    const days  = Math.round((last - first) / (1000 * 60 * 60 * 24)) + 1;
    estimatedDays = `${days} days`;
  } else if (stops.length) {
    estimatedDays = `${stops.length * 2}–${stops.length * 3} days`;
  }

  // Rough mileage estimate: average US tour leg ~180 mi
  const estimatedMiles = stops.length > 1 ? `~${Math.round((stops.length - 1) * 180)} mi` : '';

  try {
    localStorage.setItem('bandmate_create_route', JSON.stringify({
      tourId: tour.id,
      tourName: tour.name,
      cities,
      estimatedDays,
      estimatedMiles,
    }));
  } catch {}
  window.location.href = 'create-route.html';
}

function downloadTourItinerary(tourId) {
  const tour = _tours.find(t => String(t.id) === String(tourId));
  if (!tour) return;
  const stops = (tour.tour_stops || []).slice().sort((a, b) => a.position - b.position);

  if (tour.itinerary_html) {
    _printTourItinerary(tour, stops);
  } else {
    _downloadPlainItinerary(tour, stops);
  }
}

function _itinPrintDoc(tourName, dateStr, notesHtml, bodyHtml) {
  return `<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<title>${escapeHtml(tourName)} — Itinerary</title>
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400&family=Space+Mono:wght@400;700&display=swap" rel="stylesheet">
<style>
:root{--paper:#f2efe6;--teal:#3a7a8a;--olive:#7a8a3a;--red:#d94535;--ink:#0f0f0c;--grey:#8a8a7c;--warm:#f2efe6;--rust:#3a7a8a;--sage:#7a8a3a;--muted:#8a8a7c;--gold:#c8a84b;--border:rgba(15,15,12,0.1);}
*{box-sizing:border-box;margin:0;padding:0;}
body{font-family:'DM Sans',sans-serif;font-weight:300;background:#fff;color:var(--ink);padding:36px;max-width:700px;margin:0 auto;}
.print-hd{border-bottom:1.5px solid var(--ink);padding-bottom:16px;margin-bottom:24px;display:flex;justify-content:space-between;align-items:flex-end;}
.print-title{font-size:20px;font-weight:400;letter-spacing:0.08em;text-transform:uppercase;}
.print-meta{font-size:8px;font-weight:300;letter-spacing:0.18em;text-transform:uppercase;color:var(--grey);text-align:right;line-height:1.8;}
.tour-notes-block{background:rgba(58,122,138,0.06);border-left:3px solid var(--teal);padding:14px 16px;margin-bottom:20px;}
.tnb-label{font-size:7px;font-weight:400;letter-spacing:0.22em;text-transform:uppercase;color:var(--teal);margin-bottom:6px;}
.tnb-text{font-size:12px;font-weight:300;line-height:1.55;white-space:pre-wrap;}
#itin-grid{display:flex;flex-direction:column;gap:8px;}
.itin-day{border:1px solid var(--border);padding:14px 16px;page-break-inside:avoid;}
.itin-show{background:#fff;border-left:3px solid var(--rust);}
.itin-drive{background:var(--warm);border-left:3px solid var(--border);}
.itin-rest{background:var(--warm);border-left:3px solid var(--sage);}
.itin-date{font-family:'Space Mono',monospace;font-size:8px;text-transform:uppercase;letter-spacing:0.1em;color:var(--muted);margin-bottom:2px;}
.itin-type-label{font-family:'Space Mono',monospace;font-size:9px;text-transform:uppercase;letter-spacing:0.08em;font-weight:700;margin-bottom:5px;}
.itin-city{font-size:16px;margin-bottom:8px;}
.itin-drive-detail{font-size:12px;color:#5a5550;font-weight:300;}
.itin-venue{background:rgba(15,15,12,0.03);padding:10px 12px;margin-top:6px;}
.itin-venue-name{font-size:14px;margin-bottom:2px;}
.itin-venue-address{font-family:'Space Mono',monospace;font-size:8px;text-transform:uppercase;letter-spacing:0.06em;color:var(--muted);margin-bottom:4px;}
.itin-venue-rating{font-family:'Space Mono',monospace;font-size:9px;color:var(--gold);}
.itin-no-venue{font-family:'Space Mono',monospace;font-size:8px;text-transform:uppercase;letter-spacing:0.06em;color:var(--muted);}
.itin-contact-btn,.paywall-overlay{display:none!important;}
.itin-stop-note{margin-top:8px;padding:8px 10px;background:rgba(122,138,58,0.08);border-left:2px solid var(--olive);}
.isn-label{font-size:7px;font-weight:400;letter-spacing:0.2em;text-transform:uppercase;color:var(--olive);margin-bottom:3px;}
.isn-text{font-size:11px;font-weight:300;line-height:1.5;white-space:pre-wrap;}
.print-ft{border-top:1px solid var(--border);margin-top:24px;padding-top:12px;font-size:8px;font-weight:300;letter-spacing:0.16em;text-transform:uppercase;color:var(--grey);display:flex;justify-content:space-between;}
@media print{body{padding:16px;}}
</style></head>
<body>
<div class="print-hd">
  <div class="print-title">${escapeHtml(tourName)}</div>
  <div class="print-meta">mybandmate.us<br>Generated ${dateStr}</div>
</div>
${notesHtml}
<div id="itin-grid">${bodyHtml}</div>
<div class="print-ft"><span>Bandmate Tour Itinerary</span><span>${escapeHtml(tourName)}</span></div>
<script>window.onload=()=>window.print();<\/script>
</body></html>`;
}

function _printTourItinerary(tour, stops) {
  // Inject per-stop notes into the stored itinerary HTML, then open a print window
  const parser  = new DOMParser();
  const doc     = parser.parseFromString(`<div id="root">${tour.itinerary_html}</div>`, 'text/html');
  const showEls = doc.querySelectorAll('.itin-show');

  showEls.forEach((el, idx) => {
    const note = stops[idx]?.notes?.trim();
    if (!note) return;
    const nd = doc.createElement('div');
    nd.className = 'itin-stop-note';
    nd.innerHTML = `<div class="isn-label">Note</div><div class="isn-text">${escapeHtml(note)}</div>`;
    el.appendChild(nd);
  });

  const itinHtml = doc.getElementById('root').innerHTML;
  const dateStr  = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

  const tourNotesHtml = tour.notes?.trim()
    ? `<div class="tour-notes-block">
        <div class="tnb-label">Tour Notes</div>
        <div class="tnb-text">${escapeHtml(tour.notes.trim())}</div>
       </div>`
    : '';

  const win = window.open('', '_blank');
  if (!win) { showToast('Pop-up blocked — please allow pop-ups and try again.', 'error'); return; }
  win.document.write(_itinPrintDoc(tour.name, dateStr, tourNotesHtml, itinHtml));
  win.document.close();
}

function _downloadPlainItinerary(tour, stops) {
  const statusLabel = { yes: 'BOOKED', pending: 'PENDING', no: 'NOT BOOKED' };
  const statusColor = { yes: '#3a7a8a', pending: '#7a8a3a', no: '#d94535' };
  const dateStr = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

  const stopsHtml = stops.map((s, i) => {
    const loc     = [s.city, s.state].filter(Boolean).join(', ');
    const color   = statusColor[s.status] || '#8a8a7c';
    const noteHtml = s.notes?.trim()
      ? `<div class="itin-stop-note"><div class="isn-label">Note</div><div class="isn-text">${escapeHtml(s.notes.trim())}</div></div>`
      : '';
    return `<div class="itin-day itin-show">
      <div class="itin-date">Stop ${String(i + 1).padStart(2, '0')}</div>
      <div class="itin-type-label">${escapeHtml(s.venue_name || 'TBD')}</div>
      ${loc ? `<div class="itin-city">${escapeHtml(loc)}</div>` : ''}
      <div style="margin-top:4px;font-family:'Space Mono',monospace;font-size:8px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:${color}">${statusLabel[s.status] || 'PENDING'}</div>
      ${noteHtml}
    </div>`;
  }).join('');

  const tourNotesHtml = tour.notes?.trim()
    ? `<div class="tour-notes-block"><div class="tnb-label">Tour Notes</div><div class="tnb-text">${escapeHtml(tour.notes.trim())}</div></div>`
    : '';

  const win = window.open('', '_blank');
  if (!win) { showToast('Pop-up blocked — please allow pop-ups and try again.', 'error'); return; }
  win.document.write(_itinPrintDoc(tour.name, dateStr, tourNotesHtml, stopsHtml));
  win.document.close();
}

function _launchBookedCelebration(tourName) {
  if (document.getElementById('bookedCelebration')) return;
  const colors = ['#3a7a8a', '#d94535', '#7a8a3a', '#c8dce4', '#1e4a55', '#f2efe6'];
  const drops = Array.from({ length: 54 }, (_, i) => {
    const color = colors[i % colors.length];
    const x     = (Math.random() * 96 + 2).toFixed(1);
    const delay = (Math.random() * 1.5).toFixed(2);
    const dur   = (1.8 + Math.random() * 1.4).toFixed(2);
    const size  = (5 + Math.random() * 9).toFixed(1);
    const shape = i % 3 === 1 ? '' : 'border-radius:50%';
    return `<div class="booked-drop" style="left:${x}%;animation-delay:${delay}s;animation-duration:${dur}s;background:${color};width:${size}px;height:${size}px;${shape}"></div>`;
  }).join('');

  const el = document.createElement('div');
  el.id = 'bookedCelebration';
  el.className = 'booked-celebration';
  el.innerHTML = `
    <div class="booked-drops">${drops}</div>
    <div class="booked-message">
      <svg viewBox="0 0 26 26" width="52" height="52" fill="none" class="booked-globe-svg">
        <circle cx="13" cy="13" r="11" stroke="#0f0f0c" stroke-width="1"/>
        <ellipse cx="13" cy="13" rx="11" ry="4" stroke="#0f0f0c" stroke-width="0.8" opacity="0.5"/>
        <ellipse cx="13" cy="9" rx="9.5" ry="2.8" stroke="#0f0f0c" stroke-width="0.5" opacity="0.22"/>
        <ellipse cx="13" cy="17" rx="9.5" ry="2.8" stroke="#0f0f0c" stroke-width="0.5" opacity="0.22"/>
        <g class="booked-globe-spin">
          <ellipse cx="13" cy="13" rx="4.5" ry="11" stroke="#0f0f0c" stroke-width="0.8" opacity="0.5"/>
          <ellipse cx="13" cy="13" rx="4.5" ry="11" stroke="#0f0f0c" stroke-width="0.5" opacity="0.22" transform="rotate(60 13 13)"/>
          <ellipse cx="13" cy="13" rx="4.5" ry="11" stroke="#0f0f0c" stroke-width="0.5" opacity="0.22" transform="rotate(-60 13 13)"/>
        </g>
      </svg>
      <div class="booked-title">Tour Fully Booked!</div>
      <div class="booked-sub">${escapeHtml(tourName)}</div>
      <button class="booked-dismiss" onclick="document.getElementById('bookedCelebration').remove()">Close ✕</button>
    </div>`;
  document.body.appendChild(el);
  setTimeout(() => document.getElementById('bookedCelebration')?.remove(), 6000);
}

// ── Phase 2: Co-Headliner Shared Tour ─────────────────────────────────────────

async function _createCoHeadlinerTour(originalTourId, otherBandId) {
  // Fetch original tour + stops
  const { data: orig, error: origErr } = await sb
    .from('saved_tours')
    .select('*, tour_stops(*)')
    .eq('id', originalTourId)
    .single();
  if (origErr || !orig) { showToast('Could not load tour for co-headliner link.', 'error'); return; }

  // Create mirrored tour for other band
  const { data: mirror, error: mirrorErr } = await sb
    .from('saved_tours')
    .insert({
      band_id: otherBandId,
      name: orig.name,
      co_headliner_band_id: currentBandProfile?.id,
    })
    .select()
    .single();
  if (mirrorErr || !mirror) { showToast('Could not create co-headliner tour.', 'error'); return; }

  // Copy stops into mirrored tour (all pending)
  const stops = (orig.tour_stops || []).map(s => ({
    tour_id:    mirror.id,
    venue_name: s.venue_name,
    city:       s.city,
    state:      s.state,
    place_id:   s.place_id,
    position:   s.position,
    status:     'pending',
  }));
  if (stops.length) await sb.from('tour_stops').insert(stops);

  // Link original tour back to the mirror
  await sb.from('saved_tours').update({
    co_headliner_band_id: otherBandId,
    co_headliner_tour_id: mirror.id,
  }).eq('id', originalTourId);

  // Also set co_headliner_tour_id on mirror to point back
  await sb.from('saved_tours').update({ co_headliner_tour_id: originalTourId }).eq('id', mirror.id);

  showToast('Co-headliner tour created for both bands!', 'success');
}

async function sendSharedItinerary(tourId) {
  const tour = _tours.find(t => String(t.id) === String(tourId));
  if (!tour || !tour.itinerary_html) { showToast('No itinerary to send.', 'error'); return; }
  const coH = tour.co_headliner;
  if (!coH) { showToast('No co-headliner linked to this tour.', 'error'); return; }

  const meta = { tour_name: tour.name, itinerary_html: tour.itinerary_html };
  const { data: msg, error } = await sb.from('band_messages').insert({
    sender_band_id:   currentBandProfile.id,
    receiver_band_id: coH.id,
    message_text:     `Shared itinerary: ${tour.name}`,
    message_type:     'itinerary',
    metadata:         meta,
    is_read:          false,
  }).select().single();
  if (error) { showToast('Send failed — ' + error.message, 'error'); return; }

  if (msg) _sharedItineraries[msg.id] = meta;

  await sb.from('notifications').insert({
    band_id: coH.id,
    type:    'shared_itinerary',
    payload: { from_band: currentBandProfile.band_name, tour_name: tour.name },
    read:    false,
  });

  showToast('Itinerary sent to ' + coH.band_name + '!', 'success');
}

function postTourToCommForType(tourId, type) {
  if (!currentUser) { openAuth('login'); return; }
  const tour = _tours.find(t => String(t.id) === String(tourId));
  if (!tour) return;

  const stops = (tour.tour_stops || []).slice().sort((a, b) => a.position - b.position);
  const showDates = stops.filter(s => s.venue_name).map(s => ({
    date:           s.show_date || '',
    city:           s.city || '',
    venue_name:     s.venue_name,
    venue_place_id: s.place_id || null,
  }));
  const genreList = (currentBandProfile?.genre || '').split(',').map(g => g.trim()).filter(Boolean);

  const prefill = {
    type,
    title:          '',
    description:    '',
    genres:         genreList,
    posting_dates:  showDates,
    linked_tour_id: tour.id,
  };
  sessionStorage.setItem('comm_prefill', JSON.stringify(prefill));
  window.location.href = 'community.html?fromtour=1';
}

function openSharedItinerary(msgId) {
  const meta = _sharedItineraries[msgId];
  if (!meta?.itinerary_html) { showToast('Itinerary not available.', 'error'); return; }
  const dateStr = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  const win = window.open('', '_blank');
  if (!win) { showToast('Pop-up blocked — please allow pop-ups and try again.', 'error'); return; }
  win.document.write(_itinPrintDoc(meta.tour_name || 'Tour Itinerary', dateStr, '', meta.itinerary_html));
  win.document.close();
}
