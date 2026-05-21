import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
  const corp_code = req.nextUrl.searchParams.get('corp_code')?.trim();
  if (!corp_code) return NextResponse.json({ error: 'corp_code 필수' }, { status: 400 });

  const key = process.env.DART_API_KEY;
  if (!key) return NextResponse.json({ error: 'DART_API_KEY 미설정' }, { status: 500 });

  try {
    const res  = await fetch(
      `https://opendart.fss.or.kr/api/company.json?crtfc_key=${key}&corp_code=${corp_code}`,
    );
    const json = await res.json();

    if (json.status !== '000') {
      return NextResponse.json({ error: json.message ?? 'DART 조회 실패' }, { status: 400 });
    }

    return NextResponse.json({
      corp_name:  json.corp_name,
      bizr_no:    json.bizr_no,    // 사업자등록번호
      stock_code: json.stock_code,
      corp_cls:   json.corp_cls,   // Y=유가증권 K=코스닥 N=코넥스 E=기타
    });
  } catch (e: any) {
    console.error('[dart/verify]', e.message);
    return NextResponse.json({ error: e.message }, { status: 502 });
  }
}
