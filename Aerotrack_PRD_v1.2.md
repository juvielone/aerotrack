# Aerotrack — PRD v1.2 (Brief)

**Sym AI Open 2026 · Hackathon MVP · Revised 18 Oct 2026**
*Understand the journey, not just the destination.*

> **v1.2 changes:** Renamed from FlightSense to Aerotrack. Added team notes: flight status tags, notable flights list, flight sessions, go-around detection, squawk 7600, coverage-aware gap handling, departure/arrival highlighting, diversions, and route-based filters. Items marked **[OPEN]** need a team decision.

---

## 1. What we're building

A responsive, 2D web flight tracker that explains **what an aircraft is observably doing** in plain English. That includes why it may have **disappeared from the map**, be **circling**, show an **unusually steep descent**, or have **aborted a landing**. It also shows clearly **what phase a flight is in**, including whether it has landed. It always separates facts from possible interpretations.

> **Product principle:** Aerotrack is never more confident than its data. It is informational only, not a safety, navigation, or emergency-detection system.

## 2. Users and pain points

- **Travellers and family/friends** following a flight. They want reassurance and plain language.
- **Casual enthusiasts.** They want altitude, speed, heading and movement insight.
- **Out of scope:** pilots, ATC, airline ops, and any safety-critical use.

**Pain points (from Reddit research; 3–5 linked posts go on one pitch slide):**

1. People don't know what holding patterns, rapid descents or squawk codes mean, and assume the worst.
2. People can't easily tell when a flight has landed. They have to zoom in or read altitude and speed themselves.
3. Flight numbers and callsigns don't match neatly (QF12 vs QFA12, or an operational callsign with no obvious link), so search is frustrating.
4. Trackers attach history to the aircraft, not the flight, so one plane's earlier sector can bleed into its next one.

## 3. Data modes

| Mode | Source | Purpose / labelling |
|---|---|---|
| **Live** | ADSB.lol, polled by our backend for the coverage area **[OPEN: Sydney only?]** every 5–10 s | Real traffic. The backend stores recent history per flight session, so a selected aircraft already has a track for the explainer. |
| **Recorded** | Real past tracks: captured during the event, plus the ADSB.lol `globe_history` archive (ODbL) | Reliable, offline-capable demo. Labelled "Recorded flight, [date] — Data: ADSB.lol (ODbL)". |
| **Test fixtures** | Hand-made tracks | Detector unit tests only. Never shown as real. Labelled "Synthetic test case" if demoed. |

Use a hard mode toggle: live and recorded data are never mixed in one view, and no recorded or synthetic record is ever presented as live.

### 3.1 Flight sessions (new)

ICAO hex identifies the aircraft, not the flight. All history and events are stored per **flight session**, not per hex.

- Session key: `hex` + `callsign` + start time.
- A new session starts when the callsign changes, when the aircraft has been on the ground (or unseen) for more than ~20 min, or after a take-off following a landing.
- Events from one session never carry over to the next.

## 4. Behaviour Explainer (signature feature)

The explainer is deterministic and rule-based, and runs on timestamped observations within a flight session. It uses the feed fields `alt_baro` (including `"ground"`), `gs`, `baro_rate`, `track`, `seen_pos`, `squawk`, `emergency` and `category` where available. No LLM decides whether an event happened. All thresholds live in one config file.

| Pattern | Starting rule (tunable) | Example wording |
|---|---|---|
| Sustained climb / descent | ±1,000 ft over ≥ 60 s and ≥ 4 obs, or sustained \|`baro_rate`\| > 500 fpm | "The aircraft is descending. This often happens on approach, but the data doesn't confirm why." |
| Sustained turn | Cumulative track change ≥ 30° within 90 s; ignore < 5° per sample; handle 359°/1° wraparound | "The aircraft is changing direction, possibly as part of its route." |
| Possible holding / circling | Cumulative track change ≥ 300° within ~6 min, roughly level altitude | "Appears to be circling. Aircraft often do this in a holding pattern while waiting to land, but the data alone can't confirm it." |
| Rapid descent | > ~5,000 fpm across ≥ 3 consistent obs for ≥ 30 s, **or** ≥ 10,000 ft lost within 5 min at ≥ 3,000 fpm average (added 18 Oct 2026 for long emergency descents, e.g. a depressurisation at ~3,200 fpm for 8 min) | "Descending unusually quickly (~6,000 ft/min). This can happen for several reasons, and the data doesn't show which." |
| Go-around (new) | See 4.2 | "The aircraft descended towards the runway, then climbed away and landed on a later approach. This is called a go-around and is a routine procedure." |
| Emergency squawk 7700 | `squawk` 7700 or `emergency` = `general` | "This aircraft is transmitting a general emergency code (7700)." Fact only. No cause stated. |
| Radio failure squawk 7600 (new) | `squawk` 7600 or `emergency` = `nordo` | "This aircraft is transmitting code 7600, which signals a loss of radio communication." Fact only. |
| Signal lost / stale | `seen_pos` > 60 s | See 4.3 for coverage-aware wording. |
| Data glitch (spike) | Implied rate > ~20,000 fpm and reverts within 1–2 samples | "One altitude reading was inconsistent and has been ignored." |
| Gap in track | Time between points > stale threshold | "No data between these points. The line shows a gap, not the actual path." |

