// profile.js — Band Profile & EPK management
//
// Required Supabase setup (run the SQL provided in the repo comments):
//   bands table columns:  bio, website, spotify_url, instagram_url, profile_photo_url, home_city (already exists)
//   band_photos table:    id, band_id, photo_url, created_at
//   Storage buckets:      band-photos (public), press-photos (public)

const FREE_PRESS_LIMIT = 10;

// Guard: form fields are populated exactly once per session so that
// TOKEN_REFRESHED / periodic auth events never wipe unsaved edits.
let formPopulated = false;

// ── Init ──────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  await initAuth();  // sets currentUser + currentBandProfile, starts auth.js listener

  // Initial render — auth is resolved at this point
  renderProfile();

  // Only react to actual sign-in / sign-out; ignore TOKEN_REFRESHED, INITIAL_SESSION
  sb.auth.onAuthStateChange(async (event) => {
    if (event !== 'SIGNED_IN' && event !== 'SIGNED_OUT') return;
    if (event === 'SIGNED_OUT') {
      formPopulated = false;
      renderProfile();
      return;
    }
    // SIGNED_IN: wait for auth.js listener to finish loading the band profile
    await new Promise(r => setTimeout(r, 350));
    formPopulated = false;
    renderProfile();
  });

  // Wire up drag-and-drop on press photo upload area
  const uploadArea = document.getElementById('pressUploadArea');
  uploadArea.addEventListener('click', () => document.getElementById('pressPhotoInput').click());
  uploadArea.addEventListener('dragover', e => { e.preventDefault(); uploadArea.classList.add('drag-over'); });
  uploadArea.addEventListener('dragleave', () => uploadArea.classList.remove('drag-over'));
  uploadArea.addEventListener('drop', e => {
    e.preventDefault();
    uploadArea.classList.remove('drag-over');
    handlePressPhotoUpload({ files: e.dataTransfer.files });
  });

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

  // ── Hero (always safe to update — these are read-only display elements) ──
  renderAvatarEl(bp.profile_photo_url, bp.band_name, 'profilePhotoEl');
  document.getElementById('profileName').textContent = bp.band_name || '—';
  document.getElementById('profileMeta').textContent =
    [bp.genre, bp.home_city].filter(Boolean).join(' · ');

  if (isPremium) {
    document.getElementById('profileBadge').style.display   = 'inline-block';
    document.getElementById('profileActions').style.display = 'flex';
    document.getElementById('epkPageLink').href             = `epk.html?band=${bandSlug(bp.band_name)}`;
  } else {
    document.getElementById('profileBadge').style.display   = 'none';
    document.getElementById('profileActions').style.display = 'none';
  }

  // ── Edit form (premium only) — populate ONCE per session ──
  document.getElementById('editSection').style.display = isPremium ? 'block' : 'none';
  if (isPremium && !formPopulated) {
    formPopulated = true;
    document.getElementById('profileBio').value       = bp.bio           || '';
    document.getElementById('profileCity').value      = bp.home_city     || '';
    document.getElementById('profileWebsite').value   = bp.website       || '';
    document.getElementById('profileSpotify').value   = bp.spotify_url   || '';
    document.getElementById('profileInstagram').value = bp.instagram_url || '';
  }

  // ── Press photos (shown to all logged-in users) ──
  document.getElementById('pressPhotosSection').style.display = 'block';
  renderPressPhotos();   // async but non-blocking — grid updates when ready

  // ── Review progress (free only) ──
  if (!isPremium) {
    const count = bp.review_count || 0;
    const pct   = Math.min((count / 5) * 100, 100);
    document.getElementById('progressSection').style.display = 'block';
    document.getElementById('progressLabel').textContent     = `${count} of 5 reviews`;
    document.getElementById('progressFill').style.width      = `${pct}%`;
    document.getElementById('upgradeSection').style.display  = 'block';
    document.getElementById('upgradeRemaining').textContent  =
      count >= 5
        ? 'You\'ve unlocked Community Premium!'
        : `${5 - count} more review${5 - count !== 1 ? 's' : ''} to unlock free Community Premium`;
    document.getElementById('premiumExtras').style.display = 'none';
  } else {
    document.getElementById('progressSection').style.display = 'none';
    document.getElementById('upgradeSection').style.display  = 'none';
    document.getElementById('premiumExtras').style.display   = 'block';
  }

  // ── Review history ──
  loadReviewHistory(bp.id);  // async, non-blocking
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

  if (file.size > 5 * 1024 * 1024) {
    showToast('Photo must be under 5 MB', 'error');
    return;
  }

  // Immediate local preview before upload
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
    console.error('Photo upload error:', uploadError);
    // Revert preview to saved photo (or initials if none)
    renderAvatarEl(currentBandProfile.profile_photo_url, currentBandProfile.band_name, 'profilePhotoEl');
    showToast('Upload failed — check that the band-photos bucket exists in Supabase Storage', 'error');
    return;
  }

  const { data: { publicUrl } } = sb.storage.from('band-photos').getPublicUrl(path);

  const { error: dbError } = await sb.from('bands')
    .update({ profile_photo_url: publicUrl })
    .eq('id', currentBandProfile.id);

  if (dbError) {
    console.error('DB update error:', dbError);
    showToast('Photo uploaded but could not save URL — ' + dbError.message, 'error');
    return;
  }

  currentBandProfile.profile_photo_url = publicUrl;
  updateNavAuth();
  showToast('Photo saved', 'success');
  // Preview is already showing the correct image from the FileReader step
}

