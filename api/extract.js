const { verifyToken, getBearerToken } = require('../lib/auth');

const SALARY_PROMPT = `You are extracting structured data from a payslip/salary slip image or PDF.
Return ONLY valid JSON (no markdown fences, no commentary) matching exactly this schema:
{"pay_date":"YYYY-MM-DD or null","employer":"string or null","currency":"3-letter currency code guess e.g. PHP, USD","gross_pay":number or null,"net_pay":number or null,"pay_period":"one of Monthly, 1st Half, 2nd Half - based on the payslip's stated cutoff/period dates (e.g. 1-15 is 1st Half, 16-31 is 2nd Half); use Monthly if it covers a full month or isn't stated","deductions":[{"label":"string","amount":number}],"allowances":[{"label":"string","amount":number}],"employer_contributions":[{"label":"string","amount":number}]}
"deductions" are amounts subtracted from the employee's pay (e.g. "SSS Contribution", "PhilHealth", "Pag-IBIG", "Withholding Tax"). "employer_contributions" are separate, informational amounts the EMPLOYER pays on the employee's behalf for the same government programs (SSS/PhilHealth/Pag-IBIG/GSIS) - these are NOT subtracted from pay and only appear if the payslip explicitly breaks out an employer/company share (often labeled "ER Share", "Employer Share", or shown in a separate contributions table). Leave employer_contributions as an empty array if the slip doesn't show this.
Use null for missing string/number fields and empty arrays if none found. Output nothing but the JSON object.`;

const SOA_PROMPT = `You are extracting structured data from a credit card statement of account (SOA) image or PDF.
Return ONLY valid JSON (no markdown fences, no commentary) matching exactly this schema:
{"statement_date":"YYYY-MM-DD billing/statement date or null","card_name":"bank/card name if visible or null","currency":"3-letter currency code guess","total_amount_due":number or null,"minimum_amount_due":number or null,"transactions":[{"date":"YYYY-MM-DD","merchant":"string","amount":number,"category":"one of Groceries, Dining, Travel, Utilities, Shopping, Fuel, Subscriptions, Health, Education, Fees & Charges, Other"}]}
Use null for missing fields. Output nothing but the JSON object.`;

// Google renames/retires free-tier models fairly often. Try these in order rather than
// hard-coding one - if the first is retired, the next still works without a code change.
const GEMINI_MODELS = ['gemini-3-flash-preview', 'gemini-2.5-flash-lite', 'gemini-2.5-flash'];

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
  if (!process.env.GEMINI_API_KEY) {
    res.status(500).json({ error: 'GEMINI_API_KEY is not configured on the server. Add it in Vercel project settings under Environment Variables (get a free key at aistudio.google.com/apikey).' });
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

  const prompt = kind === 'salary' ? SALARY_PROMPT : SOA_PROMPT;
  const requestBody = JSON.stringify({
    contents: [{
      parts: [
        { text: prompt },
        { inline_data: { mime_type: mimeType || 'image/jpeg', data: base64 } },
      ],
    }],
    generationConfig: {
      responseMimeType: 'application/json', // asks Gemini to return clean JSON, no fences needed
      temperature: 0,
    },
  });

  let lastError = 'Gemini API request failed';
  for (const model of GEMINI_MODELS) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`;
    try {
      const apiRes = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: requestBody });
      const data = await apiRes.json();

      if (!apiRes.ok) {
        lastError = data?.error?.message || lastError;
        // Model retired/unknown/not-yet-available to this key -> try the next one in the list.
        const retryable = apiRes.status === 404 || /not found|no longer available|not supported/i.test(lastError);
        if (retryable) continue;
        res.status(apiRes.status).json({ error: lastError });
        return;
      }

      const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';
      if (!text) {
        const blockReason = data?.promptFeedback?.blockReason;
        res.status(500).json({ error: blockReason ? `Gemini declined to process this file (${blockReason}).` : 'Gemini returned an empty response.' });
        return;
      }
      const clean = text.replace(/```json|```/g, '').trim();
      const parsed = JSON.parse(clean);
      res.status(200).json(parsed);
      return;
    } catch (e) {
      lastError = e.message;
    }
  }
  console.error('extract error, all models failed', lastError);
  res.status(500).json({ error: 'Could not extract data from that file: ' + lastError });
};
