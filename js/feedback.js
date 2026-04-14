// js/feedback.js — Beta feedback widget
// Requires: auth.js loaded first (provides sb, currentUser, currentBandProfile)

(function injectFeedbackStyles() {
  const style = document.createElement('style');
  style.textContent = `
/* ── Feedback trigger button ── */
.fb-trigger {
  position: fixed;
  bottom: 24px;
  right: 24px;
  z-index: 8000;
  display: flex;
  align-items: center;
  gap: 7px;
  background: var(--rust, #c94b2a);
  color: var(--cream, #f5f0e8);
  font-family: 'Space Mono', monospace;
  font-size: 0.6rem;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  border: none;
  border-radius: 100px;
  padding: 9px 16px 9px 13px;
  cursor: pointer;
  box-shadow: 0 2px 12px rgba(0,0,0,0.22);
  transition: background 0.18s, transform 0.15s, box-shadow 0.18s;
}
.fb-trigger:hover {
  background: #b83f22;
  transform: translateY(-1px);
  box-shadow: 0 4px 18px rgba(0,0,0,0.28);
}
.fb-trigger svg { flex-shrink: 0; }

/* ── Feedback modal overlay ── */
.fb-overlay {
  position: fixed;
  inset: 0;
  z-index: 9000;
  background: rgba(14,13,11,0.55);
  backdrop-filter: blur(4px);
  display: none;
  align-items: center;
  justify-content: center;
  padding: 24px;
}
.fb-overlay.open { display: flex; }

.fb-modal {
  background: var(--cream, #f5f0e8);
  width: 100%;
  max-width: 480px;
  padding: 32px;
  position: relative;
  box-shadow: 0 8px 40px rgba(0,0,0,0.28);
  animation: fb-slide-up 0.22s ease;
}
@keyframes fb-slide-up {
  from { opacity: 0; transform: translateY(12px); }
  to   { opacity: 1; transform: translateY(0); }
}

.fb-close {
  position: absolute;
  top: 14px; right: 16px;
  background: none;
  border: none;
  font-size: 1.1rem;
  color: var(--muted, #8a8278);
  cursor: pointer;
  line-height: 1;
  padding: 4px;
}
.fb-close:hover { color: var(--ink, #0e0d0b); }

.fb-heading {
  font-family: 'DM Serif Display', serif;
  font-size: 1.5rem;
  color: var(--ink, #0e0d0b);
  margin: 0 0 4px;
}
.fb-sub {
  font-family: 'Space Mono', monospace;
  font-size: 0.55rem;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  color: var(--muted, #8a8278);
  margin: 0 0 22px;
}

/* Category buttons */
.fb-cats {
  display: flex;
  gap: 8px;
  margin-bottom: 18px;
  flex-wrap: wrap;
}
.fb-cat {
  font-family: 'Space Mono', monospace;
  font-size: 0.58rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  background: none;
  border: 1.5px solid var(--border, rgba(14,13,11,0.18));
  color: var(--ink, #0e0d0b);
  padding: 7px 14px;
  cursor: pointer;
  border-radius: 100px;
  transition: background 0.15s, border-color 0.15s, color 0.15s;
}
.fb-cat:hover,
.fb-cat.active {
  background: var(--rust, #c94b2a);
  border-color: var(--rust, #c94b2a);
  color: var(--cream, #f5f0e8);
}

/* Textarea */
.fb-textarea {
  width: 100%;
  min-height: 100px;
  border: 1.5px solid var(--border, rgba(14,13,11,0.18));
  background: #fff;
  font-family: 'Outfit', sans-serif;
  font-size: 0.88rem;
  color: var(--ink, #0e0d0b);
  padding: 12px 14px;
  resize: vertical;
  outline: none;
  transition: border-color 0.15s;
  box-sizing: border-box;
  margin-bottom: 12px;
}
.fb-textarea:focus { border-color: var(--rust, #c94b2a); }
.fb-textarea::placeholder { color: var(--muted, #8a8278); }

/* Email field */
.fb-email-label {
  font-family: 'Space Mono', monospace;
  font-size: 0.55rem;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--muted, #8a8278);
  display: block;
  margin-bottom: 6px;
}
.fb-email-input {
  width: 100%;
  border: 1.5px solid var(--border, rgba(14,13,11,0.18));
  background: #fff;
  font-family: 'Outfit', sans-serif;
  font-size: 0.88rem;
  color: var(--ink, #0e0d0b);
  padding: 9px 12px;
  outline: none;
  transition: border-color 0.15s;
  box-sizing: border-box;
  margin-bottom: 18px;
}
.fb-email-input:focus { border-color: var(--rust, #c94b2a); }
.fb-email-input::placeholder { color: var(--muted, #8a8278); }

/* Submit button */
.fb-submit {
  width: 100%;
  background: var(--rust, #c94b2a);
  color: var(--cream, #f5f0e8);
  font-family: 'Space Mono', monospace;
  font-size: 0.65rem;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  border: none;
  padding: 13px 20px;
  cursor: pointer;
  transition: background 0.18s;
}
.fb-submit:hover { background: #b83f22; }
.fb-submit:disabled { opacity: 0.6; cursor: not-allowed; }

/* Success state */
.fb-success {
  text-align: center;
  padding: 16px 0 8px;
}
.fb-success-icon {
  font-size: 2rem;
  margin-bottom: 12px;
}
.fb-success-title {
  font-family: 'DM Serif Display', serif;
  font-size: 1.3rem;
  color: var(--ink, #0e0d0b);
  margin-bottom: 8px;
}
.fb-success-msg {
  font-family: 'Outfit', sans-serif;
  font-size: 0.88rem;
  color: var(--muted, #8a8278);
  line-height: 1.6;
}
  `;
  document.head.appendChild(style);
})();

