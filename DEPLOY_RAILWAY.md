# Deploying Aerotrack to Railway — step-by-step for a Claude Code session

> **Who this is for:** a Claude Code session on a different computer that has never seen this project. Follow the steps in order. Each step says what to run, what you should see, and what to do if you don't. Stop and ask the user whenever a step says **ASK**.

---

## 0. What you are deploying (read first)

- **Aerotrack** is a flight tracker for a hackathon demo. It shows aircraft around Sydney on a 2D map and explains, in plain English, what each aircraft is doing (holding, rapid descent, go-around, emergency squawk, signal lost, and more).
- **It's one Node.js server.** That server:
  1. polls a free public aircraft feed (ADSB.lol, with adsb.fi as automatic backup) every 5 seconds;
  2. streams updates to browsers over **Server-Sent Events** (long-lived HTTP responses);
  3. serves the built React web app from the same port;
  4. replays recorded example flights (Recorded tab) from JSON files committed in `data/recorded/`.
- **No database, no API keys, no secrets.** All state is in memory, and the two cache files it writes (`data/route-cache.json`, `data/photo-cache.json`) are disposable.
- **Why Railway:** the app needs an always-on process (5 s polling plus open SSE connections). Serverless hosts (Vercel, Netlify functions) would kill it. Railway runs a normal long-lived Node service, which is what we need.

**Repo:** `https://github.com/juvielone/aerotrack` (branch **`main`**). The user owns it.
**Monorepo layout** (npm workspaces, TypeScript):

```
packages/core   rule engine shared by server and browser (pure TS)
apps/server     Fastify server: live poller, SSE, replay, API, serves apps/web/dist
apps/web        React 19 + Vite 7 + MapLibre front end (built to apps/web/dist)
data/recorded/  committed example flights (the Recorded tab reads these)
```

**Key facts the deployment depends on** (verified on 18 Oct 2026):

| Fact | Where |
|---|---|
| The server reads `PORT` (default 8787) and `HOST` (default **127.0.0.1**). On Railway, `HOST` **must** be `0.0.0.0`, or the app is unreachable. | `apps/server/src/env.ts` |
| If `apps/web/dist` exists, the server serves the web app from it, so the web app must be built during the Railway build. | `apps/server/src/index.ts` |
| The server is started with `tsx` (runs TypeScript directly). `tsx` is a **devDependency** in the root `package.json`. | `apps/server/package.json` → `"start": "tsx src/index.ts"` |
| Health check endpoint: `GET /api/health` → `{"ok":true,…}` | `apps/server/src/index.ts` |
| Node 22 is what the team uses. | — |

---

## 1. Prerequisites on this computer

Run each line and check the output:

```bash
node -v        # must print v22.x.x  (install Node 22 LTS if not)
npm -v         # 10.x is fine
git --version
```