// ── Save profile edits ────────────────────────────────────────────────────────

async function saveProfileEdits() {
  if (!currentBandProfile || !isBandPremium(currentBandProfile)) return;

  const btn = document.getElementById('profileSaveBtn');
  btn.textContent = 'Saving…';
  btn.disabled    = true;

  const bio       = document.getElementById('profileBio').value.trim();
  const city      = document.getElementById('profileCity').value.trim();
  const website   = document.getElementById('profileWebsite').value.trim();
  const spotify   = document.getElementById('profileSpotify').value.trim();
  const instagram = document.getElementById('profileInstagram').value.trim();

  const { error } = await sb.from('bands')
    .update({ bio, home_city: city, website, spotify_url: spotify, instagram_url: instagram })
    .eq('id', currentBandProfile.id);

  btn.textContent = 'Save Changes →';
  btn.disabled    = false;

  if (error) {
    console.error('Profile save error:', error);
    showToast('Save failed — ' + error.message, 'error');
    return;
  }

  // Keep cached profile in sync
  currentBandProfile.bio          = bio;
  currentBandProfile.home_city    = city;
  currentBandProfile.website      = website;
  currentBandProfile.spotify_url  = spotify;
  currentBandProfile.instagram_url = instagram;

  // Update the read-only meta line in the hero without re-rendering the whole page
  document.getElementById('profileMeta').textContent =
    [currentBandProfile.genre, city].filter(Boolean).join(' · ');

  showToast('Profile saved', 'success');
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

// ── Press photos ──────────────────────────────────────────────────────────────

async function renderPressPhotos() {
  if (!currentBandProfile) return;
  const bp        = currentBandProfile;
  const isPremium = isBandPremium(bp);

  const { data: photos } = await sb
    .from('band_photos')
    .select('id, photo_url')
    .eq('band_id', bp.id)
    .order('created_at', { ascending: false });

  const list  = photos || [];
  const count = list.length;
  const atLimit = !isPremium && count >= FREE_PRESS_LIMIT;

  // Usage label
  document.getElementById('pressPhotosUsage').textContent = isPremium
    ? `${count} photo${count !== 1 ? 's' : ''}`
    : `${count} of ${FREE_PRESS_LIMIT} slots used${atLimit ? ' — upgrade for unlimited' : ''}`;

  // Disable upload area if free and at limit
  const area = document.getElementById('pressUploadArea');
  area.style.opacity       = atLimit ? '0.45' : '1';
  area.style.pointerEvents = atLimit ? 'none'  : 'auto';

  // Render grid
  const grid = document.getElementById('pressPhotosGrid');
  grid.innerHTML = list.map(p => `
    <div class="press-photo-thumb" id="ppt-${p.id}">
      <img src="${p.photo_url}" alt="Press photo" loading="lazy">
      <button class="press-photo-delete" title="Delete photo" onclick="deletePressPhoto('${p.id}', '${p.photo_url}')">✕</button>
    </div>
  `).join('');
}

async function handlePressPhotoUpload(input) {
  const files = Array.from(input.files || []);
  if (!files.length || !currentBandProfile) return;

  const bp        = currentBandProfile;
  const isPremium = isBandPremium(bp);

  // Check how many already exist
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

  if (toUpload.length < files.length) {
    showToast(`Only ${slotsLeft} slot${slotsLeft !== 1 ? 's' : ''} remaining — uploading first ${toUpload.length}`);
  } else {
    showToast(`Uploading ${toUpload.length} photo${toUpload.length !== 1 ? 's' : ''}…`);
  }

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

    if (upErr) {
      console.error('Press photo upload error:', upErr);
      showToast(`Failed to upload ${file.name}`, 'error');
      continue;
    }

    const { data: { publicUrl } } = sb.storage.from('press-photos').getPublicUrl(path);
    await sb.from('band_photos').insert({ band_id: bp.id, photo_url: publicUrl });
    uploaded++;
  }

  // Reset input so same file can be re-selected if needed
  if (input.value !== undefined) input.value = '';

  if (uploaded > 0) showToast(`${uploaded} photo${uploaded !== 1 ? 's' : ''} uploaded`, 'success');
  await renderPressPhotos();
}

async function deletePressPhoto(photoId, photoUrl) {
  if (!currentBandProfile) return;

  const { error } = await sb.from('band_photos').delete().eq('id', photoId);
  if (error) { showToast('Delete failed', 'error'); return; }

  // Best-effort: remove from storage too
  try {
    const match = photoUrl.match(/\/press-photos\/(.+)$/);
    if (match) await sb.storage.from('press-photos').remove([decodeURIComponent(match[1])]);
  } catch (_) { /* storage delete is non-critical */ }

  document.getElementById(`ppt-${photoId}`)?.remove();
  await renderPressPhotos(); // refresh usage count
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function bandSlug(name) {
  return (name || '').toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
}

function showComingSoon() {
  showToast('Analytics coming soon — check back after your next tour!');
}
