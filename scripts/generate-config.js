// Netlify build step — generates config.js from environment variables.
// Runs before the site is published. Never commits credentials to git.
//
// Required Netlify env vars:
//   SUPABASE_URL       — Supabase project URL
//   SUPABASE_ANON_KEY  — Supabase anon/public key
//   MAPS_API_KEY       — Google Maps API key

const fs = require('fs');
const path = require('path');

const url     = process.env.SUPABASE_URL;
const anonKey = process.env.SUPABASE_ANON_KEY;
const mapsKey = process.env.MAPS_API_KEY;

if (!url || !anonKey || !mapsKey) {
  console.error('[generate-config] Missing env vars. Required: SUPABASE_URL, SUPABASE_ANON_KEY, MAPS_API_KEY');
  process.exit(1);
}

const content = `const BANDMATE_SUPABASE_URL = '${url}';
const BANDMATE_SUPABASE_KEY = '${anonKey}';
const BANDMATE_MAPS_KEY     = '${mapsKey}';
const BANDMATE_DEV          = false;
`;

fs.writeFileSync(path.join(__dirname, '..', 'config.js'), content);
console.log('[generate-config] config.js written from env vars');
