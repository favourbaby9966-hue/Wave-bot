/**
 * WA Automator — Bot Host
 * ----------------------------------------------------------
 * Run this on a Node.js machine (your laptop, a VPS, Railway,
 * Render, etc.). It opens a real WhatsApp Web session via
 * whatsapp-web.js, prints the pairing QR in the terminal,
 * then talks to your WA Automator dashboard using the API key.
 *
 * Quick start:
 *   1. cd bot-host
 *   2. cp .env.example .env   (then fill in API_KEY)
 *   3. npm install
 *   4. npm start
 *   5. Scan the QR shown in the terminal with WhatsApp ->
 *      Settings -> Linked Devices -> Link a Device.
 * ---------------------------------------------------------- */

import 'dotenv/config';
import pkg from 'whatsapp-web.js';
import qrcode from 'qrcode-terminal';
import fetch from 'node-fetch';

const { Client, LocalAuth } = pkg;

const DASHBOARD_URL = (process.env.DASHBOARD_URL || '').replace(/\/$/, '');
const API_KEY = process.env.API_KEY;
const DEVICE_NAME = process.env.DEVICE_NAME || 'Bot Host';
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS || 15000);
const COMMANDS_REFRESH_MS = Number(process.env.COMMANDS_REFRESH_MS || 60000);
const BROADCAST_DELAY_MS = Number(process.env.BROADCAST_DELAY_MS || 3500);

if (!DASHBOARD_URL || !API_KEY) {
  console.error('❌ Missing DASHBOARD_URL or API_KEY in .env');
  process.exit(1);
}

const headers = {
  'Content-Type': 'application/json',
  Authorization: `Bearer ${API_KEY}`,
};

/* -------------------- Dashboard API helpers -------------------- */
async function api(path, init = {}) {
  const res = await fetch(`${DASHBOARD_URL}${path}`, { ...init, headers });
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!res.ok) throw new Error(`API ${path} ${res.status}: ${data.error || text}`);
  return data;
}

const reportConnection = (status, phone) =>
  api('/api/v1/connection', {
    method: 'POST',
    body: JSON.stringify({
      status,
      device_name: DEVICE_NAME,
      ...(phone ? { phone_number: phone } : {}),
    }),
  }).catch((e) => console.warn('⚠️  reportConnection:', e.message));

const fetchCommands = () =>
  api('/api/v1/commands').then((r) => r.commands || []).catch((e) => {
    console.warn('⚠️  fetchCommands:', e.message);
    return [];
  });

const fetchQueuedBroadcasts = () =>
  api('/api/v1/broadcasts/queued').then((r) => r.broadcasts || []).catch((e) => {
    console.warn('⚠️  fetchQueuedBroadcasts:', e.message);
    return [];
  });

const updateBroadcast = (id, body) =>
  api(`/api/v1/broadcasts/${id}/status`, {
    method: 'POST',
    body: JSON.stringify(body),
  }).catch((e) => console.warn('⚠️  updateBroadcast:', e.message));

const pushLead = (lead) =>
  api('/api/v1/leads', { method: 'POST', body: JSON.stringify(lead) })
    .catch((e) => console.warn('⚠️  pushLead:', e.message));

/* -------------------- WhatsApp client -------------------- */
const client = new Client({
  authStrategy: new LocalAuth({ dataPath: './.wwebjs_auth' }),
  puppeteer: {
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  },
});

let commandsCache = [];
const seenSenders = new Set();

client.on('qr', async (qr) => {
  console.log('\n📱 Scan this QR with WhatsApp -> Linked Devices:\n');
  qrcode.generate(qr, { small: true });
  await reportConnection('connecting');
});

client.on('authenticated', () => console.log('🔐 Authenticated.'));
client.on('auth_failure', (m) => console.error('❌ Auth failure:', m));

client.on('ready', async () => {
  const phone = client.info?.wid?.user ? `+${client.info.wid.user}` : undefined;
  console.log(`✅ WhatsApp connected${phone ? ` as ${phone}` : ''}.`);
  await reportConnection('connected', phone);
  commandsCache = await fetchCommands();
  console.log(`📚 Loaded ${commandsCache.length} auto-reply command(s).`);
});

client.on('disconnected', async (reason) => {
  console.warn('🔌 Disconnected:', reason);
  await reportConnection('disconnected');
});

/* -------------------- Auto-reply + lead capture -------------------- */
client.on('message', async (msg) => {
  try {
    if (msg.fromMe || msg.from.endsWith('@g.us')) return;

    const text = (msg.body || '').trim();
    const phone = `+${msg.from.split('@')[0]}`;

    if (!seenSenders.has(msg.from)) {
      seenSenders.add(msg.from);
      const contact = await msg.getContact().catch(() => null);
      await pushLead({
        phone,
        name: contact?.pushname || contact?.name || null,
        message: text || null,
        source: 'whatsapp',
      });
    }

    const lower = text.toLowerCase();
    const hit = commandsCache.find((c) => lower === c.keyword.toLowerCase());
    if (hit) await msg.reply(hit.response);
  } catch (e) {
    console.warn('⚠️  message handler:', e.message);
  }
});

/* -------------------- Broadcast worker -------------------- */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function processBroadcasts() {
  const jobs = await fetchQueuedBroadcasts();
  for (const job of jobs) {
    console.log(`📣 Broadcast "${job.name}" -> ${job.recipients.length} recipient(s)`);
    await updateBroadcast(job.id, { status: 'sending' });
    let sent = 0;
    let failed = 0;
    for (const raw of job.recipients) {
      const num = String(raw).replace(/[^\d]/g, '');
      if (!num) { failed++; continue; }
      const chatId = `${num}@c.us`;
      try {
        await client.sendMessage(chatId, job.message);
        sent++;
      } catch (e) {
        failed++;
        console.warn(`   ✗ ${num}:`, e.message);
      }
      await sleep(BROADCAST_DELAY_MS);
    }
    await updateBroadcast(job.id, {
      status: failed && !sent ? 'failed' : 'sent',
      sent_count: sent,
      failed_count: failed,
    });
    console.log(`   ✓ done — sent=${sent} failed=${failed}`);
  }
}

/* -------------------- Boot -------------------- */
console.log('🚀 WA Automator bot host starting...');
console.log(`   Dashboard: ${DASHBOARD_URL}`);
client.initialize();

setInterval(async () => {
  if (!client.info) return;
  await processBroadcasts();
}, POLL_INTERVAL_MS);

setInterval(async () => {
  if (!client.info) return;
  commandsCache = await fetchCommands();
}, COMMANDS_REFRESH_MS);

process.on('SIGINT', async () => {
  console.log('\n👋 Shutting down...');
  await reportConnection('disconnected');
  await client.destroy().catch(() => {});
  process.exit(0);
});
