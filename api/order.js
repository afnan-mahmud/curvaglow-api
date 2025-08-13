// api/order.js
async function handler(req, res) {
    const allowedOrigins = ['https://your-domain.com', 'https://www.your-domain.com']; // তোমার ডোমেইন দাও
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
      let body = {};
      if ((req.headers['content-type'] || '').includes('application/json')) {
        body = req.body || {};
      } else {
        const raw = await new Promise((resolve, reject) => {
          let d=''; req.on('data',c=>d+=c); req.on('end',()=>resolve(d)); req.on('error',reject);
        });
        body = Object.fromEntries(new URLSearchParams(raw));
      }
  
      const { name='', phone='', address='' } = body;
      if (!name || !phone || !address) {
        return res.status(400).json({ ok:false, error:'Missing fields' });
      }
  
      const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbzYZc5DMMzKGwSNHntnM2FYDx3MscoqOkUMt_NHzJvZ8bfPnvzOdtDf99Dv81mhKZAcTw/exec';
  
      const params = new URLSearchParams();
      for (const [k,v] of Object.entries(body)) params.set(k, String(v ?? ''));
      const r = await fetch(APPS_SCRIPT_URL, { method:'POST', body: params });
      let j = null; try { j = await r.json(); } catch {}
  
      if (!r.ok || (j && j.ok === false)) {
        return res.status(500).json({ ok:false, forwarded:false, error: j?.error || 'Forward failed' });
      }
      return res.status(200).json({ ok:true, message:'Saved via Vercel', forwarded:true });
  
    } catch (err) {
      return res.status(500).json({ ok:false, error:String(err) });
    }
  }
  module.exports = handler;
  