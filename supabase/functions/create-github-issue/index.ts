import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const GITHUB_TOKEN = Deno.env.get('GITHUB_TOKEN') ?? '';
const GITHUB_REPO  = 'lancastermultimedia/bandmate';

// Only use labels that GitHub creates by default in every repo.
// 'bug' and 'enhancement' always exist; avoid custom labels that may be missing.
const LABEL_MAP: Record<string, string> = {
  'Bug Report':       'bug',
  'Feature Request':  'enhancement',
  'General Feedback': '', // no label — avoids 422 if custom label missing
};

const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

async function createIssue(title: string, body: string, labels: string[]): Promise<Response> {
  return fetch(`https://api.github.com/repos/${GITHUB_REPO}/issues`, {
    method: 'POST',
    headers: {
      'Authorization':        `Bearer ${GITHUB_TOKEN}`,
      'Accept':               'application/vnd.github+json',
      'Content-Type':         'application/json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent':           'bandmate-feedback-bot',
    },
    body: JSON.stringify({ title, body, ...(labels.length ? { labels } : {}) }),
  });
}

serve(async (req) => {
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

  if (!GITHUB_TOKEN) {
    console.error('[create-github-issue] GITHUB_TOKEN not set');
    return new Response(JSON.stringify({ error: 'GitHub token not configured' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const label     = LABEL_MAP[category] ?? '';
  const labels    = label ? [label] : [];
  const submitter = band_name ? `**${band_name}**` : 'Anonymous';
  const pagePart  = page_url ? page_url.replace(/^https?:\/\/[^/]+/, '') || '/' : 'unknown';
  const title     = `[${category}] ${band_name ? band_name + ' · ' : ''}${pagePart}`;

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
  ].filter((l): l is string => l !== null).join('\n');

  let ghRes = await createIssue(title, bodyMd, labels);

  // If labels caused a 422 (label doesn't exist), retry without labels
  if (ghRes.status === 422 && labels.length > 0) {
    console.warn('[create-github-issue] Label error — retrying without labels');
    ghRes = await createIssue(title, bodyMd, []);
  }

  if (!ghRes.ok) {
    const ghErr = await ghRes.text();
    console.error('[create-github-issue] GitHub API error:', ghRes.status, ghErr);
    return new Response(JSON.stringify({ error: 'GitHub API error', status: ghRes.status }), {
      status: 502,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const issue = await ghRes.json();
  console.log('[create-github-issue] Created issue #', issue.number, issue.html_url);

  return new Response(
    JSON.stringify({ issue_url: issue.html_url, issue_number: issue.number }),
    { status: 201, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  );
});
