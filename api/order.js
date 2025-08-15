// api/order.js  (Vercel Serverless Function)
const crypto = require('crypto');

async function handler(req, res) {
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
    // ---- read body (json or form-urlencoded) ----
    let body = {};
    if ((req.headers['content-type'] || '').includes('application/json')) {
      body = req.body || {};
    } else {
      const raw = await readBody(req);
      body = Object.fromEntries(new URLSearchParams(raw));
    }

    // ---- normalize fields ----
    const name     = (body.name||'').trim();
    const address  = (body.address||'').trim();
    const delivery = (body.delivery||'').trim();     // inside_dhaka / outside_dhaka (তুমি ম্যাপ করবে)
    const product  = (body.product||'Curva Glow').trim();
    const price    = Number(body.price || 1990) || 1990;
    const userAgent= body.userAgent || req.headers['user-agent'] || '';
    const eventId  = (body.event_id||'').trim() || genEventId();

    // phone → local 11 digits: 01XXXXXXXXX
    let phoneRaw = String(body.phone||'').replace(/\D/g,'');
    if (phoneRaw.startsWith('00880')) phoneRaw = phoneRaw.slice(2);
    if (phoneRaw.startsWith('880') && phoneRaw.length === 13) {
      phoneRaw = '0' + phoneRaw.slice(3);
    }
    if (!name || !address || !/^01[3-9]\d{8}$/.test(phoneRaw)) {
      return res.status(400).json({ ok:false, error:'Missing/invalid fields' });
    }

    // ---- build payload for Steadfast (উদাহরণ) ----
    // ⚠️ নীচের key গুলো তোমার পোর্টাল-ডক অনুযায়ী অ্যাডজাস্ট করবে
    const orderPayload = {
      // প্রায়শই invoice/order id দিতে বলে:
      invoice_id: 'CG-' + Date.now(),
      recipient_name: name,
      recipient_phone: phoneRaw,
      recipient_address: address,
      cod_amount: price,
      // city/district/area mapping দরকার হলে নিজে ম্যাপ করো:
      delivery_type: delivery === 'inside_dhaka' ? 'inside_dhaka' : 'outside_dhaka',
      note: product
      // store_id, city_id, area_id ইত্যাদি লাগলে এখানে যোগ করবে
    };

    // ---- call Steadfast API ----
    const apiUrl   = process.env.STEADFAST_API_URL;     // e.g. https://.../create-order
    const apiKey   = process.env.STEADFAST_API_KEY;     // যদি Api-Key লাগে
    const bearer   = process.env.STEADFAST_BEARER;      // যদি Bearer token লাগে

    if (!apiUrl) {
      return res.status(500).json({ ok:false, error:'STEADFAST_API_URL not set' });
    }

    const headers = { 'Content-Type':'application/json' };
    if (apiKey)  headers['Api-Key'] = apiKey;                // তোমার ডক যেটা বলে
    if (bearer)  headers['Authorization'] = `Bearer ${bearer}`;

    const sfRes = await fetch(apiUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(orderPayload)
    });
    const sfJson = await sfRes.json().catch(()=> ({}));

    if (!sfRes.ok || sfJson?.error) {
      return res.status(502).json({ ok:false, error: sfJson?.error || 'Steadfast error' });
    }

    // (ঐচ্ছিক) Facebook CAPI: Purchase server-side (তোমার আগের লজিক থাকলে এখানেই রাখো)
    // ... (ইচ্ছা হলে event_id ব্যবহার করে dedupe)

    return res.status(200).json({
      ok: true,
      message: 'Pushed to Steadfast',
      ref: sfJson?.consignment_id || sfJson?.tracking_code || null // ডক অনুযায়ী নাম ভিন্ন হতে পারে
    });

  } catch (e) {
    return res.status(500).json({ ok:false, error:String(e) });
  }
}
module.exports = handler;

/* helpers */
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
function genEventId(){
  return crypto.randomUUID ? crypto.randomUUID() : (Date.now()+'-'+Math.random().toString(36).slice(2));
}
