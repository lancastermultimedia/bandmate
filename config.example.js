// config.example.js — COMMITTED to GitHub as a setup template
//
// HOW TO SET UP FOR LOCAL DEVELOPMENT:
//   1. Copy this file:  cp config.example.js config.js
//   2. Fill in your credentials below
//   3. config.js is listed in .gitignore — it will never be committed
//
// WHERE TO FIND YOUR CREDENTIALS:
//   Supabase URL + anon key: supabase.com → your project → Settings → API
//   Google Maps key: console.cloud.google.com → APIs & Services → Credentials
//
// IMPORTANT — RESTRICT YOUR GOOGLE MAPS KEY:
//   In the GCP console, restrict your Maps API key to your production domain
//   (e.g. yourdomain.com/*) so it cannot be used from other origins even if
//   it is discovered in browser devtools network requests.

const BANDMATE_SUPABASE_URL = 'https://YOUR_PROJECT_ID.supabase.co';
const BANDMATE_SUPABASE_KEY = 'YOUR_SUPABASE_ANON_KEY';
const BANDMATE_MAPS_KEY     = 'YOUR_GOOGLE_MAPS_API_KEY';

// Set to true locally to enable verbose console.log output
const BANDMATE_DEV = false;
