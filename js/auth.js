// Supabase config — credentials come from config.js (gitignored)
const sb = supabase.createClient(BANDMATE_SUPABASE_URL, BANDMATE_SUPABASE_KEY);

// ── Instagram in-app browser detection ───────────────────────────────────────
// Instagram's IAB blocks Google Maps JS API and geolocation silently.
// Show a sticky banner prompting users to open in their real browser.
(function() {
  if (!/Instagram/.test(navigator.userAgent)) return;
  const banner = document.createElement('div');
  banner.id = 'iab-banner';
  banner.innerHTML = `
    <div style="
      position:fixed;top:0;left:0;right:0;z-index:99999;
      background:var(--ink,#0f0f0c);color:var(--paper,#f2efe6);
      font-family:'DM Sans',sans-serif;font-weight:300;font-size:12px;
      letter-spacing:0.06em;padding:10px 16px;
      display:flex;align-items:center;justify-content:space-between;gap:12px;
      border-bottom:1px solid rgba(255,255,255,0.1);">
      <span>For venue search &amp; maps, open in your browser</span>
      <a href="${window.location.href}"
         target="_blank"
         style="font-family:'DM Sans',sans-serif;font-weight:400;font-size:11px;
                letter-spacing:0.12em;text-transform:uppercase;color:var(--paper,#f2efe6);
                border:1px solid rgba(255,255,255,0.4);padding:5px 10px;
                text-decoration:none;white-space:nowrap;flex-shrink:0;">
        Open →
      </a>
    </div>`;
  document.body.insertAdjacentElement('afterbegin', banner);
  // Push page content down so banner doesn't overlap nav
  document.body.style.paddingTop = '42px';
})();

// Development logging — only active when BANDMATE_DEV=true in config.js
function devLog(...args) {
  if (typeof BANDMATE_DEV !== 'undefined' && BANDMATE_DEV) console.log(...args);
}

// Shared auth state (referenced by reviews.js)
let currentUser = null;
let currentBandProfile = null;
let _authSettled = false; // true once initAuth has resolved at least once

// ── Global keyboard shortcuts ─────────────────────────────────────────────────
document.addEventListener('keydown', e => {
  const tag = document.activeElement?.tagName;
  const inInput = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';

  // Escape — close the topmost open thing
  if (e.key === 'Escape') {
    if (document.getElementById('onboardingOverlay')) {
      dismissOnboarding?.(false); return;
    }
    if (document.getElementById('venuePage')?.classList.contains('open')) {
      window.closevenuePage?.(); return;
    }
    if (document.querySelector('.auth-modal-overlay.open, .auth-modal-overlay[style*="flex"]')) {
      closeAuth?.(); return;
    }
    if (document.getElementById('createTourModal')?.style.display === 'flex') {
      closeCreateTourModal?.(); return;
    }
    if (document.querySelector('.ct-modal-overlay')?.style.display === 'flex') {
      closeContactModal?.(); return;
    }
    if (typeof closePostModal === 'function') closePostModal();
  }

  // Enter — submit the active auth form
  if (e.key === 'Enter' && !e.shiftKey) {
    const loginForm  = document.getElementById('loginForm');
    const signupForm = document.getElementById('signupForm');
    if (loginForm?.style.display !== 'none' &&
        document.activeElement?.closest('#loginForm')) {
      e.preventDefault(); handleLogin?.();
    } else if (signupForm?.style.display !== 'none' &&
               document.activeElement?.closest('#signupForm')) {
      e.preventDefault(); handleSignup?.();
    }
  }

  // / — focus search (when not already in an input)
  if (e.key === '/' && !inInput) {
    e.preventDefault();
    const search = document.getElementById('locationInput') ||
                   document.getElementById('globeSearchInput');
    if (search) {
      search.focus();
      if (typeof openGlobeSearch === 'function') openGlobeSearch();
    }
  }
});

