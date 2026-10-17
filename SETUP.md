# Aerotrack: team setup guide

How to get Aerotrack running on your own laptop (Windows or Mac). Takes about 5 minutes.

---

## 1. What you need

- **Node.js 22 or newer.** Check with `node -v`. Download from https://nodejs.org (the LTS version is fine).
- **Git** (only if you're cloning the repo).

You don't need any API keys or accounts.

## 2. Get the project

Clone the repo, or unzip the project folder you were sent. Then open a terminal **in the project folder** (the one that contains `package.json`).

**Recordings are not in git** because the files are large. Get the `.ndjson` files from our shared drive and copy them into:

```
data/recordings/
```

`data/recordings/manifest.json` is already there and lists them. Without the `.ndjson` files, Recorded mode shows "No recordings yet". Live mode still works.

## 3. Install

```bash
npm install
```

## 4. Run it

> **Right now ADSB.lol (our main live source) is unreachable**, so use adsb.fi for live data. Once ADSB.lol is back, plain `npm run dev` works.

**Windows (PowerShell):**

```powershell
$env:AEROTRACK_PROVIDER="adsbfi"; npm run dev
```

**Mac / Linux / Git Bash:**

```bash
AEROTRACK_PROVIDER=adsbfi npm run dev
```

Then open **http://localhost:5173** in your browser. Planes should appear over Sydney within about 10 seconds.

This runs two things together: the server (port 8787) and the web app (port 5173). Press **Ctrl+C** to stop both.

## 5. Using the app

| What | How |
|---|---|
| **Live vs Recorded** | Toggle at the top right. The badge always says which one you're seeing: green LIVE, or amber RECORDED with the date and data source. |
| **Select a plane** | Click it. The right panel shows its status (Climbing, Cruising, Landed…), a plain-English insight, stats, an altitude chart and an event timeline. |
| **Where it's going** | A selected airliner gets a dashed violet line to its destination and "MEL → SYD" in the panel (planned route, may be outdated). |
| **Why?** | Click "Why am I seeing this?" on the insight card to see the evidence behind it. |
| **Search** | Type a flight number, callsign or rego, e.g. `QF1`, `JST761`, `VH-VQG`. |
| **Notable flights** | Top-left list: circling or holding, rapid descents, emergency codes, go-arounds and lost signals in view. |
| **Filters** | Bottom bar: airlines seen in the data and aircraft types (passenger aircraft by default). |
| **Replay** | In Recorded mode: pick a recording, then play/pause, drag the slider, and change speed (1–60×). |

On a phone-sized screen the panel becomes a bottom sheet.

## 6. Demo day (single process, works offline)

Build once and serve everything from one process:

```bash
npm start
```

Then open **http://127.0.0.1:8787**.

**Before you lose internet**, cache the destination lines for the recordings:

```bash
npm run routes:prefetch
```

**Fully offline (Recorded mode only, no live polling):**

```powershell
# Windows PowerShell
$env:AEROTRACK_LIVE="false"; npm start
```

```bash
# Mac / Linux / Git Bash
AEROTRACK_LIVE=false npm start
```

If the map tiles can't load, the app automatically switches to a built-in offline map (the "Offline basemap" note appears at the top right).

## 7. Useful commands

| Command | What it does |
|---|---|
| `npm test` | Runs the detector test suite |
| `npm run typecheck` | Type-checks everything |
| `npm run record -- --name syd-evening --title "Sydney evening" --minutes 60` | Records live traffic for replay (add `--provider adsbfi` while ADSB.lol is down) |
| `npm run import:trace -- --id my-flight --title "…" trace_full_<hex>.json` | Imports a past flight from the ADSB.lol archive |
| `npm run build:coverage` | Rebuilds the low-coverage zones from recordings |
| `npm run routes:prefetch` | Caches destination routes for all recordings |

See `README.md` for how it works and for every setting.

## 8. Troubleshooting

| Problem | Fix |
|---|---|
| `npm install` fails | Check `node -v` is 22 or newer. |
| "Port 5173/8787 already in use" | Another copy is running. Close that terminal or stop the process, then try again. |
| Badge says **LIVE · feed unavailable** | The live source is down. Restart with `AEROTRACK_PROVIDER=adsbfi` (see step 4), or switch to Recorded. |
| "Can't reach the Aerotrack server" | The server part isn't running or crashed. Look for red `[server]` lines in the terminal and restart `npm run dev`. |
| Recorded mode says "No recordings yet" | Copy the `.ndjson` files into `data/recordings/` (step 2) and refresh the page. |
| No destination line on a plane | Normal for some flights. The route may be unknown, or it doesn't match the plane's position, so we don't draw it. Lines are hidden once a plane is on the ground. |
| Want to open it on your phone (same Wi-Fi) | Run the two parts in separate terminals: `npm run dev -w @aerotrack/server` and `npm run dev -w @aerotrack/web -- --host`, then open the "Network" URL Vite prints. |

> Aerotrack is informational only. It is not a safety, navigation or emergency-detection system.