You also need:
- **Access to the GitHub repo** `juvielone/aerotrack`. **ASK** the user if `git clone` fails with a permission error.
- **A Railway account** (https://railway.com), logged in with GitHub so it can see the repo. **ASK** the user to log in or invite you if needed. You can do everything in the Railway web dashboard; the Railway CLI is optional.

---

## 2. Get the code and prove it works locally

```bash
git clone https://github.com/juvielone/aerotrack.git
cd aerotrack
git checkout main
git pull
npm ci
```

Check it's the right version: these files must exist.

```bash
ls apps/server/src/photos.ts packages/core/src/iconClass.ts data/recorded/jq38-go-around-syd.json
```

If any is missing, you're on an old commit. Stop and **ASK** the user.

Run the checks (all must pass):

```bash
npm test            # expect: "79 passed | 5 skipped" (the 5 skipped are empty placeholder files, that's fine)
npm run typecheck   # expect: no output errors
```

Run it the way Railway will (production style, one process):

```bash
npm run build -w @aerotrack/web
HOST=0.0.0.0 PORT=8787 npm run start -w @aerotrack/server
```

On Windows PowerShell, set the variables first: `$env:HOST="0.0.0.0"; $env:PORT="8787"; npm run start -w @aerotrack/server`.

You should see a log line like `[aerotrack] server on http://0.0.0.0:8787 — live: ADSB.lol (ODbL), 250 nm around …`. Then, in another terminal:

```bash
curl http://127.0.0.1:8787/api/health        # {"ok":true,"live":{...},...}
curl http://127.0.0.1:8787/api/recordings     # JSON list with 4 examples: jq38, qf643, qf543, va993
```

Open http://127.0.0.1:8787 in a browser. You should see the map, and planes after ~10 s. A couple of `[live] … poll failed` lines followed by `[live] switching provider: ADSB.lol (ODbL) → adsb.fi` is **normal**: ADSB.lol is sometimes unreachable, and the app switches feeds by itself.

Stop the server (Ctrl+C) before continuing.

---

## 3. Small repo changes for Railway (one branch, one PR)

Make these on a new branch. Don't push to `main` directly.

```bash
git checkout -b deploy/railway
```

### 3a. Pin Node 22 — edit the root `package.json`

Add an `engines` field at the top level (next to `"workspaces"`):

```json
"engines": {
  "node": "22.x"
},
```

**Why:** Railway's builder picks the Node version from `engines`. Without it you might get a different version.

### 3b. Make `tsx` available at runtime — edit the root `package.json`

Move `"tsx"` from `"devDependencies"` to a new `"dependencies"` block (keep the same version string):

```json
"dependencies": {
  "tsx": "^4.19.0"
},
```

Then run `npm install` so `package-lock.json` updates.

**Why:** the server's start command is `tsx src/index.ts`. Some Railway build setups remove devDependencies after the build, which would make the start fail with `tsx: not found`. Moving `tsx` to dependencies removes that risk. Everything else in devDependencies (Vite, TypeScript, Vitest) is only needed at build or test time.

### 3c. Add `railway.json` at the repo root (config as code)

Create `railway.json`:

```json
{
  "$schema": "https://railway.com/railway.schema.json",
  "build": {
    "buildCommand": "npm run build -w @aerotrack/web"
  },
  "deploy": {
    "startCommand": "npm run start -w @aerotrack/server",
    "healthcheckPath": "/api/health",
    "healthcheckTimeout": 120,
    "restartPolicyType": "ON_FAILURE",
    "restartPolicyMaxRetries": 5
  }
}
```

**Why:** it makes Railway build the web app once at build time, start only the server, and wait for `/api/health` before sending traffic. Don't use the root `npm start` as the start command, because it rebuilds the web app on every boot.

> **Check the keys against Railway's current docs** (https://docs.railway.com/reference/config-as-code) before committing. If any key name has changed, use the current one. If config-as-code gives you trouble, delete `railway.json` and set the same values in the dashboard in step 4 (Settings → Build / Deploy).

### 3d. Verify, commit, push, PR

```bash
npm test && npm run typecheck
npm run build -w @aerotrack/web
git add package.json package-lock.json railway.json
git commit -m "Prepare Railway deployment: pin Node 22, tsx at runtime, railway.json"
git push -u origin deploy/railway
```

**ASK** the user to review and merge the pull request into `main`, or ask permission to merge it yourself, e.g. `gh pr create --fill` then `gh pr merge`.

**Never commit:** `.env` files, `node_modules`, `apps/web/dist`, or `data/recordings/*.ndjson` (already gitignored). Don't force-push `main`.

---

## 4. Create the Railway service (dashboard)

1. Railway dashboard → **New Project** → **Deploy from GitHub repo** → choose **`juvielone/aerotrack`**.
2. In the new service → **Settings**:
   - **Source → Branch:** `main`.
   - **Region:** pick the one closest to Sydney, **Southeast Asia (Singapore)**. **ASK** the user if they prefer otherwise.
   - **Build / Deploy:** if you added `railway.json`, these are filled in from it. Otherwise set:
     - Build command: `npm run build -w @aerotrack/web`
     - Start command: `npm run start -w @aerotrack/server`
     - Healthcheck path: `/api/health`
   - **Replicas: exactly 1.** The live feed and the recorded replays live in the server's memory. With 2+ replicas a viewer's requests can hit a different copy and Recorded mode breaks.
   - **Serverless / App sleeping: OFF.** The poller and the browser connections need the process running all the time.
3. **Variables** tab → add:

| Variable | Value | Notes |
|---|---|---|
| `HOST` | `0.0.0.0` | **Required.** Without it the server only listens inside its container and Railway can't reach it. |
| `AEROTRACK_PROVIDER` | *(leave unset)* | Defaults to ADSB.lol with automatic fallback to adsb.fi. Set to `adsbfi` only if the logs show ADSB.lol failing constantly. |
| `AEROTRACK_CONTACT` | *(leave unset)* | Contact for the Planespotters photo API. It defaults to the team's email already in the code. |

   **Do not set `PORT`.** Railway injects it, and the app reads it.
4. **Settings → Networking → Generate Domain.** This gives a public `https://<something>.up.railway.app` URL. If asked for a target port, use the value Railway shows for `PORT` (the app listens on whatever `PORT` Railway provides).
5. Trigger a deploy (Railway usually starts one automatically after you connect the repo). Watch **Deployments → Build Logs**, then **Deploy Logs**.

---

## 5. Verify the deployment

In the Deploy Logs you should see:

```
[aerotrack] server on http://0.0.0.0:<PORT> — live: ADSB.lol (ODbL), 250 nm around -33.9461,151.1772
```

Possibly followed by `[live] switching provider: … → adsb.fi`, which is fine.

Then check from your terminal (replace the URL):

```bash
URL=https://<your-app>.up.railway.app
curl $URL/api/health          # {"ok":true,"live":{"ok":true,...,"down":false},...}
curl $URL/api/config          # "live":{"enabled":true,"source":"ADSB.lol (ODbL)" or "adsb.fi",...}
curl $URL/api/recordings      # 4 examples: jq38-go-around-syd, qf643-7700-syd, qf543-holding-syd, va993-emergency-descent
curl -s $URL/api/photo/7c4a45 # {"photo":{"src":"https://t.plnspttrs.net/...","photographer":"Alvis Lam",...}}
```

In a browser, open the URL and check:

- [ ] **Live:** the map loads (dark basemap) and aircraft appear within ~10–20 s. The top badge says LIVE with a "Data: …" source.
- [ ] **Selection:** clicking an aircraft opens the panel, with a photo (when one exists), the status tag, the "Aerotrack insight" box and the event timeline.
- [ ] **Recorded:** the tab lists exactly 4 example flights. Choosing one auto-selects the aircraft, plays, and **pauses by itself** when the pattern appears, e.g. "Go-around" for JQ38.
- [ ] **Phone:** the page also works on a phone-sized screen.

Report the public URL and the results of the checklist above to the user.

---

## 6. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Deploy "succeeds" but the URL shows *Application failed to respond* / 502, or the health check times out | `HOST` not set to `0.0.0.0` | Add `HOST=0.0.0.0` in Variables and redeploy. |
| Deploy log: `tsx: not found` | devDependencies were pruned | Step 3b (move `tsx` to dependencies) wasn't applied or merged. |
| Build log: Vite / TypeScript errors | Wrong branch or an old commit | Check Settings → Source is `main`, and that `main` contains the files listed in step 2. |
| Wrong Node version in the build log | `engines` missing | Step 3a. |
| Logs repeat `[live] … poll failed` for **both** providers, and the badge says live data is unavailable | Both feeds are blocking Railway's IP range, or are down | Try `AEROTRACK_PROVIDER=adsbfi` and redeploy. If it still fails, **ASK** the user. The Recorded tab keeps working either way (it doesn't need the live feed). |
| Recorded tab is empty | `data/recorded/*.json` missing in the deployed commit | Check `git ls-files data/recorded` on `main`. The four example files must be committed. |
| No aircraft photos | Planespotters unreachable, or it blocked the request | Not fatal; the panel simply hides the photo. Check `curl $URL/api/photo/7c4a45`. |
| Recorded replay controls stop working at random | More than 1 replica | Set replicas to 1. |
| Live updates stop after some minutes | App sleeping / serverless enabled | Turn it off (step 4). |

---

## 7. Things you must NOT do

- Don't add a database, auth, or any new dependency beyond step 3. The app doesn't need them.
- Don't change detector thresholds, `packages/core/src/config.ts`, or anything under `data/recorded/`. They're tuned and tested.
- Don't run more than 1 replica.
- Don't commit secrets or `.env` files. There are no secrets to add.
- Don't force-push or rewrite history on `main`.
- Don't publish the Railway URL anywhere yourself. Give it to the user.

---

## 8. Notes for the user (cost, data terms)

- **Cost:** Railway bills by usage. This app is one small always-on Node process (low CPU, ~100–200 MB RAM), which normally fits within the Hobby plan's included usage. Check the Railway billing page for current pricing.
- **Data terms:** a public URL means real users fetch data through our server.
  - ADSB.lol (ODbL) and OpenFreeMap / OpenStreetMap are credited in the app.
  - **adsb.fi**, used as the fallback, and **Planespotters** photos have their own terms. The README says to check adsb.fi's terms before relying on it. Someone on the team should do that before sharing the URL widely.
- **Ephemeral disk:** Railway's disk resets on every deploy. The route and photo caches simply rebuild; nothing important is lost.
