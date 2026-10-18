# Aerotrack

> **New to the project? Start with [SETUP.md](SETUP.md)**, a step-by-step guide to running it on your laptop.

*Understand the journey, not just the destination.* Built for the Sym AI Open 2026 hackathon. The PRD (`Aerotrack_PRD_v1.2.md`) is the source of truth.

Aerotrack is a responsive 2D flight tracker that explains in plain English what an aircraft is **observably** doing: climbing, descending, turning, circling or holding, rapid descent, go-around, squawk 7700/7600, signal lost and data glitches. It also shows the flight's phase (Landed, Cruising, Approach…). It never claims more than its data supports.

> Informational only. Not a safety, navigation or emergency-detection system.

## Quick start

```bash
npm install
npm run dev          # server :8787 + web :5173 → open http://localhost:5173
npm test             # detector test suite
npm run typecheck
```

Run as a single process for the demo (serves the built web app from the server):

```bash
npm start            # → http://127.0.0.1:8787
```

## Live vs Recorded

The **Live / Recorded** toggle is a hard switch. Each mode opens its own stream, the map is cleared on every switch, and the badge always says which one you're looking at:

- **LIVE** (green): one shared backend poll of the ADS-B feed every 5 s, covering a 250 nm radius around Sydney.
- **RECORDED** (amber): "*date* — Data: *source*". Real past data, replayed through **exactly the same pipeline** as live, with play/pause, scrubbing and 1–60× speed. It runs fully offline. If the venue Wi-Fi drops, the map switches to a bundled offline basemap (Natural Earth outline).
- Synthetic fixtures only exist in the tests and are never served. If one is ever demoed, it's labelled "Synthetic test case".

### Getting demo data

```bash
# Capture real traffic (do this often; holds at SYD happen most mornings/evenings)
npm run record -- --name syd-evening --title "Sydney evening traffic" --minutes 90

# Import a real past incident (news/Reddit) from the ADSB.lol globe_history archive (ODbL)
npm run import:trace -- --id qf-go-around --title "QFxxx go-around at SYD" \
  --source-link https://… --reported-cause "…" path/to/trace_full_7cxxxx.json

# Rebuild known low-coverage zones from all captures
npm run build:coverage
```

Recordings live in `data/recordings/` and are listed in `manifest.json`. Optional manifest fields for the demo:
- `highlights: [{ "label": "Holding over SYD", "ts": <ms>, "hex": "7c…" }]` adds jump-to buttons that select the aircraft.
- `reportedCause` + `sourceLink` show "Later reported as… [source]", kept separate from what the data shows.

### Where is it going? (planned route)

When you select an airliner, a **dashed violet line** runs from the aircraft to its destination. The origin and destination are ringed on the map, and the panel shows e.g. "MEL → SYD · Planned route — may be outdated · Source: ADSBdb".
- Route data comes from **ADSB.lol's routeset**, falling back to **ADSBdb** when ADSB.lol is unreachable. This reverses the PRD v1.2 "ADSBdb still cut" line; the team decided on 18 Oct 2026.
- It's looked up only for the selected flight and cached in `data/route-cache.json`.
- **Plausibility check:** the line is only drawn if the aircraft is roughly between origin and destination. Callsigns get reused and route databases go stale, so an implausible route is reported as not matching instead of drawn. The line is hidden once the aircraft is on the ground.
- For offline demos, run `npm run routes:prefetch -- --recording <id>` while online, so every callsign in a recording has a cached route.

## Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `AEROTRACK_PROVIDER` | `adsblol` | Preferred feed: `adsblol` (ADSB.lol, ODbL) or `adsbfi` (adsb.fi); the other is the automatic fallback |
| `AEROTRACK_LAT` / `AEROTRACK_LON` | `-33.9461` / `151.1772` | Centre of the coverage area (SYD) |
| `AEROTRACK_RADIUS_NM` | `250` | Poll radius |
| `AEROTRACK_POLL_SECONDS` | `5` | Poll interval (min 5) |
| `AEROTRACK_LIVE` | `true` | `false` = offline, recorded-only server |
| `AEROTRACK_CONTACT` | team email | Contact in the User-Agent for Planespotters photo requests (their API requires one); never sent to the browser |
| `AEROTRACK_SHOW_CAPTURES` | `false` | `true` = also list captures in the Recorded tab (normally only the demo example flights) |
| `PORT` / `HOST` | `8787` / `127.0.0.1` | Server bind |

No API keys are needed, and none are ever sent to the client.

## How it works

```
packages/core   pure TS, shared by server and web
  sessions.ts     flight sessions = hex + callsign + start (split on callsign change, >20 min unseen/on ground, take-off after landing)
  clean.ts        altitude-glitch rejection, gap segmentation, vertical rates
  detectors/      climb/descent, turn (wraparound-safe), holding, rapid descent, go-around (retrospective), squawk, gaps
  status.ts       status tag (Taxiing … Landed / Unknown)
  explain.ts      fact-first wording, straight from PRD §4
  pipeline.ts     poll → sessions → detectors → snapshot (same code for live and replay)
  config.ts       every threshold in one place
apps/server     Fastify: live poller, SSE streams, replay engine, recorder/import/coverage scripts
apps/web        Vite + React + MapLibre (OpenFreeMap dark style, offline fallback)
```

Detection is deterministic and rule-based. No LLM decides whether an event happened. Every event stores its evidence (time window, start/end values, rate, observation count), shown under "Why am I seeing this?" and in the timeline.

When positions stop arriving, the signal-lost logic distinguishes three cases: **our feed failed** (poll errors, or every aircraft went stale at once), a **known low-coverage area**, or an **unexpected gap**.

## Attributions

- Aircraft data: [ADSB.lol](https://adsb.lol) (ODbL), or [adsb.fi](https://adsb.fi) when selected. The active source is named on the map and in the badge.
- Map: [OpenFreeMap](https://openfreemap.org) © OpenMapTiles, data © OpenStreetMap contributors. Offline basemap: Natural Earth (public domain).
- Planned routes: ADSB.lol routeset, or [ADSBdb](https://www.adsbdb.com) as fallback (credited on the map while a route is shown).
- Aircraft photos: [Planespotters.net](https://www.planespotters.net), with the photographer credited and linked on each photo. Shown only when the selected aircraft has one, and only with internet.
- No Flightradar24 data or UI is used.

## Known limitations

- **ADSB.lol reachability:** on 18 Oct 2026 `api.adsb.lol` returned HTTP 403, then timed out, from our network, while adsb.fi worked. After 2 failed polls in a row the live poller now fails over to the other provider and stays on it (logged as `[live] switching provider: …`); the badge names whichever feed is in use (refresh an open page to update it). If both feeds are down it backs off and the UI shows "Live data is temporarily unavailable". Set `AEROTRACK_PROVIDER=adsbfi` to try adsb.fi first and skip the startup failures, and check adsb.fi's terms for our use.
- Ground coverage at SYD is patchy, so "Taxiing" often shows as stale, and gaps while on the ground aren't flagged.
- Go-around is confirmed only after a later landing in the same session, so it's mainly a recorded-mode feature. Live mode shows nothing before confirmation (`goAround.showUnconfirmedHint` in `config.ts`).
- Holding detection can't tell a published hold from other circling. Low-level circling (e.g. helicopters) gets neutral wording.
- Imported archive traces are thinned in steady flight, so they use a 120 s gap threshold (`staleSec` in the manifest).
- Planned routes come from static route data and can be wrong or outdated (hence the label and the plausibility check). Route and domestic/international filters and diversion display (P2) are not built yet.
