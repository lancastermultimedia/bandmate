// profile.js — Band Profile & EPK management

const FREE_PRESS_LIMIT  = 10;
const FREE_QUOTES_LIMIT = 5;

// Guard: form fields are populated exactly once per session so that
// TOKEN_REFRESHED / periodic auth events never wipe unsaved edits.
let formPopulated = false;

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

// ── Init ──────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  await initAuth();
  renderProfile();

  sb.auth.onAuthStateChange(async (event) => {
    if (event !== 'SIGNED_IN' && event !== 'SIGNED_OUT') return;
    if (event === 'SIGNED_OUT') { formPopulated = false; renderProfile(); return; }
    await new Promise(r => setTimeout(r, 350));
    formPopulated = false;
    renderProfile();
  });

  // Press photos drag-and-drop
  const uploadArea = document.getElementById('pressUploadArea');
  uploadArea.addEventListener('click', () => document.getElementById('pressPhotoInput').click());
  uploadArea.addEventListener('dragover', e => { e.preventDefault(); uploadArea.classList.add('drag-over'); });
  uploadArea.addEventListener('dragleave', () => uploadArea.classList.remove('drag-over'));
  uploadArea.addEventListener('drop', e => {
    e.preventDefault();
    uploadArea.classList.remove('drag-over');
    handlePressPhotoUpload({ files: e.dataTransfer.files });
  });

  // Stage plot upload area
  const stagePlotArea = document.getElementById('stagePlotUploadArea');
  stagePlotArea.addEventListener('click', () => document.getElementById('stagePlotInput').click());

  document.getElementById('authModal').addEventListener('click', function(e) {
    if (e.target === this) closeAuth();
  });

  document.body.style.visibility = 'visible';
});

// ── Main render ───────────────────────────────────────────────────────────────

async function renderProfile() {
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
  document.getElementById('editSection').style.display       = isPremium ? 'block' : 'none';
  document.getElementById('musicLinksSection').style.display = isPremium ? 'block' : 'none';
  document.getElementById('pressQuotesSection').style.display = isPremium ? 'block' : 'none';
  document.getElementById('stagePlotSection').style.display  = isPremium ? 'block' : 'none';
  document.getElementById('videosSection').style.display     = isPremium ? 'block' : 'none';
  document.getElementById('epkSettingsSection').style.display = isPremium ? 'block' : 'none';

  // ── Form fields — populate ONCE per session ──
  if (isPremium && !formPopulated) {
    formPopulated = true;

    // Edit profile
    document.getElementById('profileBio').value  = bp.bio       || '';
    document.getElementById('profileCity').value = bp.home_city || '';
    loadGenreChips('profileGenreChips').then(() => preselectGenres('profileGenreChips', bp.genre));

    // Music & Links
    document.getElementById('linkSpotify').value    = bp.spotify_url     || '';
    document.getElementById('linkYoutube').value    = bp.youtube_url     || '';
    document.getElementById('linkSoundcloud').value = bp.soundcloud_url  || '';
    document.getElementById('linkAppleMusic').value = bp.apple_music_url || '';
    document.getElementById('linkBandcamp').value   = bp.bandcamp_url    || '';
    document.getElementById('linkWebsite').value    = bp.website         || '';
    document.getElementById('linkInstagram').value  = bp.instagram_url   || '';
    document.getElementById('linkTiktok').value     = bp.tiktok_url      || '';
    document.getElementById('linkFacebook').value   = bp.facebook_url    || '';
  }

  // ── Dynamic sections (always refresh from DB) ──
  if (isPremium) {
    loadQuotes(bp.id);
    renderStagePlotStatus();
    loadVideos(bp.id);
    updateEpkThemeStatus();
  }

  // ── Press photos ──
  document.getElementById('pressPhotosSection').style.display = 'block';
  renderPressPhotos();

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
        ? 'You\'ve unlocked Community Premium!'
        : `${3 - count} more review${3 - count !== 1 ? 's' : ''} to unlock free Community Premium`;
  } else {
    document.getElementById('progressSection').style.display = 'none';
    document.getElementById('upgradeSection').style.display  = 'none';
  }

  // ── Review history ──
  loadReviewHistory(bp.id);
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

  document.getElementById('profileMeta').textContent =
    [genre, city].filter(Boolean).join(' · ');

  s.success();
  showToast('Profile saved', 'success');
}

// ── Music & Links ─────────────────────────────────────────────────────────────

async function saveMusicLinks() {
  devLog('[profile] saveMusicLinks — currentUser:', currentUser?.email, 'bp.id:', currentBandProfile?.id);
  if (!currentUser || !currentBandProfile || !isBandPremium(currentBandProfile)) return;

  const s = saveBtnCtrl('musicLinksSaveBtn', 'Save Links →');
  s.saving();

  const updates = {
    spotify_url:     document.getElementById('linkSpotify').value.trim()    || null,
    youtube_url:     document.getElementById('linkYoutube').value.trim()    || null,
    soundcloud_url:  document.getElementById('linkSoundcloud').value.trim() || null,
    apple_music_url: document.getElementById('linkAppleMusic').value.trim() || null,
    bandcamp_url:    document.getElementById('linkBandcamp').value.trim()   || null,
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
