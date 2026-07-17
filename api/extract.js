const { verifyToken, getBearerToken } = require('../lib/auth');

const SALARY_PROMPT = `You are extracting structured data from a payslip/salary slip image or PDF.
Return ONLY valid JSON (no markdown fences, no commentary) matching exactly this schema:
{"pay_date":"YYYY-MM-DD or null","employer":"string or null","currency":"3-letter currency code guess e.g. PHP, USD","gross_pay":number or null,"net_pay":number or null,"deductions":[{"label":"string","amount":number}],"allowances":[{"label":"string","amount":number}]}
Use null for missing string/number fields and empty arrays if none found. Output nothing but the JSON object.`;

const SOA_PROMPT = `You are extracting structured data from a credit card statement of account (SOA) image or PDF.
Return ONLY valid JSON (no markdown fences, no commentary) matching exactly this schema:
{"statement_date":"YYYY-MM-DD billing/statement date or null","card_name":"bank/card name if visible or null","currency":"3-letter currency code guess","total_amount_due":number or null,"minimum_amount_due":number or null,"transactions":[{"date":"YYYY-MM-DD","merchant":"string","amount":number,"category":"one of Groceries, Dining, Travel, Utilities, Shopping, Fuel, Subscriptions, Health, Education, Fees & Charges, Other"}]}
Use null for missing fields. Output nothing but the JSON object.`;

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  if (!process.env.AUTH_SECRET) {
    res.status(500).json({ error: 'AUTH_SECRET is not configured on the server. Add it in Vercel → Settings → Environment Variables, then redeploy.' });
    return;
  }
  let user;
  try{ user = verifyToken(getBearerToken(req)); }
  catch(e){ res.status(500).json({ error: 'Server error verifying session: ' + e.message }); return; }
  if (!user) { res.status(401).json({ error: 'Not authenticated' }); return; }
  if (user.role === 'viewer') { res.status(403).json({ error: 'Viewers cannot extract new documents' }); return; }
  if (!process.env.ANTHROPIC_API_KEY) {
    res.status(500).json({ error: 'ANTHROPIC_API_KEY is not configured on the server. Add it in Vercel project settings under Environment Variables.' });
    return;
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) { body = {}; }
  }
  const { base64, mimeType, kind } = body || {};
  if (!base64 || !kind) {
    res.status(400).json({ error: 'Missing base64 or kind in request body' });
    return;
  }

  const isPdf = mimeType === 'application/pdf';
  const contentBlock = isPdf
    ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } }
    : { type: 'image', source: { type: 'base64', media_type: mimeType || 'image/jpeg', data: base64 } };
  const prompt = kind === 'salary' ? SALARY_PROMPT : SOA_PROMPT;

  try {
    const apiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-5',
        max_tokens: 2000,
        messages: [{ role: 'user', content: [contentBlock, { type: 'text', text: prompt }] }],
      }),
    });

    const data = await apiRes.json();
    if (!apiRes.ok) {
      res.status(apiRes.status).json({ error: data?.error?.message || 'Anthropic API request failed' });
      return;
    }

    const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
    const clean = text.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean);
    res.status(200).json(parsed);
  } catch (e) {
    console.error('extract error', e);
    res.status(500).json({ error: 'Could not extract data from that file: ' + e.message });
  }
};
