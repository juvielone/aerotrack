// Pulls one aircraft's trace out of the ADSB.lol globe_history archive (ODbL) without downloading the whole day.
// Each day is a GitHub release of an uncompressed tar split into parts (~2 GB each), with entries like
// ./traces/<last 2 hex chars>/trace_full_<hex>.json. Directories aren't in sorted order, but each directory's
// files are stored together, so we sample small byte ranges to map where each directory sits, then download
// only the target directory (~15 MB instead of ~4 GB).

const REPO = (year: string) => `adsblol/globe_history_${year}`;
const LOG_EVERY = 250 * 1024 * 1024;
/** Layout sampling: one small range every PROBE_SPACING bytes. A directory is ~1/256 of the day (~15 MB). */
const PROBE_SPACING = 4 * 1024 * 1024;
const PROBE_BYTES = 64 * 1024;
const PROBE_CONCURRENCY = 8;

interface Asset {
  name: string;
  size: number;
  browser_download_url: string;
}

export interface ArchivePart {
  url: string;
  size: number;
}

/** The day's prod release assets, in part order (.tar.aa, .tar.ab, …). */
export async function archiveParts(date: string): Promise<{ tag: string; url: string; parts: ArchivePart[] }> {
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
    .map((a) => ({ url: a.browser_download_url, size: a.size }));
  if (!parts.length) throw new Error(`Release ${rel.tag_name} has no tar parts`);
  return { tag: rel.tag_name, url: rel.html_url, parts };
}