async function initAuth() {
  // Read session immediately from localStorage — fast and synchronous with storage.
  const { data: { session } } = await sb.auth.getSession();
  currentUser = session ? session.user : null;
  if (currentUser) {
    try { await loadBandProfile(); } catch (e) { console.warn('[auth] loadBandProfile:', e.message); }
  }
  _authSettled = true;
  updateNavAuth();

  // Keep listening for future auth changes (sign-in, sign-out, token refresh).
  // Guard: only reload the band profile when the user actually changes, not on
  // every TOKEN_REFRESHED — prevents the race where a second concurrent
  // loadBandProfile() call returns null and overwrites a good profile.
  sb.auth.onAuthStateChange(async (_event, session) => {
    const prevUserId = currentUser?.id;
    currentUser = session ? session.user : null;
    if (currentUser) {
      if (!currentBandProfile || currentUser.id !== prevUserId) {
        try { await loadBandProfile(); } catch (e) { console.warn('[auth] loadBandProfile:', e.message); }
      }
    } else {
      currentBandProfile = null;
    }
    _authSettled = true;
    updateNavAuth();
  });
}

async function loadBandProfile() {
  if (!currentUser) return;
  const { data } = await sb.from('bands').select('*').ilike('email', currentUser.email).order('created_at', { ascending: false }).limit(1);
  currentBandProfile = (data && data[0]) || null;
  devLog('[auth] loadBandProfile result:', currentBandProfile, 'for email:', currentUser.email);
  // Update last_seen_at — wrapped so errors never bubble up from loadBandProfile
  (async () => { try { await sb.rpc('update_band_last_seen', { band_email: currentUser.email }); } catch (_) {} })();
}

// Single source of truth for premium logic.
// Accepts any object shaped like a bands row.
// Campers always gets god-mode access regardless of review count or flag.
function isBandPremium(profile) {
  if (!profile) return false;
  return !!profile.is_premium || (profile.review_count || 0) >= 3;
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
  const { data: authData, error: authError } = await sb.auth.signUp({ email, password });
  if (authError) { showAuthMsg(authError.message, 'error'); return; }
  if (!authData?.user) { showAuthMsg('Account could not be created — please try again.', 'error'); return; }
  const { error: bandError } = await sb.from('bands').insert({ email, band_name: bandName, genre, home_city: city, is_premium: false });
  if (bandError) { showAuthMsg('Profile could not be saved — ' + bandError.message, 'error'); return; }
  // Band row now exists — reload profile so updateNavAuth sees it and triggers onboarding
  await loadBandProfile();
  updateNavAuth();
  showAuthMsg('Welcome to Bandmate! You can log in right away.', 'success');
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
  if (error) {
    showAuthMsg(error.message, 'error');
    return;
  }
  showAuthMsg('Welcome back!', 'success');
  setTimeout(() => closeAuth(), 1000);
}

async function resendConfirmation(email) {
  const { error } = await sb.auth.resend({ type: 'signup', email });
  if (error) {
    showAuthMsg('Could not resend — ' + error.message, 'error');
  } else {
    showAuthMsg('Confirmation email resent — check your inbox!', 'success');
  }
}

async function handleSignout() {
  await sb.auth.signOut();
  showToast('Signed out successfully.');
}

