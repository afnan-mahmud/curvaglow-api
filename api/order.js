// vercel serverless function: /api/order
export default async function handler(req, res) {
    // --- CORS ---
    const allowedOrigins = [
      'https://curvaglowplus.com',     // ← তোমার মূল ডোমেইন (CyberPanel হোস্টেড)
      'https://curvaglowplus.com'
    ];
    const origin = req.headers.origin || '';
    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Origin', allowedOrigins.includes(origin) ? origin : '*');
      res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      return res.status(200).end();
    }
  
    res.setHeader('Access-Control-Allow-Origin', allowedOrigins.includes(origin) ? origin : '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
    if (req.method !== 'POST') {
      return res.status(405).json({ ok:false, error:'Method Not Allowed' });
    }
  
    try {
      // ফ্রন্টএন্ড থেকে URL-encoded / JSON – দুইভাবেই আসতে পারে
      let body = {};
      if (req.headers['content-type']?.includes('application/json')) {
        body = req.body || {};
      } else {
        const raw = await readBody(req);
        body = Object.fromEntries(new URLSearchParams(raw));
      }
  
      // Basic validation
      const { name = '', phone = '', address = '' } = body;
      if (!name || !phone || !address) {
        return res.status(400).json({ ok:false, error:'Missing fields' });
      }
  
      // 👉 Apps Script Web App URL (আগে যেটা বানিয়েছিলে)
      const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbx4H1wG6tUDRyByJOo8wEIheJuHayfGtWs40Hzp_pMXORoJJwSBT4PoEetISZfR_b1Irw/exec';
  
      // Apps Script-এ URL-encoded করে ফরোয়ার্ড করি (preflight ফ্রি)
      const params = new URLSearchParams();
      for (const [k,v] of Object.entries(body)) params.set(k, String(v ?? ''));
      const r = await fetch(APPS_SCRIPT_URL, { method:'POST', body: params });
      const j = await safeJson(r);
  
      if (!r.ok || j?.ok === false) {
        return res.status(500).json({ ok:false, forwarded:false, error: j?.error || 'Forward failed' });
      }
  
      // সফল হলে সামনে ok পাঠাই
      return res.status(200).json({ ok:true, message:'Saved via Vercel', forwarded:true });
  
    } catch (err) {
      return res.status(500).json({ ok:false, error:String(err) });
    }
  }
  
  function readBody(req) {
    return new Promise((resolve, reject) => {
      let data = '';
      req.on('data', chunk => (data += chunk));
      req.on('end', () => resolve(data));
      req.on('error', reject);
    });
  }
  
  async function safeJson(res) {
    try { return await res.json(); } catch { return null; }
  }
  