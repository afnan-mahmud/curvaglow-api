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

    // -------- normalize fields --------
    const name      = (body.name||'').trim();
    let   phoneRaw  = (body.phone||'').replace(/\D/g,'').trim(); // keep digits only
    const address   = (body.address||'').trim();
    const delivery  = (body.delivery||'').trim(); // inside_dhaka / outside_dhaka
    const product   = (body.product||'Curva Glow').trim();
    const price     = Number(body.price || 1990) || 1990;
    const shipping  = (body.shipping||'free').trim();
    const source    = body.source || '';
    const userAgent = body.userAgent || req.headers['user-agent'] || '';
    const eventId   = (body.event_id||'').trim() || genEventId();

    // ---- phone to BD 11-digit local (01XXXXXXXXX) ----
    // 00880XXXXXXXXXXX -> 880XXXXXXXXXXX
    if (phoneRaw.startsWith('00880')) phoneRaw = phoneRaw.slice(3);
    // 8801XXXXXXXXX -> 01XXXXXXXXX
    if (phoneRaw.startsWith('880') && phoneRaw.length === 13) {
      phoneRaw = '0' + phoneRaw.slice(3);
    }
    // এখন ফোন ১১ ডিজিট হতে হবে এবং 01 দিয়ে শুরু
    if (!name || !phoneRaw || !address || !/^01[3-9]\d{8}$/.test(phoneRaw)) {
      return res.status(400).json({ ok:false, error:'Missing/invalid fields' });
    }

    // নিজস্ব invoice না এলে জেনারেট করি (Steadfast-এ ইউনিক লাগবে)
    const invoice = (body.invoice || `CG-${new Date().toISOString().slice(0,10).replace(/-/g,'')}-${eventId.slice(0,6)}`)
                      .replace(/[^A-Za-z0-9\-_]/g,''); // আলফা-নিউমেরিক/হাইফেন/আন্ডারস্কোর

    // ----------------------------------------------------------------
    // 1) Google Sheets via Apps Script (optional; fail হলেও থামাবো না)
    // ----------------------------------------------------------------
    let sheetOk = false, sheetErr = null;
    try {
      const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbzYZc5DMMzKGwSNHntnM2FYDx3MscoqOkUMt_NHzJvZ8bfPnvzOdtDf99Dv81mhKZAcTw/exec';
      const params = new URLSearchParams({
        invoice, name, phone: phoneRaw, address, delivery, product,
        price: String(price), shipping, source, userAgent
      });
      const r = await fetch(APPS_SCRIPT_URL, { method:'POST', body: params });
      let j = null; try { j = await r.json(); } catch {}
      sheetOk = r.ok && (!j || j.ok !== false);
      if (!sheetOk) sheetErr = j?.error || `Apps Script status ${r.status}`;
    } catch (e) {
      sheetErr = String(e);
    }

    // ----------------------------------------------------------------
    // 2) Steadfast: create_order
    // ----------------------------------------------------------------
    const STEADFAST_BASE = 'https://portal.packzy.com/api/v1';
    const STEADFAST_API_KEY    = 'x11gzzr2rpemurpoe2twxlgovkif0dcp';
    const STEADFAST_SECRET_KEY = '1cfnmpmmckdvvewi5ib10aa9';

    const sfPayload = {
      invoice,
      recipient_name:   name,
      recipient_phone:  phoneRaw,     // 11 digits
      alternative_phone: '',          // চাইলে ফ্রন্টএন্ড থেকে আনতে পারো
      recipient_email:  '',
      recipient_address: address,
      cod_amount:        price,       // BDT
      note:              `Delivery: ${delivery || '—'} | Shipping: ${shipping}`,
      item_description:  product,
      total_lot:         1,
      delivery_type:     0            // 0=home delivery, 1=hub pickup
    };

    let steadfastOk = false;
    let steadfastInfo = null;
    try {
      const sfRes = await fetch(`${STEADFAST_BASE}/create_order`, {
        method: 'POST',
        headers: {
          'Api-Key':     STEADFAST_API_KEY,
          'Secret-Key':  STEADFAST_SECRET_KEY,
          'Content-Type':'application/json'
        },
        body: JSON.stringify(sfPayload)
      });
      const sfJson = await sfRes.json().catch(()=> ({}));
      // success shape: { status:200, consignment:{...} }
      if (sfRes.ok && Number(sfJson?.status) === 200 && sfJson?.consignment?.consignment_id) {
        steadfastOk = true;
        steadfastInfo = {
          consignment_id: sfJson.consignment.consignment_id,
          tracking_code:  sfJson.consignment.tracking_code,
          delivery_status: sfJson.consignment.status || 'in_review'
        };
      } else {
        // Steadfast fail হলে 502 দিয়ে জানাই (ফ্রন্টএন্ডে error দেখাবে)
        return res.status(502).json({
          ok:false,
          error: sfJson?.message || 'Steadfast create_order failed',
          details: sfJson || null
        });
      }
    } catch (e) {
      return res.status(502).json({ ok:false, error:`Steadfast error: ${String(e)}` });
    }

    // ----------------------------------------------------------------
    // 3) Facebook Conversions API (server-side Purchase)
    // ----------------------------------------------------------------
    const PIXEL_ID     = "2881488028679164";
    const ACCESS_TOKEN = "EAAMcMmsQ1RgBPMncs5riBpdbil93InmUV8ZBLY3Nb37ryzszzvZCL5ZClDhhLhioqV4KhVZBoGDPyKDT7NKsZCZA9DM0MkOZC1mAroK1gdVpkYRNSJXF54JpsZAy7T4No9jdH9mPpW7PbDv0tLswU21oPewjZBi2DDhznwTGAcYcrQR04JRYjsmpuLIk3sDzSuAZDZD";
    const TEST_CODE    = "TEST38786"; // optional

    let capiOk = false, capiErr = null;
    if (PIXEL_ID && ACCESS_TOKEN) {
      try {
        const clientIp = (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim();
        const capiPayload = buildCapiPayload({
          eventName: 'Purchase',
          eventId,
          eventSourceUrl: source || 'https://curvaglowplus.com/checkout',
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

    // ----------------------------------------------------------------
    // Final response
    // ----------------------------------------------------------------
    return res.status(200).json({
      ok: true,
      message: `Saved${sheetOk ? ' (sheet)' : ''} + Steadfast${capiOk ? ' + CAPI' : ''}`,
      event_id: eventId,
      invoice,
      steadfast: steadfastInfo,
      sheet: sheetOk ? 'ok' : (sheetErr || 'skipped'),
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
  if (phone)     user_data.ph = [sha256(phone)];
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
