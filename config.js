// config.js — Bandmate runtime configuration
// Supabase anon key is safe to be public (Row Level Security enforces access).
// Restrict the Google Maps API key to your domain in GCP Console.

const BANDMATE_SUPABASE_URL = 'https://nyqilsmzbzmbndkwaypl.supabase.co';
const BANDMATE_SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im55cWlsc216YnptYm5ka3dheXBsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ5NjY4MDQsImV4cCI6MjA5MDU0MjgwNH0.go1KzmrMCEVIFL4O9n4NYYmwx3qCGg7veTvj1AhH8Cs';
const BANDMATE_MAPS_KEY     = 'AIzaSyD3mnxxKDgwd7D8yE5zI6phvucUpA7EZcg';

// Set to true when developing locally to enable verbose console.log output
const BANDMATE_DEV = false;
