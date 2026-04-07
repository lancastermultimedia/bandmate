// epk.js — Public EPK page (three themes: clean / bold / vibrant)
// URL: epk.html?band=band-name-slug
// Auth optional — shows owner controls when the viewer owns this EPK

const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

// Module-level references used by selectTheme and re-renders
let currentEpkBand = null;
let currentEpkData = null;

document.addEventListener('DOMContentLoaded', async () => {
  const slug = new URLSearchParams(window.location.search).get('band');

  if (!slug) {
    renderNotFound('No band specified.');
    document.body.style.visibility = 'visible';
    return;
  }

  const nameSearch = slug.replace(/-/g, ' ');

  // Load band data and auth session in parallel
  const [bandsRes] = await Promise.all([
    sb.from('bands')
      .select('id, band_name, genre, home_city, bio, website, spotify_url, youtube_url, soundcloud_url, apple_music_url, bandcamp_url, instagram_url, tiktok_url, facebook_url, profile_photo_url, is_premium, review_count, stage_plot_url, epk_theme')
      .ilike('band_name', nameSearch)
      .limit(1),
    initAuth(),
  ]);

  const band = bandsRes.data?.[0];
  if (!band) {
    renderNotFound(`No band found for "${nameSearch}".`);
    document.body.style.visibility = 'visible';
    return;
  }

  const isPremium = isBandPremium(band);
  const isOwner   = currentBandProfile && currentBandProfile.id === band.id;

  if (!isPremium) {
    renderNotFound(
      isOwner
        ? 'Upgrade to Community Premium or leave 3 reviews to unlock your EPK page.'
        : `${band.band_name} hasn't unlocked their EPK page yet.`
    );
    document.body.style.visibility = 'visible';
    return;
  }

  document.title = `${band.band_name} — EPK · Bandmate`;

  // Show owner bar
  if (isOwner) {
    document.body.classList.add('epk-owner-view');
    document.getElementById('epkFindVenuesLink').style.display = 'none';
  }

  // Load all EPK data in parallel
  const [reviewsRes, photosRes, quotesRes, videosRes] = await Promise.all([
    sb.from('reviews')
      .select('venue_name, overall_rating, review_text, created_at')
      .eq('band_id', band.id)
      .order('created_at', { ascending: false })
      .limit(3),
    sb.from('band_photos')
      .select('photo_url')
      .eq('band_id', band.id)
      .order('created_at', { ascending: false }),
    sb.from('band_quotes')
      .select('quote_text, source_name, source_url')
      .eq('band_id', band.id)
      .order('id'),
    sb.from('band_videos')
      .select('video_url')
      .eq('band_id', band.id)
      .order('display_order'),
  ]);

  // Fetch SoundCloud oEmbed if URL exists
  let soundcloudEmbed = null;
  if (band.soundcloud_url) {
    soundcloudEmbed = await fetchSoundcloudEmbed(band.soundcloud_url);
  }

  currentEpkBand = band;
  currentEpkData = {
    reviews:        reviewsRes.data   || [],
    pressPhotos:    photosRes.data    || [],
    quotes:         quotesRes.data    || [],
    videos:         videosRes.data    || [],
    soundcloudEmbed,
  };

  // If owner has no theme set, show theme selector
  if (isOwner && !band.epk_theme) {
    ['epkTpvNameClean','epkTpvNameBold','epkTpvNameVibrant'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.textContent = band.band_name;
    });
    document.getElementById('themeSelectOverlay').classList.add('open');
  }

  // Contact modal click-outside
  const contactModalEl = document.getElementById('contactModal');
  if (contactModalEl) {
    contactModalEl.addEventListener('click', function(e) {
      if (e.target === this) closeContactModal();
    });
  }

  renderEPK(band, currentEpkData);
  document.body.style.visibility = 'visible';
});

// ── Theme overlay ─────────────────────────────────────────────────────────────

