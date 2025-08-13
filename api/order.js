// api/order.js
const crypto = require('crypto');

async function handler(req, res) {
  // ----- CORS -----
  const allowedOrigins = [
    'https://curvaglowplus.com',
    'https://www.curvaglowplus.com'
  ];
  const origin = req.headers.origin || '';
  if (req.method === 'OPTIONS') {
    setCors(res, origin, allowedOrigins);
    return res.status(200).end();
  }
  setCors(res, origin, allowedOrigins);

  if (req.method !== 'POST') {
    return res.status(405).json({ ok:false, error:'Method Not Allowed' });
  }

  try {
    // JSON বা form-urlencoded – দুটোই ধরবো
    let body = {};
    if ((req.headers['content-type'] || '').includes('application/json')) {
      body = req.body || {};
    } else {
      const raw = await readBody(req);
      body = Object.fromEntries(new URLSearchParams(raw));
    }

    // normalize
    const name     = (body.name||'').trim();
    const phoneRaw = (body.phone||'').replace(/\D/g,'');
    const address  = (body.address||'').trim();
    const delivery = (body.delivery||'').trim();
    const product  = (body.product||'Curva Glow').trim();
    const price    = Number(body.price || 1990) || 1990;
    const shipping = (body.shipping||'free').trim();
    const source   = body.source || '';
    const userAgent= body.userAgent || req.headers['user-agent'] || '';
    const eventId  = (body.event_id||'').trim() || genEventId();

    if (!name || !phoneRaw || !address) {
      return res.status(400).json({ ok:false, error:'Missing fields' });
    }

    // 1) ---- Google Sheets via Apps Script ----
    const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbzYZc5DMMzKGwSNHntnM2FYDx3MscoqOkUMt_NHzJvZ8bfPnvzOdtDf99Dv81mhKZAcTw/exec';

    const params = new URLSearchParams({
      name, phone: phoneRaw, address, delivery, product,
      price: String(price), shipping, source, userAgent
    });
    const r = await fetch(APPS_SCRIPT_URL, { method:'POST', body: params });
    let j = null; try { j = await r.json(); } catch {}
    const sheetOk = r.ok && (!j || j.ok !== false);
    if (!sheetOk) {
      return res.status(500).json({ ok:false, error: j?.error || 'Sheet forward failed' });
    }

    // 2) ---- Facebook Conversions API (server-side pixel) ----
    const PIXEL_ID     = "2881488028679164";
    const ACCESS_TOKEN = "EAAMcMmsQ1RgBPMncs5riBpdbil93InmUV8ZBLY3Nb37ryzszzvZCL5ZClDhhLhioqV4KhVZBoGDPyKDT7NKsZCZA9DM0MkOZC1mAroK1gdVpkYRNSJXF54JpsZAy7T4No9jdH9mPpW7PbDv0tLswU21oPewjZBi2DDhznwTGAcYcrQR04JRYjsmpuLIk3sDzSuAZDZD";
    const TEST_CODE    = "TEST38786"; // optional

    let capiOk = false, capiErr = null;
    if (PIXEL_ID && ACCESS_TOKEN) {
      try {
        const clientIp = (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim();
        const capiPayload = buildCapiPayload({
          eventName: 'Purchase',             // বা 'Lead'
          eventId,
          eventSourceUrl: source || 'https://your-domain.com/checkout',
          price,
          currency: 'BDT',
          phone: phoneRaw,
          clientIp,
          userAgent
        });

        const fbUrl = `https://graph.facebook.com/v18.0/${PIXEL_ID}/events?access_token=${ACCESS_TOKEN}` +
                      (TEST_CODE ? `&test_event_code=${encodeURIComponent(TEST_CODE)}` : '');
        const fbRes = await fetch(fbUrl, {
          method:'POST',
          headers:{ 'Content-Type':'application/json' },
          body: JSON.stringify(capiPayload)
        });
        const fbJson = await fbRes.json().catch(()=> ({}));
        capiOk = fbRes.ok && !fbJson.error;
        if (!capiOk) capiErr = fbJson?.error || 'CAPI failed';
      } catch (e) {
        capiErr = String(e);
      }
    }

    return res.status(200).json({
      ok: true,
      message: 'Saved to sheet' + (capiOk ? ' + CAPI' : ''),
      event_id: eventId,
      capi: capiOk ? 'ok' : (capiErr || 'skipped')
    });

  } catch (err) {
    return res.status(500).json({ ok:false, error:String(err) });
  }
}
module.exports = handler;

/* -------- helpers -------- */
function setCors(res, origin, allowList) {
  res.setHeader('Access-Control-Allow-Origin', allowList.includes(origin) ? origin : '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}
function readBody(req){
  return new Promise((resolve, reject)=>{
    let d=''; req.on('data',c=>d+=c); req.on('end',()=>resolve(d)); req.on('error',reject);
  });
}
function sha256(str){ return crypto.createHash('sha256').update(String(str).trim().toLowerCase()).digest('hex'); }
function genEventId(){ return crypto.randomUUID ? crypto.randomUUID() : (Date.now()+'-'+Math.random().toString(36).slice(2)); }

function buildCapiPayload({eventName, eventId, eventSourceUrl, price, currency, phone, clientIp, userAgent}) {
  const user_data = {};
  if (phone)     user_data.ph = [sha256(phone)];         // E.164 (we already kept digits only)
  if (clientIp)  user_data.client_ip_address = clientIp;
  if (userAgent) user_data.client_user_agent = userAgent;

  return {
    data: [{
      event_name: eventName,
      event_time: Math.floor(Date.now()/1000),
      event_id: eventId,
      action_source: 'website',
      event_source_url: eventSourceUrl,
      user_data,
      custom_data: {
        value: Number(price)||0,
        currency: currency || 'BDT'
      }
    }]
  };
}
