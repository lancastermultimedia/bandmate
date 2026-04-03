// epk.js — Public EPK page
// URL: epk.html?band=band-name-slug
// No login required — fully public page

const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

document.addEventListener('DOMContentLoaded', async () => {
  const slug = new URLSearchParams(window.location.search).get('band');

  if (!slug) {
    renderNotFound('No band specified.');
    document.body.style.visibility = 'visible';
    return;
  }

  const nameSearch = slug.replace(/-/g, ' ');

  const { data: bands } = await sb
    .from('bands')
    .select('id, band_name, genre, home_city, bio, website, spotify_url, instagram_url, profile_photo_url, is_premium, review_count')
    .ilike('band_name', nameSearch)
    .limit(1);

  const band = bands?.[0];

  if (!band) {
    renderNotFound(`No band found for "${nameSearch}".`);
    document.body.style.visibility = 'visible';
    return;
  }

  const isPremium = band.is_premium === true
    || (band.review_count || 0) >= 5
    || band.band_name === 'Campers';

  if (!isPremium) {
    renderNotFound(`${band.band_name} hasn't unlocked their EPK page yet.`);
    document.body.style.visibility = 'visible';
    return;
  }

  document.title = `${band.band_name} — EPK · Bandmate`;

  // Fetch reviews and press photos in parallel
  const [reviewsRes, photosRes] = await Promise.all([
    sb.from('reviews')
      .select('venue_name, overall_rating, review_text, created_at')
      .eq('band_id', band.id)
      .order('created_at', { ascending: false })
      .limit(3),
    sb.from('band_photos')
      .select('photo_url')
      .eq('band_id', band.id)
      .order('created_at', { ascending: false }),
  ]);

  renderEPK(band, reviewsRes.data || [], photosRes.data || []);
  document.body.style.visibility = 'visible';
});

// ── Render full EPK ───────────────────────────────────────────────────────────

function renderEPK(band, reviews, pressPhotos) {
  const initial   = (band.band_name || 'B')[0].toUpperCase();
  const photoHtml = band.profile_photo_url
    ? `<img src="${band.profile_photo_url}" class="epk-photo" alt="${escHtml(band.band_name)}">`
    : `<div class="epk-photo-init">${initial}</div>`;

  // Social links
  const linkBtns = [];
  if (band.spotify_url)   linkBtns.push(`<a href="${band.spotify_url}" target="_blank" rel="noopener" class="epk-link-btn epk-link-spotify">Spotify</a>`);
  if (band.instagram_url) linkBtns.push(`<a href="${band.instagram_url}" target="_blank" rel="noopener" class="epk-link-btn epk-link-instagram">Instagram</a>`);
  if (band.website)       linkBtns.push(`<a href="${band.website}" target="_blank" rel="noopener" class="epk-link-btn epk-link-website">Website</a>`);
  const linksHtml = linkBtns.length ? `<div class="epk-links">${linkBtns.join('')}</div>` : '';

  // Bio
  const bioHtml = band.bio ? `
    <div class="epk-section">
      <div class="epk-section-label">About</div>
      <div class="epk-bio">${escHtml(band.bio)}</div>
    </div>` : '';

  // Recent venue reviews
  const reviewsHtml = reviews.length ? `
    <div class="epk-section">
      <div class="epk-section-label">On Tour — Recent Venues</div>
      ${reviews.map(r => {
        const stars = '★'.repeat(r.overall_rating || 0) + '☆'.repeat(5 - (r.overall_rating || 0));
        const d     = new Date(r.created_at);
        const date  = `${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`;
        return `<div class="epk-review-item">
          <div class="epk-review-venue">${escHtml(r.venue_name || 'Venue')}</div>
          <div class="epk-review-meta">${stars} · ${date}</div>
          ${r.review_text ? `<div class="epk-review-text">${escHtml(r.review_text)}</div>` : ''}
        </div>`;
      }).join('')}
    </div>` : '';

  // Press photos grid
  const pressHtml = pressPhotos.length ? `
    <div class="epk-section">
      <div class="epk-section-label">Press Photos — right-click to save</div>
      <div class="epk-press-grid">
        ${pressPhotos.map(p => `<img src="${p.photo_url}" class="epk-press-photo" alt="${escHtml(band.band_name)} press photo" loading="lazy">`).join('')}
      </div>
    </div>` : '';

  // Book This Band mailto
  const subject    = encodeURIComponent(`Booking Inquiry — ${band.band_name}`);
  const mailtoBody = encodeURIComponent(
    `Hi,\n\nI found ${band.band_name} on Bandmate and I'm interested in booking you for a show.\n\nGenre: ${band.genre || '—'}\nHome City: ${band.home_city || '—'}\n\nPlease let me know your availability and rates.\n\nThanks!`
  );
  const mailtoLink = `mailto:?subject=${subject}&body=${mailtoBody}`;

  document.getElementById('epkMount').innerHTML = `
    <div class="epk-hero">
      ${photoHtml}
      <div>
        <div class="epk-eyebrow">Electronic Press Kit</div>
        <h1 class="epk-band-name">${escHtml(band.band_name)}</h1>
        <div class="epk-genre">${[band.genre, band.home_city].filter(Boolean).join(' · ')}</div>
        ${linksHtml}
      </div>
    </div>

    ${bioHtml}
    ${reviewsHtml}
    ${pressHtml}

    <div class="epk-book-section">
      <div class="epk-book-title">Book ${escHtml(band.band_name)}</div>
      <div class="epk-book-sub">Interested in booking this band for your venue or festival? Get in touch.</div>
      <a href="${mailtoLink}" class="epk-book-btn">Contact About Booking →</a>
    </div>

    <div class="epk-footer">
      <a href="index.html">Powered by Bandmate — the venue guide built for bands</a>
    </div>
  `;
}

// ── Not found ─────────────────────────────────────────────────────────────────

function renderNotFound(msg) {
  document.getElementById('epkMount').innerHTML = `
    <div class="epk-not-found">
      <div class="epk-not-found-title">EPK not found</div>
      <div class="epk-not-found-sub">${escHtml(msg)}</div>
      <a href="index.html" style="display:inline-block;margin-top:20px;font-family:'Space Mono',monospace;font-size:0.58rem;text-transform:uppercase;letter-spacing:0.1em;color:var(--rust);">← Back to Bandmate</a>
    </div>
  `;
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function escHtml(str) {
  return (str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