// ── State ──────────────────────────────────────────────────────────────────────
let _fbCategory = null;

const FB_PLACEHOLDERS = {
  'Bug Report':        "What happened? What were you trying to do?",
  'Feature Request':   "What would make Bandmate more useful for you?",
  'General Feedback':  "What do you think so far?",
};

// ── Inject HTML after DOM ready ───────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', function() {
  document.body.insertAdjacentHTML('beforeend', `
    <button class="fb-trigger" onclick="openFeedbackModal()" aria-label="Send feedback">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
      </svg>
      Feedback
    </button>

    <div class="fb-overlay" id="fbOverlay" onclick="if(event.target===this)closeFeedbackModal()">
      <div class="fb-modal" role="dialog" aria-modal="true" aria-labelledby="fbHeading">
        <button class="fb-close" onclick="closeFeedbackModal()" aria-label="Close">✕</button>

        <div id="fbFormArea">
          <h2 class="fb-heading" id="fbHeading">Share Your Thoughts</h2>
          <p class="fb-sub">Help us make Bandmate better</p>

          <div class="fb-cats" id="fbCats">
            <button class="fb-cat" onclick="selectFeedbackCategory('Bug Report')">Bug Report</button>
            <button class="fb-cat" onclick="selectFeedbackCategory('Feature Request')">Feature Request</button>
            <button class="fb-cat" onclick="selectFeedbackCategory('General Feedback')">General Feedback</button>
          </div>

          <textarea
            class="fb-textarea"
            id="fbMessage"
            placeholder="What do you think so far?"
            rows="4"
          ></textarea>

          <label class="fb-email-label" for="fbEmail">Your email (optional — only if you want us to follow up)</label>
          <input
            class="fb-email-input"
            type="email"
            id="fbEmail"
            placeholder="your@email.com"
          >

          <button class="fb-submit" id="fbSubmitBtn" onclick="submitFeedback()">Send Feedback →</button>
        </div>

        <div class="fb-success" id="fbSuccess" style="display:none">
          <div class="fb-success-icon">✓</div>
          <div class="fb-success-title">Thanks for the feedback.</div>
          <div class="fb-success-msg">Your thoughts help us build something better for independent bands everywhere.</div>
        </div>
      </div>
    </div>
  `);
});

// ── Functions ─────────────────────────────────────────────────────────────────