function showAuthMsg(msg, type) {
  const el = document.getElementById('authMsg');
  if (!el) return;
  el.innerHTML = msg;
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

// ── Premium Unlock Celebration ────────────────────────────────────────────────

function showUnlockCelebration(bandName) {
  // Inject modal if not already in DOM
  if (!document.getElementById('unlockCelebration')) {
    const el = document.createElement('div');
    el.id        = 'unlockCelebration';
    el.className = 'unlock-celebration';
    el.innerHTML = `
      <div class="unlock-inner">
        <button class="unlock-close" onclick="closeUnlockCelebration()">✕</button>
        <div class="unlock-badge">★</div>
        <div class="unlock-eyebrow">Community Premium Unlocked</div>
        <h2 class="unlock-title">You're in, ${escapeHtml(bandName || 'friend')}.</h2>
        <p class="unlock-sub">You've reviewed 3 venues — the community thanks you. Your full toolkit is now active.</p>
        <div class="unlock-features">
          <div class="unlock-feature">
            <div class="unlock-feature-icon">◈</div>
            <div>
              <div class="unlock-feature-label">EPK Builder</div>
              <div class="unlock-feature-desc">Build a shareable Electronic Press Kit with your music, photos, and press quotes.</div>
            </div>
          </div>
          <div class="unlock-feature">
            <div class="unlock-feature-icon">◎</div>
            <div>
              <div class="unlock-feature-label">Tour Planner</div>
              <div class="unlock-feature-desc">Map your route, find venues at each stop, and build a complete itinerary.</div>
            </div>
          </div>
        </div>
        <div class="unlock-actions">
          <a href="profile.html" class="unlock-btn-primary">Build Your EPK →</a>
          <a href="tour.html" class="unlock-btn-secondary">Plan a Tour →</a>
        </div>
        <div class="unlock-dismiss" onclick="closeUnlockCelebration()">Maybe later</div>
      </div>`;
    document.body.appendChild(el);
  }
  requestAnimationFrame(() => {
    document.getElementById('unlockCelebration').classList.add('open');
  });
}

function closeUnlockCelebration() {
  const el = document.getElementById('unlockCelebration');
  if (el) el.classList.remove('open');
}

// ── Nav auth ──────────────────────────────────────────────────────────────────

function _updatePremiumGate() {
  const gate = document.getElementById('premiumGate');
  if (!gate) return;
  // The community feed is viewable by all users.
  // Posting is gated inside openPostModal() which shows a locked-state modal for non-premium users.
  // Hiding the gate prevents it from covering the feed and the hero "Post an Opportunity" button.
  gate.style.display = 'none';
}

function updateNavAuth() {
  const area = document.getElementById('navAuthArea');
  if (!area) return;
  if (currentUser && !currentBandProfile) {
    area.innerHTML = `<div class="nav-user">
      <span class="nav-review-progress">${currentUser.email}</span>
      <button class="nav-signout" onclick="handleSignout()">Sign Out</button>
    </div>`;
    const mobileFooter = document.getElementById('mobileNavFooter');
    if (mobileFooter) {
      mobileFooter.innerHTML = `
        <div style="font-family:'DM Sans',sans-serif;font-size:0.9rem;color:rgba(245,240,232,0.7);padding:0 4px 8px">${currentUser.email}</div>
        <a href="#" class="mobile-nav-signup" onclick="closeMobileMenu();handleSignout()">Sign Out</a>
      `;
    }
    return;
  }
  if (currentUser && currentBandProfile) {
    const isPremium   = isBandPremium(currentBandProfile);
    const reviewCount = currentBandProfile.review_count || 0;
    const statusHtml  = isPremium
      ? ''
      : `<span class="nav-review-progress">${reviewCount} of 3 reviews to unlock features</span>`;
    const avatarHtml  = currentBandProfile.photo_url
      ? `<img src="${currentBandProfile.photo_url}" class="nav-avatar" alt="">`
      : `<div class="nav-avatar nav-avatar-init">${(currentBandProfile.band_name || 'B')[0].toUpperCase()}</div>`;
    area.innerHTML = `<div class="nav-user">
      <a href="profile.html" class="nav-user-link">${avatarHtml}<span class="nav-user-name">${currentBandProfile.band_name}</span></a>
      ${statusHtml}
      <button class="nav-bell" id="navBell" onclick="if(typeof toggleNotifTray==='function')toggleNotifTray()" aria-label="Notifications">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
        <span class="nav-bell-badge" id="navBellBadge" style="display:none"></span>
      </button>
      <button class="nav-signout" onclick="handleSignout()">Sign Out</button>
    </div>`;
    loadNotifCount();
    _subscribeToNotifications();
    // Update mobile nav footer — logged in with profile
    const mobileFooter = document.getElementById('mobileNavFooter');
    if (mobileFooter && currentBandProfile) {
      mobileFooter.innerHTML = `
        <div style="font-family:'DM Sans',sans-serif;font-size:0.9rem;color:rgba(245,240,232,0.7);padding:0 4px 8px">${currentBandProfile.band_name || ''}</div>
        <a href="profile.html" class="mobile-nav-login" onclick="closeMobileMenu()">My Profile</a>
        <a href="#" class="mobile-nav-signup" onclick="closeMobileMenu();handleSignout()">Sign Out</a>
      `;
    }
  } else {
    area.innerHTML = `<a href="#" style="font-family:'DM Sans',sans-serif;font-weight:300;font-size:8px;text-transform:uppercase;letter-spacing:0.2em;color:var(--grey);text-decoration:none;padding:0 18px;" onclick="openAuth('login')">Log In</a>
      <a href="#" class="nav-cta" onclick="openAuth('signup')">Join Free</a>`;
    // Reset mobile nav footer — logged out
    const mobileFooter = document.getElementById('mobileNavFooter');
    if (mobileFooter) {
      mobileFooter.innerHTML = `
        <a href="#" class="mobile-nav-login" onclick="closeMobileMenu();openAuth('login');return false">Log In</a>
        <a href="#" class="mobile-nav-signup" onclick="closeMobileMenu();openAuth('signup');return false">Join Free</a>
      `;
    }
  }
  _updatePremiumGate();

  // Show onboarding checklist — re-shows each login until permanently dismissed or all done
  if (currentUser && currentBandProfile &&
      !localStorage.getItem('bm_onboarding_done') &&
      !sessionStorage.getItem('bm_onboarding_later')) {
    setTimeout(() => showOnboardingChecklist(), 600);
  }
}

function _goToStep(url) {
  // Dismiss for this session and navigate — modal comes back next login with updated progress
  sessionStorage.setItem('bm_onboarding_later', '1');
  const el = document.getElementById('onboardingOverlay');
  if (el) { el.classList.remove('ob-visible'); setTimeout(() => el.remove(), 200); }
  setTimeout(() => { window.location.href = url; }, 150);
}

function showOnboardingChecklist() {
  if (document.getElementById('onboardingOverlay')) return;
  const bp = currentBandProfile || {};
  const reviews  = bp.review_count || 0;
  const hasEpk   = !!bp.epk_theme;
  const doneCount = [reviews >= 1, reviews >= 3, hasEpk, false].filter(Boolean).length;
  const allDone   = reviews >= 3 && hasEpk;

  // Auto-dismiss permanently when everything is complete
  if (allDone) { localStorage.setItem('bm_onboarding_done', '1'); return; }

  function step(color, label, sublabel, url, status) {
    const isDone   = status === 'done';
    const isLocked = status === 'locked';
    const need     = status === 'locked' ? `${3 - reviews} review${3 - reviews !== 1 ? 's' : ''} to unlock` : '';
    const statusTxt = isDone ? '✓ Complete' : isLocked ? `🔒 ${need}` : 'Tap to start →';
    const svgMap = {
      red:   `<svg viewBox="0 0 50 72" width="36" height="52" fill="none"><g style="animation:fcPinBounce 2.6s cubic-bezier(.4,0,.6,1) infinite;transform-origin:25px 68px"><circle cx="25" cy="22" r="14" stroke="rgba(248,245,238,0.7)" stroke-width="1.5"/><circle cx="25" cy="22" r="5" fill="rgba(248,245,238,0.7)"/><line x1="25" y1="36" x2="25" y2="60" stroke="rgba(248,245,238,0.7)" stroke-width="1.5"/></g><ellipse cx="25" cy="63" rx="7" ry="2" fill="rgba(248,245,238,0.18)"/></svg>`,
      olive: `<svg viewBox="0 0 60 44" width="48" height="36" fill="none"><g style="animation:fcDraw1 2.2s ease-in-out infinite"><polyline points="4,36 18,14 32,24 46,8 56,16" stroke="rgba(248,245,238,0.7)" stroke-width="1.5" fill="none"/></g><circle cx="46" cy="8" r="3" fill="rgba(248,245,238,0.7)"/></svg>`,
      teal:  `<svg viewBox="0 0 44 52" width="32" height="40" fill="none"><rect x="6" y="4" width="32" height="44" stroke="rgba(248,245,238,0.7)" stroke-width="1.5"/><line x1="13" y1="16" x2="31" y2="16" stroke="rgba(248,245,238,0.7)" stroke-width="1"/><line x1="13" y1="24" x2="31" y2="24" stroke="rgba(248,245,238,0.7)" stroke-width="1"/><line x1="13" y1="32" x2="24" y2="32" stroke="rgba(248,245,238,0.7)" stroke-width="1"/></svg>`,
      gold:  `<svg viewBox="0 0 60 44" width="48" height="36" fill="none"><g style="animation:fcConnectL 2.5s ease-in-out infinite"><circle cx="12" cy="22" r="8" stroke="rgba(248,245,238,0.7)" stroke-width="1.5"/></g><g style="animation:fcConnectR 2.5s ease-in-out infinite"><circle cx="48" cy="22" r="8" stroke="rgba(248,245,238,0.7)" stroke-width="1.5"/></g><line x1="20" y1="22" x2="40" y2="22" stroke="rgba(248,245,238,0.55)" stroke-width="1" stroke-dasharray="3 3"/></svg>`,
    };
    // Locked steps still navigate — to map.html so they can leave more reviews
    const dest = isLocked ? 'map.html' : url;
    return `<div class="ob-step ob-step--${color}${isDone?' ob-step--done':''}${isLocked?' ob-step--locked':''}"
                 onclick="_goToStep('${dest}')" role="link" tabindex="0"
                 onkeydown="if(event.key==='Enter')_goToStep('${dest}')">
      <div class="ob-anim">${svgMap[color]}</div>
      <div class="ob-label">${label}</div>
      <div class="ob-sub">${sublabel}</div>
      <div class="ob-status">${statusTxt}</div>
    </div>`;
  }

  const overlay = document.createElement('div');
  overlay.id = 'onboardingOverlay';
  overlay.className = 'onboarding-overlay';
  overlay.innerHTML = `
    <div class="onboarding-modal">
      <button class="ob-close" onclick="dismissOnboarding(false)" title="Remind me later">✕</button>
      <div class="ob-header">
        <div class="ob-title">Welcome, ${escapeHtml(bp.band_name || 'Band')}.</div>
        <div class="ob-subtitle">Tap a step to get started — this checklist updates as you go</div>
      </div>
      <div class="ob-grid">
        ${step('red',   'Find &amp; Review', 'Search venues near you and leave honest reviews.', 'map.html',       reviews >= 1 ? 'done' : 'open')}
        ${step('olive', 'Plan Your Tour',    'Build a full tour itinerary with venue contacts.',  'tour.html',      reviews >= 3 ? 'done' : 'locked')}
        ${step('teal',  'Build Your EPK',    'One link sends venues everything they need.',       'profile.html',   hasEpk       ? 'done' : 'open')}
        ${step('gold',  'Find Tour Partners','Connect with bands for openers and co-headliners.', 'community.html', 'open')}
      </div>
      <div class="ob-progress">
        <div class="ob-progress-bar" style="width:${Math.round(doneCount / 4 * 100)}%"></div>
      </div>
      <div class="ob-progress-label">${doneCount} of 4 steps complete · comes back each login until you're done</div>
      <div class="ob-footer-btns">
        <button class="ob-cta ob-cta--later" onclick="dismissOnboarding(false)">Remind me later</button>
        <button class="ob-cta" onclick="dismissOnboarding(true)">Got it, don't show again</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('ob-visible'));
}

function dismissOnboarding(permanent = false) {
  if (permanent) localStorage.setItem('bm_onboarding_done', '1');
  else           sessionStorage.setItem('bm_onboarding_later', '1');
  const el = document.getElementById('onboardingOverlay');
  if (!el) return;
  el.classList.remove('ob-visible');
  setTimeout(() => el.remove(), 300);
}

function escapeHtml(s) {
  return (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ─── Notifications (available on all pages; community.js overrides on /community) ──
let _notifTrayOpen    = false;
let _notifChannel     = null;
let _ntClickHandler   = null;

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
  if (_notifTrayOpen) { _closeNotifTray(); } else { _openNotifTray(); }
}

function _closeNotifTray() {
  const tray = document.getElementById('notifTray');
  if (tray) tray.classList.remove('open');
  _notifTrayOpen = false;
  if (_ntClickHandler) {
    document.removeEventListener('click', _ntClickHandler);
    _ntClickHandler = null;
  }
}

async function _openNotifTray() {
  if (!currentBandProfile) return;
  let tray = document.getElementById('notifTray');
  if (!tray) {
    tray = document.createElement('div');
    tray.id        = 'notifTray';
    tray.className = 'notif-tray';
    document.body.appendChild(tray);
  }
  const bell = document.getElementById('navBell');
  if (bell) {
    const rect = bell.getBoundingClientRect();
    tray.style.top   = (rect.bottom + 6) + 'px';
    tray.style.right = (window.innerWidth - rect.right) + 'px';
    tray.style.left  = 'auto';
  }
  _notifTrayOpen = true;
  tray.innerHTML = '<div class="notif-tray-loading">Loading…</div>';
  tray.classList.add('open');

  // Register click-outside handler fresh every open
  if (_ntClickHandler) document.removeEventListener('click', _ntClickHandler);
  _ntClickHandler = function(e) {
    const bell = document.getElementById('navBell');
    if (!document.getElementById('notifTray')?.contains(e.target) && !bell?.contains(e.target)) {
      _closeNotifTray();
    }
  };
  setTimeout(() => document.addEventListener('click', _ntClickHandler), 0);

  const { data: notifs } = await sb
    .from('notifications')
    .select('*')
    .eq('band_id', currentBandProfile.id)
    .order('created_at', { ascending: false })
    .limit(15);

  if ((notifs || []).some(n => !n.read)) {
    await sb.from('notifications').update({ read: true })
      .eq('band_id', currentBandProfile.id).eq('read', false);
    const badge = document.getElementById('navBellBadge');
    if (badge) badge.style.display = 'none';
  }
  _renderNotifTray(tray, notifs || []);
}

function _renderNotifTray(tray, notifs) {
  const typeIcon = {
    interest_received:   '◎',
    interest_accepted:   '✓',
    interest_declined:   '—',
    new_posting_nearby:  '↗',
    new_message:         '✉',
    message:             '✉',
    shared_itinerary:    '◉',
  };
  const itemsHtml = notifs.map(n => {
    const pl    = n.payload || {};
    const band  = pl.from_band || '';
    const city  = pl.city || '';
    const title = pl.posting_title || '';
    let desc;
    if (n.type === 'interest_received')     desc = `<strong>${escapeHtml(band)}</strong> expressed interest in your posting`;
    else if (n.type === 'interest_accepted') desc = `Your interest was accepted${city ? ' — ' + escapeHtml(city) : title ? ' — ' + escapeHtml(title) : ''}`;
    else if (n.type === 'interest_declined') desc = `Your interest was not accepted${title ? ' — ' + escapeHtml(title) : ''}`;
    else if (n.type === 'new_posting_nearby') desc = `<strong>${escapeHtml(band)}</strong> posted a new opportunity`;
    else if (n.type === 'new_message' || n.type === 'message') desc = `New message from <strong>${escapeHtml(band)}</strong>${pl.preview ? ': ' + escapeHtml(pl.preview.substring(0, 40)) + '…' : ''}`;
    else if (n.type === 'shared_itinerary') desc = `<strong>${escapeHtml(band)}</strong> shared a tour itinerary${pl.tour_name ? ': <em>' + escapeHtml(pl.tour_name) + '</em>' : ''}`;
    else desc = escapeHtml(n.type);

    const diffMs  = Date.now() - new Date(n.created_at).getTime();
    const diffMin = Math.floor(diffMs / 60000);
    const ago = diffMin < 1 ? 'just now' : diffMin < 60 ? `${diffMin}m ago` : diffMin < 1440 ? `${Math.floor(diffMin / 60)}h ago` : `${Math.floor(diffMin / 1440)}d ago`;
    const unreadClass = !n.read ? ' notif-item--unread' : '';
    const icon = typeIcon[n.type] || '·';
    const dest = (n.type === 'new_message' || n.type === 'message' || n.type === 'shared_itinerary') ? 'profile.html' : 'community.html';

    return `<div class="notif-item${unreadClass}" onclick="_closeNotifTray();window.location.href='${dest}'">
      <div class="notif-icon">${icon}</div>
      <div class="notif-body">
        <div class="notif-desc">${desc}</div>
        <div class="notif-time">${ago}</div>
      </div>
    </div>`;
  }).join('');

  tray.innerHTML = `
    <div class="notif-tray-header">
      <span class="notif-tray-title">Notifications</span>
      <button class="notif-tray-close" onclick="_closeNotifTray()">✕</button>
    </div>
    <div class="notif-list">${itemsHtml || '<div class="notif-tray-empty">Nothing here yet.</div>'}</div>`;
}

function _subscribeToNotifications() {
  if (!currentBandProfile) return;
  if (_notifChannel) { sb.removeChannel(_notifChannel); _notifChannel = null; }
  try {
    _notifChannel = sb.channel(`notif_${currentBandProfile.id}`)
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notifications',
          filter: `band_id=eq.${currentBandProfile.id}` },
        async () => { await loadNotifCount(); }
      )
      .subscribe();
  } catch (_) {}
}

// ─── Mobile Menu ─────────────────────────────────────────────────────────────
function openMobileMenu() {
  const overlay = document.getElementById('mobileNavOverlay');
  if (overlay) {
    overlay.style.display = 'flex';
    requestAnimationFrame(() => overlay.classList.add('open'));
    document.body.style.overflow = 'hidden';
  }
}
function closeMobileMenu() {
  const overlay = document.getElementById('mobileNavOverlay');
  if (overlay) {
    overlay.classList.remove('open');
    setTimeout(() => { overlay.style.display = ''; }, 320);
    document.body.style.overflow = '';
  }
}
window.openMobileMenu  = openMobileMenu;
window.closeMobileMenu = closeMobileMenu;
