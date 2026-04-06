// Supabase config — credentials come from config.js (gitignored)
const sb = supabase.createClient(BANDMATE_SUPABASE_URL, BANDMATE_SUPABASE_KEY);

// Development logging — only active when BANDMATE_DEV=true in config.js
function devLog(...args) {
  if (typeof BANDMATE_DEV !== 'undefined' && BANDMATE_DEV) console.log(...args);
}

// Shared auth state (referenced by reviews.js)
let currentUser = null;
let currentBandProfile = null;

async function initAuth() {
  const { data: { session } } = await sb.auth.getSession();
  if (session) { currentUser = session.user; await loadBandProfile(); updateNavAuth(); }
  sb.auth.onAuthStateChange(async (event, session) => {
    currentUser = session ? session.user : null;
    if (currentUser) await loadBandProfile(); else currentBandProfile = null;
    updateNavAuth();
  });
}

async function loadBandProfile() {
  if (!currentUser) return;
  const { data } = await sb.from('bands').select('*').eq('email', currentUser.email).single();
  currentBandProfile = data;
}

// Single source of truth for premium logic.
// Accepts any object shaped like a bands row.
// Campers always gets god-mode access regardless of review count or flag.
function isBandPremium(profile) {
  if (!profile) return false;
  if (profile.band_name === 'Campers') return true;
  return profile.is_premium === true || (profile.review_count || 0) >= 5;
}

function updateNavAuth() {
  const area = document.getElementById('navAuthArea');
  if (!area) return;
  if (currentUser && currentBandProfile) {
    const isPremium   = isBandPremium(currentBandProfile);
    const reviewCount = currentBandProfile.review_count || 0;
    const statusHtml  = isPremium
      ? `<span class="nav-premium-badge">Community Premium</span>`
      : `<span class="nav-review-progress">${reviewCount} of 5 reviews to unlock premium</span>`;
    const avatarHtml  = currentBandProfile.photo_url
      ? `<img src="${currentBandProfile.photo_url}" class="nav-avatar" alt="">`
      : `<div class="nav-avatar nav-avatar-init">${(currentBandProfile.band_name || 'B')[0].toUpperCase()}</div>`;
    area.innerHTML = `<div class="nav-user">
      <a href="profile.html" class="nav-user-link">${avatarHtml}<span class="nav-user-name">${currentBandProfile.band_name}</span></a>
      ${statusHtml}
      <button class="nav-signout" onclick="handleSignout()">Sign Out</button>
    </div>`;
  } else {
    area.innerHTML = `<a href="#" style="font-family:'Space Mono',monospace;font-size:0.68rem;text-transform:uppercase;letter-spacing:0.12em;color:var(--muted);text-decoration:none;" onclick="openAuth('login')">Log In</a>
      <a href="#" class="nav-cta" onclick="openAuth('signup')">Join Free</a>`;
  }
}

// Returns true if the given band has premium access.
// Uses cached currentBandProfile for the current user to avoid an extra query.
async function checkPremiumAccess(band_id) {
  if (currentBandProfile && currentBandProfile.id === band_id) {
    return isBandPremium(currentBandProfile);
  }
  const { data } = await sb.from('bands').select('band_name, is_premium, review_count').eq('id', band_id).single();
  if (!data) return false;
  return isBandPremium(data);
}

function openAuth(tab) {
  const modal = document.getElementById('authModal');
  if (!modal) return false;
  modal.classList.add('open');
  if (tab === 'login') switchAuthTab('login');
  else { switchAuthTab('signup'); loadGenreChips('signupGenreChips'); }
  return false;
}

function closeAuth() {
  const modal = document.getElementById('authModal');
  if (modal) modal.classList.remove('open');
  const msg = document.getElementById('authMsg');
  if (msg) msg.className = 'auth-msg';
}

function switchAuthTab(tab) {
  document.querySelectorAll('.auth-tab').forEach((t, i) =>
    t.classList.toggle('active', (i === 0 && tab === 'signup') || (i === 1 && tab === 'login'))
  );
  const signupForm = document.getElementById('signupForm');
  const loginForm  = document.getElementById('loginForm');
  if (signupForm) signupForm.style.display = tab === 'signup' ? 'block' : 'none';
  if (loginForm)  loginForm.style.display  = tab === 'login'  ? 'block' : 'none';
  if (tab === 'signup') loadGenreChips('signupGenreChips');
}

