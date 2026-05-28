import { fetchReviews, type ReviewRow } from './queries';

// ── 전체 리뷰 페이지 순회 fetch ─────────────────────────────────────

type FetchOpts = Parameters<typeof fetchReviews>[0];

async function fetchAllReviewRows(opts: FetchOpts): Promise<ReviewRow[]> {
  const PAGE = 500;
  const all: ReviewRow[] = [];
  let offset = 0;
  while (true) {
    const { rows, total } = await fetchReviews({ ...opts, limit: PAGE, offset });
    all.push(...rows);
    if (all.length >= total || rows.length < PAGE) break;
    offset += PAGE;
  }
  return all;
}

// ── 스타일 상수 ────────────────────────────────────────────────────

const HEADER_BG   = 'FF1A1A2E';
const HEADER_FONT = 'FFFFFFFF';
const LOW_BG      = 'FFFDECEA';   // ★1–2
const MID_BG      = 'FFFFF8E1';   // ★3
const HIGH_BG     = 'FFF1F8E9';   // ★4–5
const ALT_BG      = 'FFF8F8FA';

const ratingBg = (r: number) =>
  r <= 2 ? LOW_BG : r === 3 ? MID_BG : HIGH_BG;

function ts(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`;
}

// ── 공통 워크북 빌드 ───────────────────────────────────────────────

async function buildWorkbook(rows: ReviewRow[], sheetName: string) {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  wb.creator  = 'UTTU — B.CAVE';
  wb.created  = new Date();

  const ws = wb.addWorksheet(sheetName, { views: [{ state: 'frozen', ySplit: 1 }] });

  // ── 열 정의 ────────────────────────────────────────────────────
  ws.columns = [
    { header: 'No.',         key: 'no',          width: 6  },
    { header: '리뷰ID',      key: 'review_id',   width: 14 },
    { header: '작성일',      key: 'date',         width: 12 },
    { header: '별점',         key: 'rating',       width: 7  },
    { header: '별점표시',     key: 'stars',        width: 10 },
    { header: '리뷰 내용',   key: 'text',         width: 60 },
    { header: '도움됨',      key: 'helpful',      width: 8  },
    { header: '이미지첨부',  key: 'has_img',      width: 9  },
    { header: '이미지수',    key: 'img_cnt',      width: 8  },
    { header: '이미지1',     key: 'img1',         width: 42 },
    { header: '이미지2',     key: 'img2',         width: 42 },
    { header: '이미지3',     key: 'img3',         width: 42 },
    { header: '이미지4',     key: 'img4',         width: 42 },
    { header: '이미지5',     key: 'img5',         width: 42 },
    { header: '상품번호',    key: 'no_prod',      width: 12 },
    { header: '상품명',      key: 'prod_name',    width: 35 },
    { header: '브랜드',      key: 'brand',        width: 16 },
    { header: '무신사 상품', key: 'prod_url',     width: 44 },
  ];

  // ── 헤더 행 스타일 ──────────────────────────────────────────────
  const hdr = ws.getRow(1);
  hdr.font    = { name: 'Malgun Gothic', bold: true, size: 10, color: { argb: HEADER_FONT } };
  hdr.fill    = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_BG } };
  hdr.height  = 20;
  hdr.alignment = { vertical: 'middle', horizontal: 'center' };
  ws.autoFilter = { from: 'A1', to: 'R1' };

  // ── 데이터 행 ───────────────────────────────────────────────────
  for (let i = 0; i < rows.length; i++) {
    const r   = rows[i];
    const alt = i % 2 === 1;
    const bg  = ratingBg(r.rating);
    const prodUrl = `https://www.musinsa.com/products/${r.musinsa_no}`;

    const row = ws.addRow({
      no:        i + 1,
      review_id: r.musinsa_review_id,
      date:      r.review_date,
      rating:    r.rating,
      stars:     '★'.repeat(r.rating) + '☆'.repeat(5 - r.rating),
      text:      r.review_text ?? '',
      helpful:   r.helpful_count,
      has_img:   r.has_image ? 'O' : '',
      img_cnt:   r.image_urls.length || '',
      img1:      '',
      img2:      '',
      img3:      '',
      img4:      '',
      img5:      '',
      no_prod:   r.musinsa_no,
      prod_name: r.product_name,
      brand:     r.brand_name,
      prod_url:  '',
    });

    row.height = 50;

    // 이미지 URL 하이퍼링크 (최대 5개)
    const imgKeys = ['img1', 'img2', 'img3', 'img4', 'img5'] as const;
    r.image_urls.slice(0, 5).forEach((url, idx) => {
      const cell = row.getCell(imgKeys[idx]);
      cell.value = { text: `이미지${idx + 1} 열기`, hyperlink: url };
      cell.font  = { color: { argb: 'FF0070F3' }, underline: true, size: 9 };
    });

    // 상품 링크
    const prodCell = row.getCell('prod_url');
    prodCell.value = { text: r.product_name, hyperlink: prodUrl };
    prodCell.font  = { color: { argb: 'FF0070F3' }, underline: true, size: 9 };

    // 별점 색상
    const starCell = row.getCell('stars');
    starCell.font  = {
      bold: true, size: 10,
      color: { argb: r.rating <= 2 ? 'FFD32F2F' : r.rating === 3 ? 'FFF57C00' : 'FF2E7D32' },
    };

    // 행 배경
    row.eachCell({ includeEmpty: true }, (cell, colNum) => {
      const key = ws.columns[colNum - 1]?.key;
      if (key === 'img1' || key === 'img2' || key === 'img3' || key === 'img4' || key === 'img5') return;
      if (key === 'prod_url') return;
      if (key === 'stars') return;
      cell.fill = {
        type: 'pattern', pattern: 'solid',
        fgColor: { argb: key === 'rating' || key === 'stars' ? bg : alt ? ALT_BG : 'FFFFFFFF' },
      };
      if (!cell.font) cell.font = { size: 9 };
      else cell.font = { ...cell.font, size: cell.font.size ?? 9 };
    });

    // 텍스트 셀 랩
    row.getCell('text').alignment = { wrapText: true, vertical: 'top', shrinkToFit: false };
    row.getCell('prod_name').alignment = { wrapText: true, vertical: 'top' };

    // 테두리
    row.eachCell({ includeEmpty: true }, cell => {
      cell.border = {
        bottom: { style: 'thin', color: { argb: 'FFE0E0E0' } },
      };
    });
  }

  // 요약 행
  const sumRow = ws.addRow({
    no: `총 ${rows.length.toLocaleString()}건`,
  });
  sumRow.font  = { bold: true, size: 10 };
  sumRow.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF0F0F0' } };
  sumRow.height = 18;

  return wb;
}