const traceName = (hex: string) => `traces/${hex.slice(-2)}/trace_full_${hex}.json`;
const clean = (name: string) => name.replace(/^\.\//, '');

/** Returns the bytes of trace_full_<hex>.json (often gzipped): directory lookup first, full stream as a fallback. */
export async function fetchArchivedTrace(hex: string, parts: ArchivePart[]): Promise<Buffer> {
  const layout = await probeLayout(parts);
  const found = await fetchFromDirectory(parts, layout, hex.slice(-2), (name) => clean(name) === traceName(hex));
  if (found.size) return [...found.values()][0];
  console.log('[archive] not found via directory lookup; streaming the whole day instead');
  return streamForTrace(hex, parts);
}

/** Byte range [start, end) of the concatenated parts, with a few retries per request. */
async function fetchRange(parts: ArchivePart[], start: number, end: number): Promise<Buffer> {
  const out: Buffer[] = [];
  let base = 0;
  for (const p of parts) {
    const from = Math.max(start, base);
    const to = Math.min(end, base + p.size);
    if (from < to) {
      for (let attempt = 1; ; attempt++) {
        try {
          const res = await fetch(p.url, { headers: { Range: `bytes=${from - base}-${to - base - 1}` } });
          if (res.status !== 206) throw new Error(`HTTP ${res.status}`);
          out.push(Buffer.from(await res.arrayBuffer()));
          break;
        } catch (err) {
          if (attempt >= 3) throw err;
        }
      }
    }
    base += p.size;
  }
  return Buffer.concat(out);
}

/** A valid ustar header at `at` in `buf` (magic + checksum), or null. */
function readHeader(buf: Buffer, at: number): { name: string; size: number; type: string } | null {
  if (at + 512 > buf.length || buf.toString('latin1', at + 257, at + 262) !== 'ustar') return null;
  const field = (from: number, len: number) => buf.toString('utf8', at + from, at + from + len).replace(/\0.*$/s, '');
  let sum = 0;
  for (let i = 0; i < 512; i++) sum += i >= 148 && i < 156 ? 32 : buf[at + i];
  if (parseInt(field(148, 8).trim(), 8) !== sum) return null;
  const prefix = field(345, 155);
  return {
    name: prefix ? `${prefix}/${field(0, 100)}` : field(0, 100),
    size: parseInt(field(124, 12).trim() || '0', 8),
    type: String.fromCharCode(buf[at + 156]),
  };
}

/** First valid header in `buf`, which starts at global offset `base` (headers sit on 512-byte archive boundaries). */
function firstHeader(buf: Buffer, base: number): ({ at: number } & NonNullable<ReturnType<typeof readHeader>>) | null {
  for (let at = (512 - (base % 512)) % 512; at + 512 <= buf.length; at += 512) {
    const h = readHeader(buf, at);
    if (h) return { at, ...h };
  }
  return null;
}

export interface LayoutPoint {
  /** Global offset of a tar header, or of the sample itself when it landed inside a large file. */
  offset: number;
  /** Top-level directory and sub-directory, e.g. "traces/45"; INSIDE_FILE when the sample saw no header. */
  dir: string;
}

/** A sample that fell inside one large file (some days start with a ~600 MB file before the traces). */
const INSIDE_FILE = '?';

/** Samples the archive to find which directory each region belongs to (~900 small requests per day). */
export async function probeLayout(parts: ArchivePart[]): Promise<LayoutPoint[]> {
  const total = parts.reduce((n, p) => n + p.size, 0);
  const offsets: number[] = [];
  for (let o = 0; o < total; o += PROBE_SPACING) offsets.push(o);
  const count = offsets.length;
  const points: LayoutPoint[] = [];
  let done = 0;
  const worker = async () => {
    for (;;) {
      const o = offsets.shift();
      if (o === undefined) return;
      const buf = await fetchRange(parts, o, Math.min(o + PROBE_BYTES, total));
      // Headers sit on 512-byte boundaries of the whole archive (each part is a multiple of 512 bytes).
      const h = firstHeader(buf, o);
      if (h) {
        const segs = clean(h.name).split('/');
        points.push({ offset: o + h.at, dir: segs.slice(0, Math.min(2, segs.length - (h.type === '5' ? 0 : 1))).join('/') });
      } else points.push({ offset: o, dir: INSIDE_FILE });
      if (++done % 100 === 0) console.log(`[archive] mapped ${done} of ${count} samples…`);
    }
  };
  await Promise.all(Array.from({ length: PROBE_CONCURRENCY }, worker));
  return points.sort((a, b) => a.offset - b.offset);
}

/** The directory walk downloads this much at a time, and hops over larger files by reading only their headers. */
const WALK_CHUNK = 2 * 1024 * 1024;
const mb = (bytes: number) => (bytes / 1e6).toFixed(1);

/**
 * Reads only the region holding `dir` and returns every file in it that `match` accepts, by name.
 * The walk goes header to header from the last header sample before the directory to the first one after it,
 * so a huge file inside the region (some days have a ~600 MB one) costs one small request instead of a download.
 */
export async function fetchFromDirectory(
  parts: ArchivePart[],
  layout: LayoutPoint[],
  sub: string,
  match: (name: string) => boolean,
  top = 'traces',
): Promise<Map<string, Buffer>> {
  const dir = `${top}/${sub}`;
  const hits = layout.map((p, i) => (p.dir === dir ? i : -1)).filter((i) => i >= 0);
  const out = new Map<string, Buffer>();
  if (!hits.length) return out;
  const total = parts.reduce((n, p) => n + p.size, 0);
  // Samples that landed inside a file may belong to this directory, so look past them for real boundaries.
  let s = hits[0] - 1;
  while (s > 0 && layout[s].dir === INSIDE_FILE) s--;
  let e = hits[hits.length - 1] + 1;
  while (e < layout.length && layout[e].dir === INSIDE_FILE) e++;
  const start = s >= 0 ? layout[s].offset : 0;
  const end = e < layout.length ? layout[e].offset : total;
  console.log(`[archive] reading ${dir} between ${mb(start)} and ${mb(end)} MB, skipping large files`);

  let pos = start; // always a header offset
  let buf: Buffer = Buffer.alloc(0);
  let bufStart = pos;
  let fetched = 0;
  while (pos < end) {
    if (pos < bufStart || pos + 512 > bufStart + buf.length) {
      buf = await fetchRange(parts, pos, Math.min(pos + WALK_CHUNK, total));
      bufStart = pos;
      fetched += buf.length;
    }
    const h = readHeader(buf, pos - bufStart);
    if (!h) break; // end of archive
    const dataStart = pos + 512;
    const dataEnd = dataStart + h.size;
    if ((h.type === '0' || h.type === '\0') && match(h.name)) {
      const inBuf = dataEnd <= bufStart + buf.length;
      const data = inBuf ? buf.subarray(dataStart - bufStart, dataEnd - bufStart) : await fetchRange(parts, dataStart, dataEnd);
      if (!inBuf) fetched += data.length;
      out.set(clean(h.name), Buffer.from(data));
    }
    pos = dataStart + Math.ceil(h.size / 512) * 512;
  }
  console.log(`[archive] read ${mb(fetched)} MB`);
  return out;
}

/** Fallback: streams the tar parts in order until trace_full_<hex>.json goes past. */
async function streamForTrace(hex: string, parts: ArchivePart[]): Promise<Buffer> {
  const want = traceName(hex);
  const tar = new TarScanner((name) => clean(name) === want);
  let seen = 0;
  let nextLog = LOG_EVERY;
  for (const { url } of parts) {
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