async function handleSignup() {
  const bandName = document.getElementById('signupBandName').value.trim();
  const genre    = getSelectedGenres('signupGenreChips').join(', ');
  const city     = document.getElementById('signupCity').value.trim();
  const email    = document.getElementById('signupEmail').value.trim();
  const password = document.getElementById('signupPassword').value;
  if (!bandName || !genre || !city || !email || !password) {
    showAuthMsg('Please fill in all fields — select at least one genre', 'error'); return;
  }
  if (password.length < 6) { showAuthMsg('Password must be at least 6 characters', 'error'); return; }
  const { error } = await sb.auth.signUp({ email, password });
  if (error) { showAuthMsg(error.message, 'error'); return; }
  await sb.from('bands').insert({ email, band_name: bandName, genre, home_city: city, is_premium: false });
  showAuthMsg('Welcome to Bandmate! Check your email to confirm.', 'success');
  setTimeout(() => closeAuth(), 2500);
}

// ── Genre chip picker ─────────────────────────────────────────────────────────

let _genreCache   = null;   // cached list of genre names sorted by popularity
const _genreState = {};     // containerId → Set of selected names

async function loadGenreChips(containerId) {
  const el = document.getElementById(containerId);
  if (!el) return;
  const max = parseInt(el.dataset.max) || 3;

  if (!_genreCache) {
    el.innerHTML = '<div class="genre-chips-loading">Loading…</div>';
    const { data } = await sb.from('genres').select('name').order('count', { ascending: false }).limit(40);
    _genreCache = (data || []).map(g => g.name);
  }

  _genreState[containerId] = _genreState[containerId] || new Set();
  renderGenreChips(containerId, max);
}

