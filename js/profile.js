// profile.js — Band Profile & EPK management
//
// Requires these columns on the Supabase `bands` table (add via dashboard):
//   bio          text
//   website      text
//   spotify_url  text
//   instagram_url text
//   photo_url    text
//
// Requires a Supabase Storage bucket named `band-photos` with:
//   - Public read access enabled
//   - INSERT policy: auth.uid() IS NOT NULL

// ── Init ──────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  await initAuth();

  // Auth state drives the whole page render
  sb.auth.onAuthStateChange(async (_event, session) => {
    await new Promise(r => setTimeout(r, 150)); // let loadBandProfile settle
    renderProfile();
  });

  // Also render on initial load once auth resolves
  setTimeout(renderProfile, 800);

  document.getElementById('authModal').addEventListener('click', function(e) {
    if (e.target === this) closeAuth();
  });

  document.body.style.visibility = 'visible';
});

// ── Main render ───────────────────────────────────────────────────────────────

async function renderProfile() {
  if (!currentUser || !currentBandProfile) {
    document.getElementById('profilePage').style.display    = 'none';
    document.getElementById('profileNotAuthed').style.display = 'block';
    return;
  }

  document.getElementById('profileNotAuthed').style.display = 'none';
  document.getElementById('profilePage').style.display      = 'block';

  const bp       = currentBandProfile;
  const isPremium = isBandPremium(bp);

  // ── Hero ──
  renderPhotoEl(bp.photo_url, bp.band_name, 'profilePhotoEl', 'profile-photo', 'profile-photo-init');
  document.getElementById('profileName').textContent = bp.band_name || '—';
  document.getElementById('profileMeta').textContent =
    [bp.genre, bp.home_city].filter(Boolean).join(' · ');

  if (isPremium) {
    document.getElementById('profileBadge').style.display   = 'inline-block';
    document.getElementById('profileActions').style.display = 'flex';
    const slug = bandSlug(bp.band_name);
    document.getElementById('epkPageLink').href = `epk.html?band=${slug}`;
  } else {
    document.getElementById('profileBadge').style.display   = 'none';
    document.getElementById('profileActions').style.display = 'none';
  }

  // ── Premium: edit form ──
  if (isPremium) {
    document.getElementById('editSection').style.display = 'block';
    document.getElementById('profileBio').value       = bp.bio           || '';
    document.getElementById('profileWebsite').value   = bp.website       || '';
    document.getElementById('profileSpotify').value   = bp.spotify_url   || '';
    document.getElementById('profileInstagram').value = bp.instagram_url || '';
  } else {
    document.getElementById('editSection').style.display = 'none';
  }

  // ── Free: review progress ──
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
  } else {
    document.getElementById('progressSection').style.display = 'none';
    document.getElementById('upgradeSection').style.display  = 'none';
    document.getElementById('premiumExtras').style.display   = 'block';
  }

  // ── Review history ──
  await loadReviewHistory(bp.id);
}

// ── Review history ────────────────────────────────────────────────────────────

async function loadReviewHistory(bandId) {
  const { data: reviews, error } = await sb
    .from('reviews')
    .select('venue_name, overall_rating, review_text, created_at, google_place_id')
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

// ── Profile photo ─────────────────────────────────────────────────────────────

function renderPhotoEl(photoUrl, bandName, containerId, imgClass, initClass) {
  const el = document.getElementById(containerId);
  if (!el) return;
  const initial = (bandName || 'B')[0].toUpperCase();
  if (photoUrl) {
    el.innerHTML = `<img src="${photoUrl}" class="${imgClass}" alt="${bandName}">`;
  } else {
    el.innerHTML = `<div class="${initClass}">${initial}</div>`;
  }
}

async function handlePhotoUpload(input) {
  const file = input.files?.[0];
  if (!file || !currentBandProfile) return;

  // 5 MB limit
  if (file.size > 5 * 1024 * 1024) {
    showToast('Photo must be under 5 MB', 'error');
    return;
  }

  showToast('Uploading photo...');

  const ext  = file.name.split('.').pop().toLowerCase();
  const path = `${currentBandProfile.id}.${ext}`;

  const { error: uploadError } = await sb.storage
    .from('band-photos')
    .upload(path, file, { upsert: true, contentType: file.type });

  if (uploadError) {
    console.error('Photo upload error:', uploadError);
    showToast('Upload failed — make sure the band-photos bucket exists in Supabase Storage', 'error');
    return;
  }

  const { data: { publicUrl } } = sb.storage.from('band-photos').getPublicUrl(path);

  await sb.from('bands').update({ photo_url: publicUrl }).eq('id', currentBandProfile.id);
  currentBandProfile.photo_url = publicUrl;

  updateNavAuth();
  renderPhotoEl(publicUrl, currentBandProfile.band_name, 'profilePhotoEl', 'profile-photo', 'profile-photo-init');
  showToast('Profile photo updated!', 'success');
}

// ── Save profile edits ────────────────────────────────────────────────────────

async function saveProfileEdits() {
  if (!currentBandProfile || !isBandPremium(currentBandProfile)) return;

  const bio       = document.getElementById('profileBio').value.trim();
  const website   = document.getElementById('profileWebsite').value.trim();
  const spotify   = document.getElementById('profileSpotify').value.trim();
  const instagram = document.getElementById('profileInstagram').value.trim();

  const { error } = await sb
    .from('bands')
    .update({ bio, website, spotify_url: spotify, instagram_url: instagram })
    .eq('id', currentBandProfile.id);

  if (error) {
    console.error('Profile save error:', error);
    showToast('Save failed — ' + error.message, 'error');
    return;
  }

  // Update cached profile
  currentBandProfile.bio          = bio;
  currentBandProfile.website      = website;
  currentBandProfile.spotify_url  = spotify;
  currentBandProfile.instagram_url = instagram;

  showToast('Profile saved!', 'success');
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function bandSlug(name) {
  return (name || '').toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
}

function showComingSoon() {
  showToast('Analytics coming soon — check back after your next tour!');
}