function openThemeSelectOverlay() {
  if (!currentEpkBand) return;
  ['epkTpvNameClean','epkTpvNameBold','epkTpvNameVibrant'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = currentEpkBand.band_name;
  });
  document.querySelectorAll('.theme-select-btn').forEach(b => {
    b.textContent = 'Select →';
    b.disabled    = false;
  });
  document.getElementById('themeSelectOverlay').classList.add('open');
}

function closeThemeSelectOverlay() {
  document.getElementById('themeSelectOverlay').classList.remove('open');
}

async function selectTheme(theme) {
  if (!currentEpkBand || !currentUser) return;

  const btn = document.querySelector(`.theme-select-btn-${theme}`);
  if (btn) { btn.textContent = 'Saving…'; btn.disabled = true; }

  const { data, error } = await sb.from('bands')
    .update({ epk_theme: theme })
    .eq('email', currentUser.email)
    .select();

  devLog('[epk] selectTheme — data:', data, 'error:', error ? JSON.stringify(error) : null);

  if (error) {
    showToast('Could not save theme — ' + error.message, 'error');
    if (btn) { btn.textContent = 'Select →'; btn.disabled = false; }
    return;
  }

  currentEpkBand.epk_theme = theme;
  closeThemeSelectOverlay();

  // Fade out → swap theme → fade in
  const mount = document.getElementById('epkMount');
  mount.classList.add('epkt-fading');
  await new Promise(r => setTimeout(r, 260));
  document.body.setAttribute('data-epk-theme', theme);
  renderEPK(currentEpkBand, currentEpkData);
  mount.classList.remove('epkt-fading');

  showToast('Theme updated', 'success');
}

// ── EPK Share ─────────────────────────────────────────────────────────────────

function shareEPK() {
  const url = window.location.href;
  if (navigator.clipboard) {
    navigator.clipboard.writeText(url)
      .then(() => showToast('Link copied!', 'success'))
      .catch(() => fallbackCopy(url));
  } else {
    fallbackCopy(url);
  }
}

function fallbackCopy(text) {
  const el = document.createElement('input');
  el.value = text;
  document.body.appendChild(el);
  el.select();
  document.execCommand('copy');
  document.body.removeChild(el);
  showToast('Link copied!', 'success');
}

// ── Main render ───────────────────────────────────────────────────────────────

// Tracks section index for alternating BG classes (bold + vibrant themes)
let _sectionIdx = 0;

function renderEPK(band, data) {
  const theme = band.epk_theme || 'clean';
  document.body.setAttribute('data-epk-theme', theme);
  _sectionIdx = 0;

  const sections = [
    buildHero(band),
    band.bio               ? buildSection('About',                  buildBio(band), theme)           : '',
    hasMusicContent(band)  ? buildSection('Music',                  buildMusic(band, data.soundcloudEmbed), theme) : '',
    data.videos.length     ? buildSection('Live Video',             buildVideos(data.videos), theme)  : '',
    data.pressPhotos.length? buildSection('Press Photos',           buildPressPhotos(data.pressPhotos, band.band_name), theme) : '',
    data.quotes.length     ? buildSection('Press & Media',          buildQuotes(data.quotes, theme), theme) : '',
    data.reviews.length    ? buildSection('On the Road',            buildReviews(data.reviews), theme) : '',
    band.stage_plot_url    ? buildSection('Stage Plot & Tech Rider',buildStagePlot(band), theme)      : '',
    buildBooking(band, theme),
    buildFooter(theme),
  ].join('');

  document.getElementById('epkMount').innerHTML = `<div class="epkt-wrap">${sections}</div>`;
  window._epkPressPhotos = data.pressPhotos;
}

// ── Section helpers ───────────────────────────────────────────────────────────

function buildSection(label, innerHtml, theme) {
  const idx = _sectionIdx++;
  const isAlt = (theme === 'bold' || theme === 'vibrant') && idx % 2 === 1;
  const altClass = isAlt ? ' epkt-section-alt' : '';

  // Vibrant alt sections need an inner wrapper for centered padding
  if (theme === 'vibrant' && isAlt) {
    return `<div class="epkt-section${altClass}">
      <div class="epkt-section-inner">
        <div class="epkt-section-label">${escHtml(label)}</div>
        ${innerHtml}
      </div>
    </div>`;
  }

  return `<div class="epkt-section${altClass}">
    <div class="epkt-section-label">${escHtml(label)}</div>
    ${innerHtml}
  </div>`;
}

