# Local Development & Testing

This application requires both the frontend and backend servers to be running.
In addition, to test the mobile location enrollment flow on a physical device, you will need to expose the local frontend to the public internet using an HTTPS tunnel.

## 1. Local Setup

First, ensure you have your dependencies installed and database migrated:

```bash
# In the backend directory:
npm install
npm run db:migrate
npm run db:seed  # to create the admin user

# In the frontend directory:
npm install
```

Start the servers in separate terminals:

```bash
# Backend (default port 4000)
cd backend
npm run dev

# Frontend (default port 5173)
cd frontend
npm run dev
```

You can now access the dashboard at `http://localhost:5173`.

## 2. Testing Mobile Enrollment via HTTPS Tunnels

The Geolocation API (`navigator.geolocation`) requires a Secure Context (HTTPS) to function correctly on mobile devices. If you are developing locally, you can use a tunnel to expose your local frontend.

The application detects its URL dynamically, so you just need to tunnel your frontend.

### Option A: Cloudflare Tunnel (Recommended)

1. Install `cloudflared`.
2. Run the tunnel pointing to your local frontend port:

```bash
cloudflared tunnel --url http://localhost:5173
```

3. `cloudflared` will provide a public URL (e.g., `https://random-words.trycloudflare.com`).
4. Access this URL on your desktop to log into the dashboard.
5. Create a new device enrollment in the dashboard; the generated enrollment link will use your public tunnel URL.
6. Open that link on your physical phone to complete the pairing and start location sharing.

### Option B: ngrok

1. Install `ngrok`.
2. Run the tunnel pointing to your local frontend:

```bash
ngrok http 5173
```

3. Use the generated `https://...ngrok-free.app` URL to access the dashboard and generate the enrollment link.

## 3. Physical Device Testing Flow

1. Open the dashboard via your HTTPS tunnel URL and navigate to **Devices**.
2. Click **Enroll device** and give it a name (e.g., "Test Phone").
3. A pairing URL (with a secure token) will be generated and shown as a QR code or copyable link.
4. Scan the QR code or open the pairing URL on your physical test device.
5. On the device, click **Connect Device** and accept the browser location permission prompt.
6. The device will be successfully enrolled.
7. Return to the dashboard and open the **Live Location** map.
8. As you move around with the test device, its marker will update in real-time without needing to refresh the page.
9. To test the offline ladder, disable the network on the test device. The
   dashboard marks the device **STALE** after the stale threshold (default 20s)
   and **OFFLINE** after the offline threshold (default 45s). A sharing session
   that never resumes auto-expires after the session TTL (default 24h), and
   stored location history is auto-purged after the retention window (default
   24h). On the device share page you can also **Stop sharing**, **Delete my
   history**, and review the audit trail of consent / start / fix / stop /
   expire / delete events.

## 4. Tests

```bash
# Backend (unit + integration against a running PostgreSQL)
cd backend
npm test

# Frontend
cd frontend
npm test
```

The presence ladder is covered by `backend/tests/unit/presence.test.ts`
(`deriveDeviceStatus` + `PresenceManager.stageOf` thresholds). Integration tests
require the database (Docker: `docker compose up -d db`) and skip gracefully
when it is unreachable.