function renderGenreChips(containerId, max) {
  const el  = document.getElementById(containerId);
  if (!el || !_genreCache) return;
  const sel = _genreState[containerId] || new Set();
  el.innerHTML = _genreCache.map(name => {
    const safeName = name.replace(/'/g, "\\'");
    const active   = sel.has(name) ? 'genre-chip-active' : '';
    return `<button type="button" class="genre-chip ${active}"
      onclick="toggleGenreChip('${containerId}',this,'${safeName}',${max})">${name}</button>`;
  }).join('');
}

function toggleGenreChip(containerId, btn, name, max) {
  const sel = _genreState[containerId] = _genreState[containerId] || new Set();
  if (sel.has(name)) {
    sel.delete(name);
    btn.classList.remove('genre-chip-active');
  } else {
    if (sel.size >= max) {
      showToast(`Select up to ${max} genre${max !== 1 ? 's' : ''}`, 'error');
      return;
    }
    sel.add(name);
    btn.classList.add('genre-chip-active');
  }
}

function getSelectedGenres(containerId) {
  return Array.from(_genreState[containerId] || []);
}

function preselectGenres(containerId, genreStr) {
  if (!genreStr) return;
  const names = genreStr.split(',').map(s => s.trim()).filter(Boolean);
  const sel   = _genreState[containerId] = _genreState[containerId] || new Set();
  names.forEach(n => sel.add(n));
  const el = document.getElementById(containerId);
  if (!el) return;
  el.querySelectorAll('.genre-chip').forEach(chip => {
    if (sel.has(chip.textContent.trim())) chip.classList.add('genre-chip-active');
    else chip.classList.remove('genre-chip-active');
  });
}

async function addCustomGenreFromInput(containerId) {
  const inputId = containerId.replace('Chips', 'CustomInput');
  const inputEl = document.getElementById(inputId);
  const name    = (inputEl?.value || '').trim();
  if (!name) return;

  const el  = document.getElementById(containerId);
  const max = parseInt(el?.dataset.max) || 3;

  // Upsert into genres table
  const { data: existing } = await sb.from('genres').select('id, count').ilike('name', name).maybeSingle();
  if (existing) {
    await sb.from('genres').update({ count: (existing.count || 1) + 1 }).eq('id', existing.id);
  } else {
    await sb.from('genres').insert({ name, count: 1 });
  }

  // Add to cache if new
  if (_genreCache && !_genreCache.find(n => n.toLowerCase() === name.toLowerCase())) {
    _genreCache.push(name);
  }

  // Re-render chips and auto-select the new one
  renderGenreChips(containerId, max);
  const sel = _genreState[containerId] = _genreState[containerId] || new Set();
  if (sel.size < max) {
    sel.add(name);
    // Find and highlight the chip
    el?.querySelectorAll('.genre-chip').forEach(chip => {
      if (chip.textContent.trim() === name) chip.classList.add('genre-chip-active');
    });
  }

  if (inputEl) inputEl.value = '';
}

async function handleLogin() {
  const email    = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;
  if (!email || !password) { showAuthMsg('Please enter email and password', 'error'); return; }
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (error) { showAuthMsg('Invalid email or password', 'error'); return; }
  showAuthMsg('Welcome back!', 'success');
  setTimeout(() => closeAuth(), 1000);
}

async function handleSignout() {
  await sb.auth.signOut();
  showToast('Signed out successfully.');
}

function showAuthMsg(msg, type) {
  const el = document.getElementById('authMsg');
  if (!el) return;
  el.textContent = msg;
  el.className = 'auth-msg ' + type;
}

// Shared toast utility used by auth.js, map.js, reviews.js
function showToast(msg, type = '') {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = msg;
  toast.className = 'toast ' + type;
  setTimeout(() => toast.classList.add('show'), 10);
  setTimeout(() => toast.classList.remove('show'), 3500);
}

const _authModalEl = document.getElementById('authModal');
if (_authModalEl) {
  _authModalEl.addEventListener('click', function(e) {
    if (e.target === this) closeAuth();
  });
}

// ── Contact venue modal (shared across index + tour) ──────────────────────────

async function openContactModal(placeId, name, address) {
  const modal = document.getElementById('contactModal');
  if (!modal) return;

  document.getElementById('modalVenueName').textContent    = name;
  document.getElementById('modalVenueAddress').textContent = address;

  // Show loading state, hide options
  document.getElementById('cmodalLoading').style.display  = 'block';
  document.getElementById('cmodalOptions').style.display  = 'none';
  modal.classList.add('open');

  // Build email body
  const subject = encodeURIComponent('Booking Inquiry — [Your Band Name]');
  const body    = encodeURIComponent(
    `Hi there,\n\nMy name is [Your Name] and I play in [Band Name], a [genre] band based in [Your City].\n\n` +
    `We're planning a tour through your area and would love to discuss playing at ${name}. ` +
    `We have a strong following and bring our own crowd wherever we go.\n\n` +
    `You can check out our music and press kit here: [Your EPK Link]\n\n` +
    `Would you have any open dates in [Month/Year]? We're flexible — opener, headliner, or shared bill.\n\n` +
    `Looking forward to hearing from you,\n[Your Name]\n[Band Name]\n[Phone Number]`
  );

  // Fetch website via Places API (best-effort)
  let website = null;
  if (placeId && typeof google !== 'undefined' && google.maps?.places) {
    try {
      const svc = new google.maps.places.PlacesService(document.createElement('div'));
      website = await new Promise(resolve => {
        svc.getDetails({ placeId, fields: ['website'] }, (result, status) => {
          resolve(status === google.maps.places.PlacesServiceStatus.OK ? (result?.website || null) : null);
        });
      });
    } catch (_) { website = null; }
  }

  // Facebook option — always shown
  document.getElementById('cmodalFbBtn').href = `https://www.facebook.com/search/top/?q=${encodeURIComponent(name)}`;
  document.getElementById('cmodalFbOption').style.display = 'block';

  // Email option — always shown (guessed address, user edits before sending)
  const emailGuess = `booking@${name.toLowerCase().replace(/[^a-z0-9]/g, '').substring(0, 20)}.com`;
  document.getElementById('cmodalEmailBtn').href = `mailto:${emailGuess}?subject=${subject}&body=${body}`;
  document.getElementById('cmodalEmailOption').style.display = 'block';

  // Website option — only if Places returned one
  if (website) {
    document.getElementById('cmodalWebBtn').href = website;
    document.getElementById('cmodalWebOption').style.display = 'block';
  } else {
    document.getElementById('cmodalWebOption').style.display = 'none';
  }

  document.getElementById('cmodalLoading').style.display = 'none';
  document.getElementById('cmodalOptions').style.display = 'block';
}

function closeContactModal() {
  const modal = document.getElementById('contactModal');
  if (modal) modal.classList.remove('open');
}
