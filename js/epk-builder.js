// epk-builder.js — EPK Builder page logic

const THEMES = [
  { id: 'clean',   label: 'Clean',   desc: 'Editorial magazine' },
  { id: 'bold',    label: 'Bold',    desc: 'Dark poster' },
  { id: 'vibrant', label: 'Vibrant', desc: 'Forest green & gold' },
  { id: 'static',  label: 'Static',  desc: 'Industrial terminal' },
  { id: 'torn',    label: 'Torn',    desc: 'Hardcore show flyer' },
  { id: 'signal',  label: 'Signal',  desc: 'Art gallery calm' },
];

let _band         = null;
let _configs      = [];
let _activeId     = null; // epk_config id with is_active=true
let _currentId    = null; // the config being edited
let _dirty        = false;
let _previewReady = false;
let _renameTimer  = null;

// ── Init ──────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  renderThemeGrid();
  await initAuth();

  if (!currentBandProfile) {
    showGate('Sign in to build your EPK', 'Create an account or sign in to design and publish your Electronic Press Kit.', 'Sign In →', () => openAuth('login'));
    return;
  }

  _band = currentBandProfile;
  document.getElementById('epkBlBandName').textContent = _band.band_name;

  const bandSlug = encodeURIComponent(_band.band_name);
  document.getElementById('epkViewLink').href = `epk.html?band=${bandSlug}`;
  document.getElementById('epkPreviewOpenLink').href = `epk.html?band=${bandSlug}`;

  await loadConfigs();
  initPreviewIframe();
});

// ── Gate ──────────────────────────────────────────────────────────────────────

function showGate(title, sub, btnLabel, btnAction) {
  document.getElementById('epkGateTitle').textContent = title;
  document.getElementById('epkGateSub').textContent   = sub;
  const btn = document.getElementById('epkGateBtn');
  btn.textContent = btnLabel;
  btn.onclick = btnAction;
  document.getElementById('epkBuilderGate').classList.add('visible');
}

// ── Configs ───────────────────────────────────────────────────────────────────

async function loadConfigs() {
  const { data } = await sb.from('epk_configs')
    .select('*')
    .eq('band_id', _band.id)
    .order('created_at');

  _configs = data || [];
  _activeId = _configs.find(c => c.is_active)?.id ?? null;

  if (_configs.length === 0) {
    // First time — create a default config
    await _insertConfig('My EPK', 'clean', true);
  } else {
    const toLoad = _configs.find(c => c.is_active) || _configs[0];
    _loadConfigIntoEditor(toLoad.id);
  }

  renderConfigsStrip();
}

async function _insertConfig(name, theme, isActive) {
  const { data, error } = await sb.from('epk_configs').insert({
    band_id:   _band.id,
    name,
    config:    { theme },
    is_active: isActive,
  }).select().single();

  if (error) { showToast('Could not create EPK config', 'error'); return; }

  _configs.push(data);
  if (isActive) _activeId = data.id;
  renderConfigsStrip();
  _loadConfigIntoEditor(data.id);
}

async function createNewConfig() {
  const name = `My EPK ${_configs.length + 1}`;
  await _insertConfig(name, 'clean', false);
}

function _loadConfigIntoEditor(id) {
  const cfg = _configs.find(c => c.id === id);
  if (!cfg) return;
  _currentId = id;
  document.getElementById('epkConfigNameInput').value = cfg.name;
  _selectThemeCard(cfg.config?.theme || 'clean', false);
  _restoreOverrideControls(cfg.config || {});
  renderConfigsStrip();
  updateActiveBtn();
  _dirty = false;
  updatePreview();
}

async function saveCurrentConfig() {
  if (!_currentId) return;

  const name   = document.getElementById('epkConfigNameInput').value.trim() || 'Untitled';
  const config = getCurrentConfig();

  const { error } = await sb.from('epk_configs')
    .update({ name, config })
    .eq('id', _currentId);

  if (error) { showToast('Save failed — ' + error.message, 'error'); return; }

  const cfg = _configs.find(c => c.id === _currentId);
  if (cfg) { cfg.name = name; cfg.config = config; }
  renderConfigsStrip();
  _dirty = false;
  showToast('Saved', 'success');
}

async function setConfigActive() {
  if (!_currentId) return;

  // Unset all, then set this one
  await sb.from('epk_configs').update({ is_active: false }).eq('band_id', _band.id);
  const { error } = await sb.from('epk_configs').update({ is_active: true }).eq('id', _currentId);

  if (error) { showToast('Could not set active — ' + error.message, 'error'); return; }

  _configs.forEach(c => { c.is_active = c.id === _currentId; });
  _activeId = _currentId;
  renderConfigsStrip();
  updateActiveBtn();
  showToast('This EPK is now your active public page', 'success');
}

async function deleteConfig(id) {
  if (_configs.length <= 1) { showToast('You need at least one EPK', 'error'); return; }
  if (!confirm('Delete this EPK? This cannot be undone.')) return;

  await sb.from('epk_configs').delete().eq('id', id);
  _configs = _configs.filter(c => c.id !== id);

  if (_currentId === id) {
    _loadConfigIntoEditor(_configs[0].id);
  }
  if (_activeId === id) {
    _activeId = null;
    updateActiveBtn();
  }
  renderConfigsStrip();
  showToast('Deleted', 'success');
}

// ── Theme grid ────────────────────────────────────────────────────────────────