// ── 퍼블릭 API ──────────────────────────────────────────────────────

/** 조회 탭 — 현재 필터 전체 다운로드 */
export async function exportBrowseReviews(
  opts: Omit<FetchOpts, 'limit' | 'offset'>,
  onProgress?: (msg: string) => void,
): Promise<void> {
  onProgress?.('데이터 로딩 중…');
  const rows = await fetchAllReviewRows(opts);
  onProgress?.(`${rows.length}건 엑셀 생성 중…`);
  const wb = await buildWorkbook(rows, '리뷰 조회');
  const buf = await wb.xlsx.writeBuffer();
  download(buf, `reviews_${ts()}.xlsx`);
  onProgress?.('완료');
}

/** 상품별 조회 탭 — 선택 상품의 전체 리뷰 다운로드 */
export async function exportProductReviews(
  productId: string,
  productName: string,
  opts: Omit<FetchOpts, 'limit' | 'offset' | 'productId'>,
  onProgress?: (msg: string) => void,
): Promise<void> {
  onProgress?.('데이터 로딩 중…');
  const rows = await fetchAllReviewRows({ ...opts, productId, ownOnly: false });
  onProgress?.(`${rows.length}건 엑셀 생성 중…`);
  const wb = await buildWorkbook(rows, productName.slice(0, 31));
  const buf = await wb.xlsx.writeBuffer();
  const safe = productName.replace(/[/\\?%*:|"<>]/g, '_').slice(0, 40);
  download(buf, `${safe}_reviews_${ts()}.xlsx`);
  onProgress?.('완료');
}

function download(buffer: ArrayBuffer | Buffer, filename: string) {
  const blob = new Blob([buffer as ArrayBuffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}
