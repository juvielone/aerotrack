import { AIRLINES, icaoForIata } from './airlines';

export interface Searchable {
  sessionId: string;
  callsign: string | null;
  reg: string | null;
  hex: string;
}

export interface SearchResult<T extends Searchable> {
  exact: T[];
  suggestions: T[];
}

function levenshtein(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[a.length][b.length];
}

/** Callsigns a typed flight number could correspond to: "QF1" → ["QFA1", "QLK1"]; "QFA1" → ["QFA1"]. */
export function candidateCallsigns(query: string): string[] {
  const q = query.toUpperCase().replace(/\s+/g, '');
  const out = new Set([q]);
  const m = /^([A-Z0-9]{2})(\d{1,4}[A-Z]?)$/.exec(q);
  if (m) {
    for (const icao of icaoForIata(m[1])) out.add(icao + m[2].replace(/^0+/, ''));
  }
  return [...out];
}

/**
 * Search by flight number, callsign, registration or hex. Falls back to "did you mean…" suggestions,
 * since operational callsigns don't always match the flight number (pain point 3).
 */
export function searchFlights<T extends Searchable>(query: string, items: T[]): SearchResult<T> {
  const q = query.toUpperCase().replace(/[\s-]+/g, '');
  if (!q) return { exact: [], suggestions: [] };
  const cands = new Set(candidateCallsigns(q));
  const exact = items.filter(
    (it) => (it.callsign && cands.has(it.callsign)) || it.reg?.replace(/-/g, '') === q || it.hex.toUpperCase() === q,
  );
  if (exact.length) return { exact, suggestions: [] };

  const digits = /\d+/.exec(q)?.[0];
  const prefixes = new Set<string>();
  const iata = /^([A-Z0-9]{2})\d/.exec(q)?.[1];
  if (iata) for (const icao of icaoForIata(iata)) prefixes.add(icao);
  const icao = /^([A-Z]{3})/.exec(q)?.[1];
  if (icao && AIRLINES.some((a) => a.icao === icao)) prefixes.add(icao);

  const scored = items
    .map((it) => {
      const cs = it.callsign ?? '';
      let score = Infinity;
      if (cs.startsWith(q) || it.reg?.replace(/-/g, '').startsWith(q)) score = 0;
      else if (digits && cs.includes(digits) && [...prefixes].some((p) => cs.startsWith(p))) score = 1;
      else if (cs) {
        const d = Math.min(...[...cands].map((c) => levenshtein(c, cs)));
        if (d <= 2) score = 1 + d;
      }
      return { it, score };
    })
    .filter((x) => x.score < Infinity)
    .sort((a, b) => a.score - b.score)
    .slice(0, 6);
  return { exact: [], suggestions: scored.map((x) => x.it) };
}