- Every event stores its evidence (window, start/end values, rate) and shows it in the timeline.
- Short or unreliable history gets an insufficient-history state, not a guess. The same event doesn't trigger repeated alerts.
- Causes are never inferred. For recorded incidents, a reported cause may be shown separately with its source ("Later reported as… [source]").

### 4.1 Flight status tag (new)

A small tag on each selected aircraft and in lists. Derived from `alt_baro`, `gs` and `baro_rate`:

| Tag | Rule (starting point) |
|---|---|
| Taxiing | On ground, `gs` 3–40 kt |
| Taking off | Transition from ground to airborne within last ~60 s, or `gs` > 40 kt on ground |
| Climbing | Airborne, sustained climb |
| Cruising | Above ~20,000 ft, roughly level |
| Descending | Airborne, sustained descent |
| Approach | Descending below ~5,000 ft near the destination airport |
| Landed | Transition from airborne to ground, `gs` < 40 kt |
| Unknown | Insufficient history or stale data |

Note: ground coverage at Sydney may be patchy, so "Taxiing" may often show as stale. "Landed" is the tag that solves pain point 2 and matters most.

### 4.2 Go-around detection (new)

A go-around is a landing that **didn't** happen: the aircraft descends on approach, climbs away, then usually lands on a later attempt. The detector confirms it **retrospectively, once the aircraft has actually landed**, so a normal departure climb is never mislabelled.

1. Find an approach segment: descending, below ~2,000 ft above airport elevation, near an airport, speed decreasing.
2. Find a climb of ≥ ~1,000 ft (or sustained climb with speed increasing) from that segment **without** a ground observation in between.
3. Confirm only when a later landing (ground state) is observed in the same session.
4. Before step 3, live mode shows nothing, or at most "Climbing after approach — possible go-around" **[OPEN]**.

This makes go-around primarily a recorded-mode feature.

### 4.3 Ambiguous gaps (new)

When positions stop arriving, Aerotrack distinguishes three cases instead of one generic "signal lost":

| Cause | How we tell | Wording |
|---|---|---|
| Our feed failed | Backend poll errored, or all aircraft went stale at once | "Live data is temporarily unavailable. This is a problem on our side, not with any aircraft." |
| Known low-coverage area | Last position falls in a low-coverage zone, built from historical point density in our recordings | "This aircraft is over an area where receivers often lose coverage (e.g. over the ocean). This is normal." |
| Unexpected gap | Feed healthy, area normally well covered | "We stopped receiving positions from this aircraft 3 min ago. The cause isn't known from the data. This usually doesn't mean anything happened to the aircraft." |

## 5. UI

- **Map:** MapLibre + OpenFreeMap, 2D only.
- **Selected flight:** details panel (available fields only), status tag, event timeline.
- **Departure / arrival airports:** highlighted on the map when a flight is selected. Source is static route data, so labelled "planned route — may be outdated" **[OPEN]**.
- **Diversions:** diversion airport highlighted in a different colour, with the path towards it styled differently. Only shown once there is evidence: the aircraft lands somewhere other than the planned destination **[OPEN — see questions]**.
- **Notable flights list:** aircraft in the current view with an active event (holding, rapid descent, squawk, go-around, gap), sorted by event severity, one tap to select.
- **Search:** callsign and flight number, mapping flight no. to callsign via airline prefix (QF1 → QFA1). Falls back to "no exact match — did you mean…" for operational callsigns.
- **Bottom bar — filters:**
  - **Airline:** only airlines actually seen in the coverage area (derived from callsign prefixes in recent data, not a hard-coded list).
  - **Aircraft type:** passenger aircraft only by default; excludes military (`dbFlags`), balloons, gliders and other non-airliner `category` values **[OPEN: cargo, GA, helicopters?]**.
  - **Route:** only routes served from the coverage area **[OPEN]**.
  - **Domestic / International:** derived from route data **[OPEN]**.