function openFeedbackModal() {
  const overlay = document.getElementById('fbOverlay');
  if (!overlay) return;
  // Reset state
  _fbCategory = null;
  const formArea  = document.getElementById('fbFormArea');
  const successEl = document.getElementById('fbSuccess');
  const textarea  = document.getElementById('fbMessage');
  const emailEl   = document.getElementById('fbEmail');
  const submitBtn = document.getElementById('fbSubmitBtn');
  if (formArea)  formArea.style.display  = '';
  if (successEl) successEl.style.display = 'none';
  if (textarea)  textarea.value          = '';
  if (emailEl)   emailEl.value           = '';
  if (submitBtn) submitBtn.disabled      = false;
  // Pre-fill email if logged in
  if (typeof currentUser !== 'undefined' && currentUser?.email && emailEl) {
    emailEl.value = currentUser.email;
  }
  // Reset category buttons
  document.querySelectorAll('.fb-cat').forEach(b => b.classList.remove('active'));
  overlay.classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeFeedbackModal() {
  const overlay = document.getElementById('fbOverlay');
  if (overlay) overlay.classList.remove('open');
  document.body.style.overflow = '';
}

function selectFeedbackCategory(cat) {
  _fbCategory = cat;
  const textarea = document.getElementById('fbMessage');
  if (textarea) textarea.placeholder = FB_PLACEHOLDERS[cat] || '';
  document.querySelectorAll('.fb-cat').forEach(b => {
    b.classList.toggle('active', b.textContent.trim() === cat);
  });
}

async function submitFeedback() {
  const message   = (document.getElementById('fbMessage')?.value || '').trim();
  const email     = (document.getElementById('fbEmail')?.value   || '').trim();
  const submitBtn = document.getElementById('fbSubmitBtn');

  if (!message) {
    const ta = document.getElementById('fbMessage');
    if (ta) { ta.style.borderColor = 'var(--rust, #c94b2a)'; ta.focus(); }
    return;
  }

  if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Sending…'; }

  const category = _fbCategory || 'General Feedback';
  const bandName = (typeof currentBandProfile !== 'undefined' && currentBandProfile?.band_name)
    ? currentBandProfile.band_name
    : null;
  const pageUrl = window.location.href;

  try {
    // 1. Save to Supabase (source of truth / fallback)
    const { error } = await sb.from('beta_feedback').insert({
      category,
      message,
      email:     email || null,
      page_url:  pageUrl,
      band_name: bandName,
    });

    if (error) throw error;

    // 2. Create GitHub issue via Edge Function (best-effort — won't block success)
    let issueUrl = null;
    try {
      const fnUrl = `${BANDMATE_SUPABASE_URL}/functions/v1/create-github-issue`;
      const res   = await fetch(fnUrl, {
        method:  'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${BANDMATE_SUPABASE_KEY}`,
        },
        body: JSON.stringify({ category, message, email: email || null, page_url: pageUrl, band_name: bandName }),
      });
      const responseText = await res.text();
      console.log('[feedback] Edge Function status:', res.status, 'body:', responseText);
      if (res.ok) {
        try { issueUrl = JSON.parse(responseText).issue_url || null; } catch (_) {}
      }
    } catch (fnErr) {
      console.error('[feedback] Edge Function fetch error:', fnErr);
    }

    // Show success
    const formArea  = document.getElementById('fbFormArea');
    const successEl = document.getElementById('fbSuccess');
    const successMsg = document.querySelector('.fb-success-msg');
    if (formArea)  formArea.style.display  = 'none';
    if (successEl) successEl.style.display = '';
    if (successMsg && issueUrl) {
      successMsg.innerHTML = `Your thoughts help us build something better for independent bands everywhere.<br><br>
        <a href="${issueUrl}" target="_blank" rel="noopener"
           style="font-family:'Space Mono',monospace;font-size:0.6rem;text-transform:uppercase;letter-spacing:0.1em;color:var(--rust,#c94b2a);text-decoration:none;">
          View on GitHub →
        </a>`;
    }

    setTimeout(() => closeFeedbackModal(), 6000);
  } catch (err) {
    if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Send Feedback →'; }
    if (typeof showToast === 'function') showToast('Could not send feedback — please try again', 'error');
  }
}
