import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { env } from './env';

/** What the panel needs to show and credit one photo. Image bytes are never stored, only these details. */
export interface AircraftPhoto {
  src: string;
  width: number;
  height: number;
  /** The photo's page on Planespotters.net (credit link). */
  link: string;
  photographer: string;
}

interface CacheEntry {
  photo: AircraftPhoto | null;
  fetchedAt: number;
}

const HIT_TTL_MS = 24 * 3600_000;
const MISS_TTL_MS = 6 * 3600_000;
const TIMEOUT_MS = 5000;
const API = 'https://api.planespotters.net/pub/photos';

/** Planespotters only answers requests whose User-Agent includes a contact (URL or email). */
const userAgent = () => `Aerotrack/0.1 (+${/^https?:\/\//.test(env.contact) ? env.contact : `mailto:${env.contact}`})`;

/**
 * Aircraft photos from Planespotters.net, by hex then registration. Looked up on demand for the selected aircraft
 * only, and cached (details only) in memory and in data/photo-cache.json.
 */
export class PhotoService {
  private cache = new Map<string, CacheEntry>();
  private inFlight = new Map<string, Promise<AircraftPhoto | null>>();
  private path = join(env.dataDir, 'photo-cache.json');
  private saveTimer: NodeJS.Timeout | null = null;

  constructor() {
    if (existsSync(this.path)) {
      try {
        for (const [k, v] of Object.entries(JSON.parse(readFileSync(this.path, 'utf8')) as Record<string, CacheEntry>)) this.cache.set(k, v);
      } catch {
        // Corrupt cache: start empty.
      }
    }
  }

  async lookup(hex: string, reg?: string): Promise<AircraftPhoto | null> {
    const key = hex.trim().toLowerCase();
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.fetchedAt < (hit.photo ? HIT_TTL_MS : MISS_TTL_MS)) return hit.photo;
    const pending = this.inFlight.get(key);
    if (pending) return pending;

    const p = (async () => {
      try {
        let photo = await fetchPhoto(`${API}/hex/${encodeURIComponent(key)}`);
        if (!photo && reg) photo = await fetchPhoto(`${API}/reg/${encodeURIComponent(reg.trim().toUpperCase())}`);
        this.cache.set(key, { photo, fetchedAt: Date.now() });
        this.scheduleSave();
        return photo;
      } catch {
        // Unreachable or refused: an older cached answer beats none, and nothing is remembered as "no photo".
        return hit?.photo ?? null;
      } finally {
        this.inFlight.delete(key);
      }
    })();
    this.inFlight.set(key, p);
    return p;
  }

  private scheduleSave() {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      writeFileSync(this.path, JSON.stringify(Object.fromEntries(this.cache)));
    }, 2000);
  }
}

/** First photo of a Planespotters response, or null when there is none. Throws when the request fails. */
async function fetchPhoto(url: string): Promise<AircraftPhoto | null> {
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { 'User-Agent': userAgent() } });
  if (!res.ok) throw new Error(`Planespotters: HTTP ${res.status}`);
  const body = (await res.json()) as { photos?: any[] };
  const p = body.photos?.[0];
  const img = p?.thumbnail_large ?? p?.thumbnail;
  if (!p || !img?.src || !p.link) return null;
  return { src: img.src, width: img.size?.width ?? 420, height: img.size?.height ?? 280, link: p.link, photographer: p.photographer ?? 'Unknown photographer' };
}