## 6. MVP scope

| Priority | In scope |
|---|---|
| **P0 — must** | Responsive 2D shell · map · aircraft markers & selection · details panel · ADSB.lol live via backend poller · flight sessions · recorded-flight replay · climb/descent/turn · status tag (at least Landed / Airborne / Unknown) · signal-lost with feed-failure vs aircraft-gap split · glitch & gap handling · live/recorded badge · detector test suite |
| **P1 — should** | Holding/circling · rapid descent · squawk 7700 + 7600 · go-around (recorded) · event timeline · notable flights list · callsign search · airline & aircraft-type filters · full status tag set · known-low-coverage zones · loading/error/empty states · simple mobile panel |
| **P2 — if time** | Departure/arrival highlight · route and domestic/international filters · diversion display · LLM phrasing layer (detector output only) · natural-language search · visual polish |

**[OPEN]** Route-dependent items are P2 here because v1.1 cut them for stale data. Promote them if the team accepts the "may be outdated" label.

### Still cut

- Metadata-only flight preview and second metadata provider (ADSBdb).
- Mixed live/sample view, aircraft photos, airport search, filter persistence, polished bottom sheet.
- 3D view.
- The full Reddit research log (replaced by 3–5 linked posts on one slide).

## 7. Data & compliance

- Attribute ADSB.lol (ODbL) and OpenFreeMap / OpenStreetMap on the map.
- Don't use any Flightradar24 data or exports, and don't copy its interface.
- Use one backend poll shared by all clients to respect rate limits. Keep keys out of client code.
- Recorded mode must run fully offline. Assume the venue Wi-Fi will fail.
- Incident examples sourced from news or Reddit: link the source, and use ADSB.lol archive data for the track itself.

## 8. Demo script

| # | Moment | Data source |
|---|---|---|
| 1 | Live map over Sydney, select an aircraft, show details, status tag and data badge | Live (recorded fallback) |
| 2 | Holding pattern + explanation | Live if one is happening, else recorded backup |
| 3 | Rapid descent + explanation, with the altitude graph | Recorded — flight from a recent news article |
| 4 | Squawk 7700 and 7600 | Recorded — past flights found via Reddit; ideally one genuine 7600 |
| 5 | Go-around + explanation | Recorded past flight |
| 6 | Signal-lost: feed failure vs coverage gap | Live or recorded |
| 7 | Glitch: raw track "cliff" flagged as a bad reading, not a dive | Recorded |
| 8 | Close on the principle: never more confident than the data | — |

**[OPEN]** This is 8 moments. At ~20–30 s each it fits roughly 3–4 min. Confirm the time limit and cut order.

## 9. Judge Q&A prep

| Likely question | Answer angle |
|---|---|
| How is this different from Flightradar24? | FR24 shows data. We explain it, show the flight phase, and say what can't be concluded. Demo signal-lost + glitch. |
| Where's the AI? | Rules are the source of truth by design, for trust. The AI layer phrases explanations and parses natural-language search from structured output. |
| How do you avoid false alarms? | Thresholds, minimum observations, spike/gap rejection, "possible" wording, retrospective go-around confirmation, and evidence shown. |
| How do you know it's the same flight? | Flight sessions, not aircraft hex. |
| Is this real data? | Live badge, ADSB.lol attribution, recorded-flight timestamps and source links. |
| What's next? | Live go-around alerts, holding confirmation against published holds, alerts for a tracked flight. |

## 10. Done when

- [ ] Map, selection and details work on desktop and mobile, with nothing fabricated.
- [ ] At least two behaviour patterns are shown on real (live or recorded) data. Tests pass for noise, wraparound, duplicates, gaps and session splits.
- [ ] A landed flight is clearly shown as landed.
- [ ] Live and recorded data can't be confused, and the app stays usable with the live feed off.
- [ ] Setup steps, env vars, attributions and known limitations are documented in the README.
