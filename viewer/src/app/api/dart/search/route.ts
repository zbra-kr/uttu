import { NextRequest, NextResponse } from 'next/server';
import { inflateRaw } from 'zlib';
import { promisify } from 'util';

const inflateRawAsync = promisify(inflateRaw);

interface CorpEntry { corp_code: string; corp_name: string; stock_code: string; }

let cache: { entries: CorpEntry[]; at: number } | null = null;
const TTL = 3_600_000; // 1시간

async function extractZipFirstEntry(buf: Buffer): Promise<Buffer> {
  const sig = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
  const idx = buf.indexOf(sig);
  if (idx < 0) throw new Error('ZIP signature not found');

  const method  = buf.readUInt16LE(idx + 8);
  const compSz  = buf.readUInt32LE(idx + 18);
  const fnLen   = buf.readUInt16LE(idx + 26);
  const exLen   = buf.readUInt16LE(idx + 28);
  const dataOff = idx + 30 + fnLen + exLen;
  const data    = buf.subarray(dataOff, dataOff + compSz);

  if (method === 0) return data;
  if (method === 8) return inflateRawAsync(data);
  throw new Error(`Unsupported ZIP compression method: ${method}`);
}

function parseCorpXml(xml: string): CorpEntry[] {
  const result: CorpEntry[] = [];
  const re = /<list>([\s\S]*?)<\/list>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const b = m[1];
    const corp_code  = /<corp_code>(\d+)<\/corp_code>/.exec(b)?.[1] ?? '';
    const corp_name  = /<corp_name>([^<]+)<\/corp_name>/.exec(b)?.[1]?.trim() ?? '';
    const stock_code = /<stock_code>\s*([^<]*?)\s*<\/stock_code>/.exec(b)?.[1]?.trim() ?? '';
    if (corp_code && corp_name) result.push({ corp_code, corp_name, stock_code });
  }
  return result;
}

async function getAll(): Promise<CorpEntry[]> {
  if (cache && Date.now() - cache.at < TTL) return cache.entries;

  const key = process.env.DART_API_KEY;
  if (!key) throw new Error('DART_API_KEY not configured');

  const res = await fetch(`https://opendart.fss.or.kr/api/corpCode.xml?crtfc_key=${key}`, {
    next: { revalidate: 3600 },
  });
  if (!res.ok) throw new Error(`DART API ${res.status}`);

  const buf    = Buffer.from(await res.arrayBuffer());
  const xml    = (await extractZipFirstEntry(buf)).toString('utf-8');
  const entries = parseCorpXml(xml);

  cache = { entries, at: Date.now() };
  return entries;
}

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get('q')?.trim() ?? '';
  if (q.length < 1) return NextResponse.json({ results: [] });

  try {
    const all      = await getAll();
    const lower    = q.toLowerCase();
    const results  = all
      .filter(e => e.corp_name.toLowerCase().includes(lower))
      .slice(0, 30);
    return NextResponse.json({ results });
  } catch (e: any) {
    console.error('[dart/search]', e.message);
    return NextResponse.json({ error: e.message }, { status: 502 });
  }
}
