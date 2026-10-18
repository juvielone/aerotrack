// Pulls one aircraft's trace out of the ADSB.lol globe_history archive (ODbL) without saving the whole day.
// Each day is a GitHub release of an uncompressed tar split into parts (~2 GB each), with entries like
// ./traces/<last 2 hex chars>/trace_full_<hex>.json. The tar isn't sorted, so we stream it and stop at the match.

const REPO = (year: string) => `adsblol/globe_history_${year}`;
const LOG_EVERY = 250 * 1024 * 1024;

interface Asset {
  name: string;
  browser_download_url: string;
}

/** The day's prod release assets, in part order (.tar.aa, .tar.ab, …). */
export async function archiveParts(date: string): Promise<{ tag: string; url: string; parts: string[] }> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`--date must be YYYY-MM-DD (got "${date}")`);
  const [year] = date.split('-');
  const prefix = `v${date.replaceAll('-', '.')}-planes-readsb-prod-`;
  const res = await fetch(`https://api.github.com/repos/${REPO(year)}/releases?per_page=100`, { headers: { Accept: 'application/vnd.github+json' } });
  if (!res.ok) throw new Error(`GitHub releases for ${REPO(year)}: HTTP ${res.status}`);
  type Release = { tag_name: string; html_url: string; assets: Asset[] };
  const releases = (await res.json()) as Release[];
  // Older days fall off the first page; look the tag up directly then.
  let rel = releases.find((r) => r.tag_name.startsWith(prefix));
  if (!rel) {
    const direct = await fetch(`https://api.github.com/repos/${REPO(year)}/releases/tags/${prefix}0`);
    if (direct.ok) rel = (await direct.json()) as Release;
  }
  if (!rel) throw new Error(`No ADSB.lol archive release found for ${date} (looked for ${prefix}*)`);
  const parts = rel.assets
    .filter((a) => /\.tar(\.[a-z]{2})?$/.test(a.name))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((a) => a.browser_download_url);
  if (!parts.length) throw new Error(`Release ${rel.tag_name} has no tar parts`);
  return { tag: rel.tag_name, url: rel.html_url, parts };
}

/** Streams the tar parts in order and returns the bytes of trace_full_<hex>.json (often gzipped). */
export async function fetchArchivedTrace(hex: string, parts: string[]): Promise<Buffer> {
  const want = `traces/${hex.slice(-2)}/trace_full_${hex}.json`;
  const tar = new TarScanner((name) => name.replace(/^\.\//, '') === want);
  let seen = 0;
  let nextLog = LOG_EVERY;
  for (const url of parts) {
    const res = await fetch(url);
    if (!res.ok || !res.body) throw new Error(`${url}: HTTP ${res.status}`);
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      seen += value.length;
      if (seen >= nextLog) {
        console.log(`[archive] scanned ${(seen / 1e9).toFixed(2)} GB…`);
        nextLog += LOG_EVERY;
      }
      const found = tar.push(value);
      if (found) {
        await reader.cancel();
        return found;
      }
    }
  }
  throw new Error(`${want} is not in this day's archive (the aircraft may not have been seen that day)`);
}

/** Minimal streaming ustar reader: finds one regular file by name, skipping everything else. */
class TarScanner {
  private header = Buffer.alloc(0);
  private skip = 0;
  private collecting: { size: number; chunks: Buffer[]; got: number } | null = null;
  private longName: string | null = null;
  private readingLongName: { size: number; chunks: Buffer[]; got: number } | null = null;

  constructor(private readonly match: (name: string) => boolean) {}

  push(chunk: Uint8Array): Buffer | null {
    let buf = Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
    while (buf.length) {
      if (this.skip) {
        const n = Math.min(this.skip, buf.length);
        const data = buf.subarray(0, n);
        for (const target of [this.collecting, this.readingLongName]) {
          if (target && target.got < target.size) {
            const take = data.subarray(0, Math.min(n, target.size - target.got));
            target.chunks.push(Buffer.from(take));
            target.got += take.length;
          }
        }
        this.skip -= n;
        buf = buf.subarray(n);
        if (!this.skip) {
          if (this.collecting) return Buffer.concat(this.collecting.chunks);
          if (this.readingLongName) {
            this.longName = Buffer.concat(this.readingLongName.chunks).toString('utf8').replace(/\0.*$/s, '');
            this.readingLongName = null;
          }
        }
        continue;
      }
      const need = 512 - this.header.length;
      this.header = Buffer.concat([this.header, buf.subarray(0, need)]);
      buf = buf.subarray(need);
      if (this.header.length < 512) break;
      const h = this.header;
      this.header = Buffer.alloc(0);
      if (h.every((b) => b === 0)) continue; // end-of-archive padding
      const field = (from: number, len: number) => h.subarray(from, from + len).toString('utf8').replace(/\0.*$/s, '');
      const size = parseInt(field(124, 12).trim() || '0', 8);
      const type = String.fromCharCode(h[156]);
      const prefix = field(345, 155);
      const name = this.longName ?? (prefix ? `${prefix}/${field(0, 100)}` : field(0, 100));
      this.longName = null;
      const padded = Math.ceil(size / 512) * 512;
      if (type === 'L') this.readingLongName = { size, chunks: [], got: 0 };
      else if ((type === '0' || type === '\0') && this.match(name)) {
        this.collecting = { size, chunks: [], got: 0 };
        if (!size) return Buffer.alloc(0);
      }
      this.skip = padded;
    }
    return null;
  }
}
