import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const GITHUB_TOKEN = Deno.env.get('GITHUB_TOKEN') ?? '';
const GITHUB_REPO  = 'lancastermultimedia/bandmate';

const LABEL_MAP: Record<string, string> = {
  'Bug Report':       'bug',
  'Feature Request':  'enhancement',
  'General Feedback': 'feedback',
};

const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  let body: {
    category?:  string;
    message?:   string;
    email?:     string;
    page_url?:  string;
    band_name?: string;
  };

  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const { category = 'General Feedback', message, email, page_url, band_name } = body;

  if (!message) {
    return new Response(JSON.stringify({ error: 'message is required' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const label     = LABEL_MAP[category] ?? 'feedback';
  const submitter = band_name ? `**${band_name}**` : 'Anonymous';
  const pagePart  = page_url ? page_url.replace(/^https?:\/\/[^/]+/, '') || '/' : 'unknown';

  const title = `[${category}] ${band_name ? band_name + ' · ' : ''}${pagePart}`;

  const bodyMd = [
    `## ${category}`,
    '',
    message,
    '',
    '---',
    `| Field | Value |`,
    `|---|---|`,
    `| **Submitted by** | ${submitter} |`,
    email ? `| **Email** | ${email} |` : null,
    `| **Page** | \`${page_url ?? 'unknown'}\` |`,
  ].filter(l => l !== null).join('\n');

  const ghRes = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/issues`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${GITHUB_TOKEN}`,
      'Accept':        'application/vnd.github+json',
      'Content-Type':  'application/json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent':    'bandmate-feedback-bot',
    },
    body: JSON.stringify({
      title,
      body:   bodyMd,
      labels: [label],
    }),
  });

  if (!ghRes.ok) {
    const ghErr = await ghRes.text();
    console.error('[create-github-issue] GitHub API error:', ghRes.status, ghErr);
    return new Response(JSON.stringify({ error: 'GitHub API error', detail: ghErr }), {
      status: 502,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const issue = await ghRes.json();

  return new Response(
    JSON.stringify({ issue_url: issue.html_url, issue_number: issue.number }),
    { status: 201, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  );
});