// ── Hero ──────────────────────────────────────────────────────────────────────

function buildHero(band) {
  const theme   = band.epk_theme || 'clean';
  const initial = (band.band_name || 'B')[0].toUpperCase();
  const photoHtml = band.profile_photo_url
    ? `<img src="${band.profile_photo_url}" class="epkt-photo" alt="${escHtml(band.band_name)}">`
    : `<div class="epkt-photo-init">${initial}</div>`;
  const genreCity = [band.genre, band.home_city].filter(Boolean).map(escHtml).join(' · ');
  const links     = buildSocialLinks(band);
  const linksHtml = links ? `<div class="epkt-social-links">${links}</div>` : '';

  if (theme === 'clean') {
    return `<div class="epkt-hero">
      <div class="epkt-eyebrow">Electronic Press Kit</div>
      <h1 class="epkt-band-name">${escHtml(band.band_name)}</h1>
      <div class="epkt-hero-rule"></div>
      <div class="epkt-genre-city">${genreCity}</div>
      ${photoHtml}
      ${linksHtml}
    </div>`;
  }

  if (theme === 'bold') {
    return `<div class="epkt-hero">
      <div class="epkt-hero-text">
        <div class="epkt-eyebrow">Electronic Press Kit</div>
        <h1 class="epkt-band-name">${escHtml(band.band_name)}</h1>
        <div class="epkt-genre-city">${genreCity}</div>
        ${linksHtml}
      </div>
      ${photoHtml}
    </div>`;
  }

  // vibrant
  return `<div class="epkt-hero">
    <div class="epkt-eyebrow">Electronic Press Kit</div>
    ${photoHtml}
    <h1 class="epkt-band-name">${escHtml(band.band_name)}</h1>
    <div class="epkt-genre-city">${genreCity}</div>
    ${linksHtml}
  </div>`;
}

function buildSocialLinks(band) {
  const btns = [];
  if (band.spotify_url)    btns.push(`<a href="${band.spotify_url}" target="_blank" rel="noopener" class="epkt-link-btn epkt-link-spotify">Spotify</a>`);
  if (band.instagram_url)  btns.push(`<a href="${band.instagram_url}" target="_blank" rel="noopener" class="epkt-link-btn epkt-link-instagram">Instagram</a>`);
  if (band.tiktok_url)     btns.push(`<a href="${band.tiktok_url}" target="_blank" rel="noopener" class="epkt-link-btn epkt-link-tiktok">TikTok</a>`);
  if (band.facebook_url)   btns.push(`<a href="${band.facebook_url}" target="_blank" rel="noopener" class="epkt-link-btn epkt-link-facebook">Facebook</a>`);
  if (band.website)        btns.push(`<a href="${band.website}" target="_blank" rel="noopener" class="epkt-link-btn epkt-link-website">Website</a>`);
  return btns.join('');
}

// ── About / Bio ───────────────────────────────────────────────────────────────

function buildBio(band) {
  return `<div class="epkt-bio">${escHtml(band.bio)}</div>`;
}

// ── Music ─────────────────────────────────────────────────────────────────────

function hasMusicContent(band) {
  return band.spotify_url || band.youtube_url || band.soundcloud_url ||
         band.apple_music_url || band.bandcamp_url;
}