function renderThemeGrid() {
  document.getElementById('epkThemeGrid').innerHTML = THEMES.map(t => `
    <div class="epk-theme-card" data-theme="${t.id}" onclick="selectTheme('${t.id}')">
      <div class="epk-theme-mini epk-theme-mini--${t.id}"></div>
      <div class="epk-theme-card-info">
        <div class="epk-theme-card-label">${t.label}</div>
        <div class="epk-theme-card-desc">${t.desc}</div>
      </div>
    </div>
  `).join('');
}

function selectTheme(theme) {
  _selectThemeCard(theme, true);
}

function _selectThemeCard(theme, fireUpdate) {
  document.querySelectorAll('.epk-theme-card').forEach(c => {
    c.classList.toggle('selected', c.dataset.theme === theme);
  });
  if (fireUpdate) {
    markDirty();
    updatePreview();
  }
}

// ── Config strip ──────────────────────────────────────────────────────────────

function renderConfigsStrip() {
  document.getElementById('epkConfigsStrip').innerHTML = _configs.map(cfg => `
    <div class="epk-config-card${cfg.id === _currentId ? ' current' : ''}" onclick="switchConfig(${cfg.id})">
      <div class="epk-config-card-name">${escHtml(cfg.name)}</div>
      ${cfg.is_active ? '<div class="epk-config-active-badge">★ Active</div>' : ''}
      <button class="epk-config-del" onclick="event.stopPropagation();deleteConfig(${cfg.id})" title="Delete">×</button>
    </div>
  `).join('');
}

function switchConfig(id) {
  if (id === _currentId) return;
  if (_dirty && !confirm('You have unsaved changes. Switch anyway?')) return;
  _loadConfigIntoEditor(id);
}

// ── Active button state ───────────────────────────────────────────────────────

function updateActiveBtn() {
  const btn = document.getElementById('epkSetActiveBtn');
  const isActive = _currentId !== null && _currentId === _activeId;
  btn.classList.toggle('is-active', isActive);
  // Update star icon text
  const starSvg = btn.querySelector('svg');
  btn.innerHTML = '';
  if (starSvg) btn.appendChild(starSvg);
  btn.appendChild(document.createTextNode(isActive ? ' Active EPK' : ' Set as Active EPK'));
  if (starSvg) btn.prepend(starSvg);
}

// ── Override controls ─────────────────────────────────────────────────────────

function selectAccent(value) {
  document.querySelectorAll('.epk-swatch').forEach(s => s.classList.toggle('selected', s.dataset.accent === value));
  markDirty();
  updatePreview();
}

function selectBg(value) {
  document.querySelectorAll('.epk-bg-btn').forEach(b => b.classList.toggle('selected', b.dataset.bg === value));
  markDirty();
  updatePreview();
}

function _restoreOverrideControls(config) {
  // Heading font
  const hf = document.getElementById('epkHeadingFont');
  if (hf) hf.value = config.heading_font || 'default';

  // Body font
  const bf = document.getElementById('epkBodyFont');
  if (bf) bf.value = config.body_font || 'default';

  // Accent swatch
  const accent = config.accent || 'default';
  document.querySelectorAll('.epk-swatch').forEach(s => s.classList.toggle('selected', s.dataset.accent === accent));

  // Background
  const bg = config.bg || 'default';
  document.querySelectorAll('.epk-bg-btn').forEach(b => b.classList.toggle('selected', b.dataset.bg === bg));
}

function getCurrentConfig() {
  const theme       = document.querySelector('.epk-theme-card.selected')?.dataset.theme || 'clean';
  const headingFont = document.getElementById('epkHeadingFont')?.value || 'default';
  const bodyFont    = document.getElementById('epkBodyFont')?.value    || 'default';
  const accent      = document.querySelector('.epk-swatch.selected')?.dataset.accent || 'default';
  const bg          = document.querySelector('.epk-bg-btn.selected')?.dataset.bg     || 'default';
  return { theme, heading_font: headingFont, body_font: bodyFont, accent, bg };
}

// ── Preview iframe ────────────────────────────────────────────────────────────

function initPreviewIframe() {
  if (!_band) return;
  const iframe = document.getElementById('epkPreviewIframe');
  iframe.src = `epk.html?band=${encodeURIComponent(_band.band_name)}&preview=1`;
  iframe.addEventListener('load', () => {
    _previewReady = true;
    updatePreview();
  });
}

function updatePreview() {
  if (!_previewReady) return;
  const iframe = document.getElementById('epkPreviewIframe');
  iframe.contentWindow.postMessage({ type: 'epk-preview', config: getCurrentConfig() }, '*');
}

function setPreviewMode(mode) {
  document.getElementById('epkPmDesktop').classList.toggle('active', mode === 'desktop');
  document.getElementById('epkPmMobile').classList.toggle('active', mode === 'mobile');
  document.getElementById('epkPreviewFrameWrap').classList.toggle('mobile', mode === 'mobile');
}

// ── EPK link ──────────────────────────────────────────────────────────────────

function copyEpkLink() {
  if (!_band) return;
  const url = `${window.location.origin}/epk.html?band=${encodeURIComponent(_band.band_name)}`;
  if (navigator.clipboard) {
    navigator.clipboard.writeText(url).then(() => showToast('EPK link copied!', 'success'));
  } else {
    const el = document.createElement('input');
    el.value = url; document.body.appendChild(el); el.select();
    document.execCommand('copy'); document.body.removeChild(el);
    showToast('EPK link copied!', 'success');
  }
}

// ── Dirty flag ────────────────────────────────────────────────────────────────

function markDirty() { _dirty = true; }

// ── Utility ───────────────────────────────────────────────────────────────────

function escHtml(s) {
  return (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
