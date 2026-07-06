// Netlify serverless function — Ko-fi webhook receiver
// Fires automatically on every Ko-fi donation or subscription payment.
//
// Required environment variables (set in Netlify → Site config → Env vars):
//   KOFI_VERIFICATION_TOKEN  — from Ko-fi Settings → API → Webhooks
//   SUPABASE_URL             — your Supabase project URL
//   SUPABASE_SERVICE_KEY     — Supabase Settings → API → service_role key (NOT anon)
//
// Webhook URL to paste into Ko-fi:
//   https://mybandmate.us/.netlify/functions/kofi-webhook

const TIER_TO_CATEGORY = {
  'Keep the lights on': 'general',
  'Help us grow':       'maps',
  'Champion supporter': 'database',
};

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const KOFI_TOKEN    = process.env.KOFI_VERIFICATION_TOKEN;
  const SUPABASE_URL  = process.env.SUPABASE_URL;
  const SERVICE_KEY   = process.env.SUPABASE_SERVICE_KEY;

  if (!KOFI_TOKEN || !SUPABASE_URL || !SERVICE_KEY) {
    console.error('[kofi-webhook] missing env vars');
    return { statusCode: 500, body: 'Server misconfigured' };
  }

  try {
    // Ko-fi sends URL-encoded body: data=<JSON string>
    const params  = new URLSearchParams(event.body);
    const rawData = params.get('data');
    if (!rawData) return { statusCode: 400, body: 'No data field' };

    const payload = JSON.parse(rawData);

    // Verify it's actually from Ko-fi
    if (payload.verification_token !== KOFI_TOKEN) {
      console.warn('[kofi-webhook] bad verification token — ignoring');
      return { statusCode: 401, body: 'Unauthorized' };
    }

    // Only process actual money events
    const type = payload.type; // "Donation" | "Subscription" | "Commission" | "Shop Order"
    if (!['Donation', 'Subscription'].includes(type)) {
      return { statusCode: 200, body: `Ignored type: ${type}` };
    }

    const amount = parseFloat(payload.amount);
    if (!amount || amount <= 0) {
      return { statusCode: 200, body: 'Zero amount, skipped' };
    }

    // Map tier name → cost category; fall back to 'general'
    const tierName   = payload.tier_name || '';
    const category   = TIER_TO_CATEGORY[tierName] || 'general';
    const isRecurring = payload.is_subscription_payment === true;

    // Only store name if donor made the payment public
    const supporterName = payload.is_public ? (payload.from_name || null) : null;

    // Insert via Supabase REST — no npm package needed, service_role bypasses RLS
    const res = await fetch(`${SUPABASE_URL}/rest/v1/contributions`, {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'apikey':        SERVICE_KEY,
        'Authorization': `Bearer ${SERVICE_KEY}`,
        'Prefer':        'return=minimal',
      },
      body: JSON.stringify({ amount, category, is_recurring: isRecurring, supporter_name: supporterName }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error('[kofi-webhook] Supabase insert failed:', errText);
      return { statusCode: 500, body: 'DB insert error' };
    }

    console.log(`[kofi-webhook] recorded $${amount} → ${category} (recurring=${isRecurring})`);
    return { statusCode: 200, body: 'OK' };

  } catch (err) {
    console.error('[kofi-webhook] exception:', err.message);
    return { statusCode: 500, body: 'Server error' };
  }
};