function buildMusic(band, soundcloudEmbed) {
  const parts = [];

  // Spotify embed
  const spEmbed = spotifyToEmbed(band.spotify_url);
  if (spEmbed) {
    parts.push(`<div class="epkt-embed-wrap epkt-embed-spotify">
      <iframe src="${spEmbed}" width="100%" height="152" frameborder="0" allowtransparency="true" allow="encrypted-media" loading="lazy"></iframe>
    </div>`);
  }

  // YouTube embed
  const ytEmbed = youtubeToEmbed(band.youtube_url);
  if (ytEmbed) {
    parts.push(`<div class="epkt-embed-wrap epkt-embed-video">
      <iframe src="${ytEmbed}" width="100%" height="360" frameborder="0" allowfullscreen loading="lazy"></iframe>
    </div>`);
  }

  // SoundCloud embed (pre-fetched HTML)
  if (soundcloudEmbed) {
    parts.push(`<div class="epkt-embed-wrap epkt-embed-sc">${soundcloudEmbed}</div>`);
  }

  // Link buttons for Apple Music / Bandcamp
  const linkBtns = [];
  if (band.apple_music_url) linkBtns.push(`<a href="${band.apple_music_url}" target="_blank" rel="noopener" class="epkt-music-link-btn epkt-music-link-apple">Apple Music</a>`);
  if (band.bandcamp_url)    linkBtns.push(`<a href="${band.bandcamp_url}"    target="_blank" rel="noopener" class="epkt-music-link-btn epkt-music-link-bc">Bandcamp</a>`);
  if (linkBtns.length) {
    parts.push(`<div class="epkt-music-links">${linkBtns.join('')}</div>`);
  }

  return parts.join('');
}

// ── Live Video ────────────────────────────────────────────────────────────────

function buildVideos(videos) {
  return videos.map(v => {
    const embed = videoToEmbed(v.video_url);
    if (!embed) return '';
    return `<div class="epkt-embed-wrap epkt-embed-video" style="margin-bottom:20px">
      <iframe src="${embed}" width="100%" height="360" frameborder="0" allowfullscreen loading="lazy"></iframe>
    </div>`;
  }).filter(Boolean).join('');
}

// ── Press Photos ──────────────────────────────────────────────────────────────

function buildPressPhotos(photos, bandName) {
  const grid = photos.map(p => `
    <a href="${p.photo_url}" target="_blank" rel="noopener" class="epkt-press-photo-wrap">
      <img src="${p.photo_url}" class="epkt-press-photo" alt="${escHtml(bandName)} press photo" loading="lazy">
    </a>`).join('');

  return `<div class="epkt-press-grid">${grid}</div>
    <button class="epkt-download-all-btn" onclick="downloadAllPhotos()">Download All Photos →</button>`;
}

// ── Press Quotes ──────────────────────────────────────────────────────────────

function buildQuotes(quotes, theme) {
  return quotes.map(q => {
    const sourceHtml = q.source_url
      ? `<a href="${q.source_url}" target="_blank" rel="noopener" class="epkt-quote-attr">${escHtml(q.source_name || 'Source')}</a>`
      : (q.source_name ? `<span class="epkt-quote-attr">${escHtml(q.source_name)}</span>` : '');
    // Clean: wrap text in quotes via CSS pseudo; Bold/Vibrant: the ::before handles the decorative mark
    const text = escHtml(q.quote_text);
    const quotedText = theme === 'clean' ? `\u201C${text}\u201D` : text;
    return `<div class="epkt-quote">
      <div class="epkt-quote-text">${quotedText}</div>
      ${sourceHtml ? `<div class="epkt-quote-source">${sourceHtml}</div>` : ''}
    </div>`;
  }).join('');
}

// ── Reviews ───────────────────────────────────────────────────────────────────

function buildReviews(reviews) {
  return reviews.map(r => {
    const stars = '★'.repeat(r.overall_rating || 0) + '☆'.repeat(5 - (r.overall_rating || 0));
    const d     = new Date(r.created_at);
    const date  = `${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`;
    return `<div class="epkt-review">
      <div class="epkt-review-header">
        <div class="epkt-review-venue">${escHtml(r.venue_name || 'Venue')}</div>
        <div class="epkt-review-stars">${stars}</div>
      </div>
      <div class="epkt-review-meta">${date}</div>
      ${r.review_text ? `<div class="epkt-review-text">${escHtml(r.review_text)}</div>` : ''}
    </div>`;
  }).join('');
}

