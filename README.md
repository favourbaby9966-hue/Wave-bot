# WA Automator — Bot Host

This is the **external Node.js process** that owns the real WhatsApp Web
session for your dashboard. The dashboard alone cannot connect to WhatsApp —
WhatsApp requires a long-lived socket connection that only a regular
Node.js host can provide.

## What it does

- Opens a real WhatsApp Web session via `whatsapp-web.js`
- Prints a **real, scannable QR code** in your terminal (this is the only QR WhatsApp will accept)
- Reports connection status to your dashboard (`/api/v1/connection`)
- Captures incoming messages as **leads** (`/api/v1/leads`)
- Auto-replies based on the **commands** you define in the dashboard (`/api/v1/commands`)
- Polls and sends queued **broadcasts** (`/api/v1/broadcasts/queued` + `/status`)
- Persists the WhatsApp session locally (`./.wwebjs_auth`) so you only scan once

## Setup

```bash
cd bot-host
cp .env.example .env
# Edit .env: paste the API key from Dashboard -> API Keys
npm install
npm start
```

Then scan the QR shown in the terminal:
**WhatsApp → Settings → Linked Devices → Link a Device**.

After scanning, your dashboard's Connect page will show **Connected**.

## Hosting it 24/7

### Easiest: one-click Render deploy

1. Push this repo to your own GitHub account.
2. Go to https://dashboard.render.com/select-repo?type=blueprint and pick your repo.
3. Render reads `render.yaml` at the repo root and provisions everything.
4. When prompted, paste your `API_KEY` (from Dashboard → API Keys).
5. Open the service's **Logs** tab — the QR appears there. Scan it.

### Other options

- A VPS (DigitalOcean, Hetzner, Contabo, AWS Lightsail…)
- Railway / Fly.io (use a persistent volume for `.wwebjs_auth`)
- Your own laptop (only online while the laptop is on)

⚠️ **Avoid serverless / edge platforms** — they don't allow long-lived
WebSocket connections, which `whatsapp-web.js` requires.

## Risks (read this)

- WhatsApp may ban numbers that send spammy or high-volume traffic.
- Keep `BROADCAST_DELAY_MS` ≥ 2000ms.
- Use a secondary number, not your primary, while testing.
