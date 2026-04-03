// Supabase config
const SUPABASE_URL = 'https://nyqilsmzbzmbndkwaypl.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im55cWlsc216YnptYm5ka3dheXBsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ5NjY4MDQsImV4cCI6MjA5MDU0MjgwNH0.go1KzmrMCEVIFL4O9n4NYYmwx3qCGg7veTvj1AhH8Cs';
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

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
  document.getElementById('authModal').classList.add('open');
  if (tab === 'login') switchAuthTab('login');
  else switchAuthTab('signup');
  return false;
}

function closeAuth() {
  document.getElementById('authModal').classList.remove('open');
  document.getElementById('authMsg').className = 'auth-msg';
}

function switchAuthTab(tab) {
  document.querySelectorAll('.auth-tab').forEach((t, i) =>
    t.classList.toggle('active', (i === 0 && tab === 'signup') || (i === 1 && tab === 'login'))
  );
  document.getElementById('signupForm').style.display = tab === 'signup' ? 'block' : 'none';
  document.getElementById('loginForm').style.display  = tab === 'login'  ? 'block' : 'none';
}

async function handleSignup() {
  const bandName = document.getElementById('signupBandName').value.trim();
  const genre    = document.getElementById('signupGenre').value;
  const city     = document.getElementById('signupCity').value.trim();
  const email    = document.getElementById('signupEmail').value.trim();
  const password = document.getElementById('signupPassword').value;
  if (!bandName || !genre || !city || !email || !password) {
    showAuthMsg('Please fill in all fields', 'error'); return;
  }
  if (password.length < 6) { showAuthMsg('Password must be at least 6 characters', 'error'); return; }
  const { error } = await sb.auth.signUp({ email, password });
  if (error) { showAuthMsg(error.message, 'error'); return; }
  await sb.from('bands').insert({ email, band_name: bandName, genre, home_city: city, is_premium: false });
  showAuthMsg('Welcome to Bandmate! Check your email to confirm.', 'success');
  setTimeout(() => closeAuth(), 2500);
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
  el.textContent = msg;
  el.className = 'auth-msg ' + type;
}

// Shared toast utility used by auth.js, map.js, reviews.js
function showToast(msg, type = '') {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.className = 'toast ' + type;
  setTimeout(() => toast.classList.add('show'), 10);
  setTimeout(() => toast.classList.remove('show'), 3500);
}

document.getElementById('authModal').addEventListener('click', function(e) {
  if (e.target === this) closeAuth();
});