// ── Stage Plot ────────────────────────────────────────────────────────────────

function buildStagePlot(band) {
  return `<p class="epkt-stage-desc">Download our stage plot and technical requirements for production and venue staff.</p>
    <a href="${band.stage_plot_url}" target="_blank" rel="noopener" class="epkt-pdf-btn">Download Stage Plot PDF →</a>`;
}

// ── Booking CTA ───────────────────────────────────────────────────────────────

function buildBooking(band, theme) {
  const safeSlug     = escHtml(band.band_name);
  const bandJsonName = JSON.stringify(band.band_name);
  const bandJsonCity = JSON.stringify(band.home_city || '');

  // Bold: full-width rust section — must break out of wrap padding in CSS
  // Vibrant: gold BG, dark green text — handled in CSS
  return `<div class="epkt-book">
    <div class="epkt-book-title">Book ${safeSlug}</div>
    <div class="epkt-book-sub">Interested in booking this band for your venue or festival? Get in touch directly.</div>
    <button class="epkt-book-btn" onclick="openContactModal('',${bandJsonName},${bandJsonCity})">Contact About Booking →</button>
  </div>`;
}

// ── Footer ────────────────────────────────────────────────────────────────────

function buildFooter(theme) {
  return `<div class="epkt-footer">
    <a href="index.html">Powered by Bandmate — the venue guide built for bands</a>
  </div>`;
}

// ── Not found ─────────────────────────────────────────────────────────────────

function renderNotFound(msg) {
  document.getElementById('epkMount').innerHTML = `
    <div class="epkt-wrap epkt-not-found-wrap">
      <div class="epk-not-found">
        <div class="epk-not-found-title">EPK not available</div>
        <div class="epk-not-found-sub">${escHtml(msg)}</div>
        <a href="index.html" style="display:inline-block;margin-top:20px;font-family:'Space Mono',monospace;font-size:0.58rem;text-transform:uppercase;letter-spacing:0.1em;color:var(--rust)">← Back to Bandmate</a>
      </div>
    </div>`;
}

// ── Download all press photos ─────────────────────────────────────────────────

async function downloadAllPhotos() {
  const photos = window._epkPressPhotos || [];
  if (!photos.length) return;
  showToast(`Downloading ${photos.length} photo${photos.length !== 1 ? 's' : ''}…`);
  for (let i = 0; i < photos.length; i++) {
    try {
      const res  = await fetch(photos[i].photo_url);
      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      a.download = `press-photo-${i + 1}.jpg`;
      a.click();
      URL.revokeObjectURL(url);
      if (i < photos.length - 1) await new Promise(r => setTimeout(r, 400));
    } catch (_) {}
  }
  showToast('Download complete', 'success');
}

// ── URL conversion helpers ────────────────────────────────────────────────────

function spotifyToEmbed(url) {
  if (!url) return null;
  const m = url.match(/open\.spotify\.com\/(artist|track|album|playlist)\/([a-zA-Z0-9]+)/);
  return m ? `https://open.spotify.com/embed/${m[1]}/${m[2]}?utm_source=generator` : null;
}

function youtubeToEmbed(url) {
  if (!url) return null;
  const m = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
  return m ? `https://www.youtube.com/embed/${m[1]}` : null;
}

function vimeoToEmbed(url) {
  if (!url) return null;
  const m = url.match(/vimeo\.com\/(\d+)/);
  return m ? `https://player.vimeo.com/video/${m[1]}` : null;
}

function videoToEmbed(url) {
  return youtubeToEmbed(url) || vimeoToEmbed(url);
}

async function fetchSoundcloudEmbed(url) {
  if (!url) return null;
  try {
    const res = await fetch(`https://soundcloud.com/oembed?url=${encodeURIComponent(url)}&format=json&maxwidth=700`);
    if (!res.ok) return null;
    const data = await res.json();
    return data.html || null;
  } catch (_) { return null; }
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function escHtml(str) {
  return (str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
