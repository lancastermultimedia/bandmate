// Review / venue-page state
let currentVenuePlaceId = null;
let currentVenueName    = null;
let vrfStarRating       = 0;

async function openVenuePage(placeId, name, address) {
  currentVenuePlaceId = placeId;
  currentVenueName    = name;

  document.getElementById('vpEyebrow').textContent  = address;
  document.getElementById('vpName').textContent     = name;
  document.getElementById('vpAddress').textContent  = address;
  document.getElementById('vrfVenueName').textContent = name;

  ['vpOverall','vpSound','vpComms','vpMerch','vpParking'].forEach(id =>
    document.getElementById(id).textContent = '—'
  );

  document.getElementById('reviewsList').innerHTML = `
    <div class="no-reviews">
      <div class="no-reviews-icon">— —</div>
      <div class="no-reviews-title">Loading reviews...</div>
    </div>`;

  // Wire up contact button (openContactModal is defined in auth.js)
  document.getElementById('vpContactBtn').onclick = () =>
    openContactModal(placeId, name, address);

  document.getElementById('venueReviewForm').classList.remove('visible');
  document.getElementById('venuePage').classList.add('open');
  document.body.style.overflow = 'hidden';

  await loadVenueReviews(placeId, name);
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

async function loadVenueReviews(placeId, venueName) {
  const { data: reviews, error } = await sb
    .from('reviews')
    .select('*, bands(band_name, genre, home_city)')
    .eq('google_place_id', placeId)
    .order('created_at', { ascending: false });

  if (error || !reviews || reviews.length === 0) {
    document.getElementById('reviewsList').innerHTML = `
      <div class="no-reviews">
        <div class="no-reviews-icon">— —</div>
        <div class="no-reviews-title">No reviews yet</div>
        <p>Be the first band to review ${venueName}!</p>
      </div>`;
    return;
  }

  const avg = key => (reviews.reduce((s, r) => s + (r[key] || 0), 0) / reviews.length).toFixed(1);
  document.getElementById('vpOverall').textContent = avg('overall_rating');
  document.getElementById('vpSound').textContent   = avg('sound_rating');
  document.getElementById('vpComms').textContent   = avg('comms_rating');
  document.getElementById('vpMerch').textContent   = avg('merch_rating');
  document.getElementById('vpParking').textContent = avg('parking_rating');
  document.getElementById('reviewsTitle').textContent = `Band Reviews (${reviews.length})`;

  document.getElementById('reviewsList').innerHTML = reviews.map(r => {
    const band     = r.bands || {};
    const initials = (band.band_name || 'B').substring(0, 2).toUpperCase();
    const stars    = '★'.repeat(r.overall_rating) + '☆'.repeat(5 - r.overall_rating);
    const date     = new Date(r.created_at).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
    return `<div class="review-item">
      <div class="ri-header">
        <div class="ri-avatar">${initials}</div>
        <div>
          <div class="ri-band">${band.band_name || 'Anonymous Band'}</div>
          <div class="ri-meta">${band.genre || ''} · ${band.home_city || ''} · ${date}</div>
        </div>
        <div class="ri-stars">${stars}</div>
      </div>
      ${r.genre_played ? `<div style="font-family:'Space Mono',monospace;font-size:0.55rem;text-transform:uppercase;letter-spacing:0.06em;color:var(--sage);margin-bottom:10px">Played as: ${r.genre_played}</div>` : ''}
      <p class="ri-text">${r.review_text}</p>
      <div class="ri-scores">
        <div class="ri-score"><div class="ri-score-dot"></div>Sound <strong>${r.sound_rating}/5</strong></div>
        <div class="ri-score"><div class="ri-score-dot"></div>Communication <strong>${r.comms_rating}/5</strong></div>
        <div class="ri-score"><div class="ri-score-dot"></div>Merch <strong>${r.merch_rating}/5</strong></div>
        <div class="ri-score"><div class="ri-score-dot"></div>Parking <strong>${r.parking_rating}/5</strong></div>
      </div>
    </div>`;
  }).join('');
}

function setVrfStar(val) {
  vrfStarRating = val;
  document.querySelectorAll('#vrfStars .star-btn').forEach((s, i) =>
    s.style.color = i < val ? '#d4a843' : '#ddd8cc'
  );
  updateSubmitBtn();
}

function updateCharCount() {
  const text = document.getElementById('vrfText').value;
  const el   = document.getElementById('vrfCharCount');
  if (text.length < 50) {
    el.textContent = `Minimum 50 characters required (${text.length}/50)`;
    el.className   = 'vrf-char-count too-short';
  } else {
    el.textContent = `${text.length} characters ✓`;
    el.className   = 'vrf-char-count';
  }
  updateSubmitBtn();
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
  const genre = getSelectedGenres('vrfGenreChips')[0] || null;
  if (!vrfStarRating)    { showToast('Please select a star rating', 'error'); return; }
  if (text.length < 50)  { showToast('Please write at least 50 characters', 'error'); return; }

  const ranges = document.querySelectorAll('#venueReviewForm input[type=range]');
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
    review_text:     text
  };

  devLog('Submitting review:', reviewData);

  const btn = document.getElementById('vrfSubmitBtn');
  btn.textContent = 'Posting...';
  btn.disabled    = true;

  const { error } = await sb.from('reviews').insert(reviewData);
  if (error) {
    console.error('Review insert failed:', error);
    showToast(`Submit failed: ${error.message}`, 'error');
    btn.textContent = 'Post Review';
    btn.disabled    = false;
    return;
  }

  // Increment review_count on the band — used for community premium threshold
  const newCount = (currentBandProfile.review_count || 0) + 1;
  await sb.from('bands').update({ review_count: newCount }).eq('email', currentUser.email);
  currentBandProfile.review_count = newCount;
  updateNavAuth();

  showToast('Review posted — thanks for helping the community.', 'success');
  document.getElementById('venueReviewForm').classList.remove('visible');
  document.getElementById('vrfText').value = '';
  vrfStarRating = 0;
  document.querySelectorAll('#vrfStars .star-btn').forEach(s => s.style.color = '#ddd8cc');
  await loadVenueReviews(currentVenuePlaceId, currentVenueName);
}

// Scroll reveal
const observer = new IntersectionObserver(entries => {
  entries.forEach(e => { if (e.isIntersecting) e.target.classList.add('visible'); });
}, { threshold: 0.1 });
document.querySelectorAll('.reveal').forEach(el => observer.observe(el));
