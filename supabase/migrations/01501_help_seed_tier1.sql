-- ============================================================
-- UTTU — In-App Guide Seed Data (Tier 1)
-- Migration: 01501_help_seed_tier1.sql
-- Version: 1.0  Date: 2026-06-17
--
-- 가이드 7개 삽입 (비공개 상태 — 정호철이 검토 후 게시)
-- 대상 페이지: /today /ranking /brand-ranking /anomaly /companies /reviews /
--
-- ⚠️  자동 적용 금지 — 정호철이 Supabase SQL Editor에서 수동 적용.
-- ⚠️  전체 파일을 한 번에 실행.
-- ⚠️  01500_help_articles.sql 가 먼저 적용되어 있어야 함.
-- ============================================================


-- ── 1. 오늘의 매거진 (/today) ─────────────────────────────────────────────────
INSERT INTO public.help_articles (slug, title, page_path, category, sort_order, content, is_published)
VALUES (
  'today-guide',
  '오늘의 매거진 사용 가이드',
  '/today',
  '주요기능',
  1,
  '{
    "type": "doc",
    "content": [
      {
        "type": "heading",
        "attrs": {"level": 2},
        "content": [{"type": "text", "text": "한 줄 요약"}]
      },
      {
        "type": "paragraph",
        "content": [{"type": "text", "text": "AI가 매일 아침 무신사 데이터를 분석하여 경영진·기획팀·CS팀 각 부서에 맞춘 브리핑을 자동으로 제공합니다."}]
      },
      {
        "type": "heading",
        "attrs": {"level": 2},
        "content": [{"type": "text", "text": "어떤 정보를 보여주나요?"}]
      },
      {
        "type": "paragraph",
        "content": [{"type": "text", "text": "화면 상단의 탭 3개로 구성되어 있습니다."}]
      },
      {
        "type": "heading",
        "attrs": {"level": 3},
        "content": [{"type": "text", "text": "경영진 탭"}]
      },
      {
        "type": "paragraph",
        "content": [{"type": "text", "text": "당일 핵심 요약 문장과 경쟁 브랜드 동향, 자사 랭킹, 이상탐지, 외부 뉴스를 카드 형식으로 확인하실 수 있습니다. 자사 브랜드 KPI 지표도 함께 표시됩니다."}]
      },
      {
        "type": "heading",
        "attrs": {"level": 3},
        "content": [{"type": "text", "text": "기획/영업 탭"}]
      },
      {
        "type": "paragraph",
        "content": [{"type": "text", "text": "자사 랭킹, 프로모션 현황, 이상탐지, 고객 리뷰, 경쟁 브랜드 동향, DART 공시(금융감독원 전자공시시스템 등록 발표), 트렌드, 외부 뉴스 8개 영역의 요약을 제공합니다."}]
      },
      {
        "type": "heading",
        "attrs": {"level": 3},
        "content": [{"type": "text", "text": "CS 탭"}]
      },
      {
        "type": "paragraph",
        "content": [{"type": "text", "text": "오늘의 리뷰, 저점 패턴, 고점 패턴, 문제 상품 4개 카드로 고객 반응을 요약합니다."}]
      },
      {
        "type": "paragraph",
        "content": [{"type": "text", "text": "상단 날짜 선택 영역에서 최근 60일치 브리핑을 조회하실 수 있습니다. 탭 이름 아래에는 해당 탭 브리핑의 핵심 요약이 한 줄로 미리 표시됩니다."}]
      },
      {
        "type": "heading",
        "attrs": {"level": 2},
        "content": [{"type": "text", "text": "이렇게 사용해보세요"}]
      },
      {
        "type": "heading",
        "attrs": {"level": 3},
        "content": [{"type": "text", "text": "출근 직후 하루 요약 확인하기"}]
      },
      {
        "type": "paragraph",
        "content": [{"type": "text", "text": "경영진 탭을 열면 당일 무신사 핵심 동향을 한눈에 확인하실 수 있습니다. 중요한 변화가 있을 경우 카드 안에 AI 코멘트가 표시됩니다."}]
      },
      {
        "type": "heading",
        "attrs": {"level": 3},
        "content": [{"type": "text", "text": "어제 브리핑 다시 확인하기"}]
      },
      {
        "type": "paragraph",
        "content": [{"type": "text", "text": "날짜 선택 영역에서 원하는 날짜를 클릭하시면 해당 날짜의 브리핑으로 이동합니다. 최근 60일치 브리핑이 날짜별로 저장되어 있습니다."}]
      },
      {
        "type": "heading",
        "attrs": {"level": 3},
        "content": [{"type": "text", "text": "카드에서 상세 화면으로 이동하기"}]
      },
      {
        "type": "paragraph",
        "content": [{"type": "text", "text": "자사 랭킹, 이상탐지 등 각 카드에는 해당 상세 화면 링크가 포함되어 있습니다. 카드를 클릭하면 관련 분석 화면으로 바로 이동하실 수 있습니다."}]
      },
      {
        "type": "heading",
        "attrs": {"level": 3},
        "content": [{"type": "text", "text": "부서별 탭 전환하기"}]
      },
      {
        "type": "paragraph",
        "content": [{"type": "text", "text": "탭을 전환해도 날짜 선택이 유지됩니다. 탭에 따라 AI 브리핑 내용과 구성 카드가 다르게 표시됩니다."}]
      },
      {
        "type": "heading",
        "attrs": {"level": 2},
        "content": [{"type": "text", "text": "관련 기능"}]
      },
      {
        "type": "bulletList",
        "content": [
          {"type": "listItem", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "상품 랭킹 — 브리핑에 언급된 상품 순위를 상세하게 조회할 수 있습니다."}]}]},
          {"type": "listItem", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "브랜드 랭킹 — 경쟁 브랜드 동향을 더욱 상세하게 확인할 수 있습니다."}]}]},
          {"type": "listItem", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "이상탐지 — 오늘 발생한 이상 신호 전체 목록을 확인할 수 있습니다."}]}]},
          {"type": "listItem", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "자사 리뷰 — CS 탭 카드에서 오늘의 리뷰 전체를 조회할 수 있습니다."}]}]}
        ]
      },
      {
        "type": "heading",
        "attrs": {"level": 2},
        "content": [{"type": "text", "text": "자주 묻는 질문"}]
      },
      {
        "type": "paragraph",
        "content": [{"type": "text", "marks": [{"type": "bold"}], "text": "Q: 오늘 브리핑이 표시되지 않습니다."}]
      },
      {
        "type": "paragraph",
        "content": [{"type": "text", "text": "A: 브리핑은 매일 오전 6시에 자동으로 생성됩니다. 오전 6시 이전에는 이전 날짜의 브리핑을 조회하시기 바랍니다."}]
      },
      {
        "type": "paragraph",
        "content": [{"type": "text", "marks": [{"type": "bold"}], "text": "Q: 탭별로 내용이 다른 이유는 무엇인가요?"}]
      },
      {
        "type": "paragraph",
        "content": [{"type": "text", "text": "A: 경영진·기획/영업·CS 각 부서의 업무 관점에 맞게 AI가 서로 다른 관점으로 브리핑을 구성합니다."}]
      },
      {
        "type": "paragraph",
        "content": [{"type": "text", "marks": [{"type": "bold"}], "text": "Q: 카드가 일부만 표시될 때가 있습니다."}]
      },
      {
        "type": "paragraph",
        "content": [{"type": "text", "text": "A: 해당 날짜에 관련 데이터가 없을 경우 카드가 표시되지 않습니다. 데이터 수집 결과에 따라 카드 수가 달라질 수 있습니다."}]
      }
    ]
  }'::jsonb,
  false
);


-- ── 2. 상품 랭킹 (/ranking) ───────────────────────────────────────────────────
INSERT INTO public.help_articles (slug, title, page_path, category, sort_order, content, is_published)
VALUES (
  'ranking-guide',
  '상품 랭킹 사용 가이드',
  '/ranking',
  '주요기능',
  2,
  '{
    "type": "doc",
    "content": [
      {
        "type": "heading",
        "attrs": {"level": 2},
        "content": [{"type": "text", "text": "한 줄 요약"}]
      },
      {
        "type": "paragraph",
        "content": [{"type": "text", "text": "무신사에서 매일 수집한 상품 랭킹 스냅샷을 카테고리, 성별, 연령대, 가격대 등 다양한 조건으로 조회하실 수 있습니다."}]
      },
      {
        "type": "heading",
        "attrs": {"level": 2},
        "content": [{"type": "text", "text": "어떤 정보를 보여주나요?"}]
      },
      {
        "type": "heading",
        "attrs": {"level": 3},
        "content": [{"type": "text", "text": "좌측 필터 영역"}]
      },
      {
        "type": "bulletList",
        "content": [
          {"type": "listItem", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "기간: 오늘·7일·30일·90일·직접 입력"}]}]},
          {"type": "listItem", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "카테고리: 전체·상의·아우터·바지·가방 등 13개"}]}]},
          {"type": "listItem", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "성별: 전체·남성·여성"}]}]},
          {"type": "listItem", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "연령대: 전체·20세 미만·20~25세·25~30세·30~35세·35~40세·40세 이상"}]}]},
          {"type": "listItem", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "가격대: 슬라이더 또는 직접 입력 (0~50만원 이상)"}]}]},
          {"type": "listItem", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "회사·브랜드: 검색으로 추가, 복수 선택 가능"}]}]},
          {"type": "listItem", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "옵션: 자사 상품만 / 순위 변동 항목만"}]}]}
        ]
      },
      {
        "type": "heading",
        "attrs": {"level": 3},
        "content": [{"type": "text", "text": "우측 결과 테이블"}]
      },
      {
        "type": "paragraph",
        "content": [{"type": "text", "text": "순위, 변동(▲/▼/신규), 상품 이미지, 상품명, 브랜드·회사, 카테고리, 성별·연령대, 판매가·소비자가, 할인율, 리뷰 점수·수가 표시됩니다."}]
      },
      {
        "type": "paragraph",
        "content": [{"type": "text", "text": "자사 상품은 상품명과 브랜드명이 강조 색상으로 표시됩니다. 1회 조회 시 최대 300개 항목을 불러오며 50개씩 나누어 표시합니다."}]
      },
      {
        "type": "heading",
        "attrs": {"level": 2},
        "content": [{"type": "text", "text": "이렇게 사용해보세요"}]
      },
      {
        "type": "heading",
        "attrs": {"level": 3},
        "content": [{"type": "text", "text": "자사 상품 순위만 빠르게 확인하기"}]
      },
      {
        "type": "paragraph",
        "content": [{"type": "text", "text": "좌측 옵션에서 '자사 상품만'을 활성화하시면 자사 브랜드 상품의 현재 순위와 변동을 빠르게 확인하실 수 있습니다."}]
      },
      {
        "type": "heading",
        "attrs": {"level": 3},
        "content": [{"type": "text", "text": "특정 카테고리·성별 랭킹 분석하기"}]
      },
      {
        "type": "paragraph",
        "content": [{"type": "text", "text": "카테고리와 성별을 선택한 후 조회하시면 해당 세그먼트의 상위 상품과 경쟁 현황을 파악하실 수 있습니다."}]
      },
      {
        "type": "heading",
        "attrs": {"level": 3},
        "content": [{"type": "text", "text": "기간별 순위 추이 확인하기"}]
      },
      {
        "type": "paragraph",
        "content": [{"type": "text", "text": "기간을 7일·30일로 변경하시면 날짜별 스냅샷이 행으로 나열되어 순위 변화 추이를 확인하실 수 있습니다."}]
      },
      {
        "type": "heading",
        "attrs": {"level": 3},
        "content": [{"type": "text", "text": "결과를 CSV로 저장하기"}]
      },
      {
        "type": "paragraph",
        "content": [{"type": "text", "text": "우상단 CSV 버튼을 누르시면 현재 필터가 적용된 전체 결과를 파일로 저장하실 수 있습니다."}]
      },
      {
        "type": "heading",
        "attrs": {"level": 3},
        "content": [{"type": "text", "text": "자주 쓰는 필터 저장하기"}]
      },
      {
        "type": "paragraph",
        "content": [{"type": "text", "text": "필터 영역 상단의 저장 기능을 활용하시면 자주 사용하는 필터 조합에 이름을 붙여 저장하고 다음에 불러오실 수 있습니다."}]
      },
      {
        "type": "heading",
        "attrs": {"level": 2},
        "content": [{"type": "text", "text": "관련 기능"}]
      },
      {
        "type": "bulletList",
        "content": [
          {"type": "listItem", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "상품 상세 — 행을 클릭하면 해당 상품의 가격 추이, 리뷰 통계를 확인하실 수 있습니다."}]}]},
          {"type": "listItem", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "브랜드 랭킹 — 상품 단위가 아닌 브랜드 단위로 집계된 랭킹을 확인하실 수 있습니다."}]}]},
          {"type": "listItem", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "홈 대시보드 — 오늘의 상품 랭킹 TOP10 위젯에서 빠른 현황 확인이 가능합니다."}]}]}
        ]
      },
      {
        "type": "heading",
        "attrs": {"level": 2},
        "content": [{"type": "text", "text": "자주 묻는 질문"}]
      },
      {
        "type": "paragraph",
        "content": [{"type": "text", "marks": [{"type": "bold"}], "text": "Q: 회사 필터와 브랜드 필터의 차이는 무엇인가요?"}]
      },
      {
        "type": "paragraph",
        "content": [{"type": "text", "text": "A: 회사는 법인명을, 브랜드는 상품 브랜드 레이블을 기준으로 필터링합니다. 하나의 회사가 여러 브랜드를 보유할 수 있습니다."}]
      },
      {
        "type": "paragraph",
        "content": [{"type": "text", "marks": [{"type": "bold"}], "text": "Q: 기간을 바꾸면 같은 상품이 여러 행으로 나타납니다."}]
      },
      {
        "type": "paragraph",
        "content": [{"type": "text", "text": "A: 날짜별 스냅샷이 각각 한 행으로 표시됩니다. 여러 날짜를 조회할 때는 날짜 컬럼이 추가되어 날짜별 순위를 비교하실 수 있습니다."}]
      },
      {
        "type": "paragraph",
        "content": [{"type": "text", "marks": [{"type": "bold"}], "text": "Q: 필터를 적용했는데 결과가 즉시 반영되지 않을 때가 있습니다."}]
      },
      {
        "type": "paragraph",
        "content": [{"type": "text", "text": "A: 카테고리·성별·연령대·기간은 서버에서 새로 조회합니다. 회사·브랜드·가격·자사 여부 필터는 불러온 데이터에서 즉시 적용됩니다."}]
      }
    ]
  }'::jsonb,
  false
);


-- ── 3. 브랜드 랭킹 (/brand-ranking) ──────────────────────────────────────────
INSERT INTO public.help_articles (slug, title, page_path, category, sort_order, content, is_published)
VALUES (
  'brand-ranking-guide',
  '브랜드 랭킹 사용 가이드',
  '/brand-ranking',
  '주요기능',
  3,
  '{
    "type": "doc",
    "content": [
      {
        "type": "heading",
        "attrs": {"level": 2},
        "content": [{"type": "text", "text": "한 줄 요약"}]
      },
      {
        "type": "paragraph",
        "content": [{"type": "text", "text": "상품 랭킹 데이터를 브랜드 단위로 집계하여 경쟁 브랜드와 자사 브랜드의 무신사 내 성과를 비교하실 수 있습니다."}]
      },
      {
        "type": "heading",
        "attrs": {"level": 2},
        "content": [{"type": "text", "text": "어떤 정보를 보여주나요?"}]
      },
      {
        "type": "heading",
        "attrs": {"level": 3},
        "content": [{"type": "text", "text": "브랜드 테이블"}]
      },
      {
        "type": "bulletList",
        "content": [
          {"type": "listItem", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "TOP100 수: 해당 브랜드가 랭킹 TOP100 안에 진입한 상품 개수"}]}]},
          {"type": "listItem", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "평균 순위: 랭킹에 집계된 상품들의 평균 순위 (숫자가 낮을수록 상위)"}]}]},
          {"type": "listItem", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "최고 순위: 해당 브랜드 상품 중 가장 높은 순위"}]}]},
          {"type": "listItem", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "랭킹 상품 수(SKU): 랭킹에 집계된 전체 상품 수"}]}]},
          {"type": "listItem", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "평균 할인율, 평균 가격, 평균 리뷰 점수, 리뷰 수 합계"}]}]}
        ]
      },
      {
        "type": "heading",
        "attrs": {"level": 3},
        "content": [{"type": "text", "text": "기간 선택 시 변동 비교"}]
      },
      {
        "type": "paragraph",
        "content": [{"type": "text", "text": "기간을 7일·30일 등으로 선택하시면 기간 시작일 대비 변동폭(▲/▼)이 TOP100 수와 평균 순위 컬럼에 함께 표시됩니다."}]
      },
      {
        "type": "heading",
        "attrs": {"level": 2},
        "content": [{"type": "text", "text": "이렇게 사용해보세요"}]
      },
      {
        "type": "heading",
        "attrs": {"level": 3},
        "content": [{"type": "text", "text": "경쟁 브랜드 TOP10 확인하기"}]
      },
      {
        "type": "paragraph",
        "content": [{"type": "text", "text": "카테고리와 성별을 선택하신 후 TOP100 수 기준으로 정렬하시면 해당 세그먼트에서 가장 강세인 브랜드를 순서대로 확인하실 수 있습니다."}]
      },
      {
        "type": "heading",
        "attrs": {"level": 3},
        "content": [{"type": "text", "text": "자사 브랜드만 빠르게 보기"}]
      },
      {
        "type": "paragraph",
        "content": [{"type": "text", "text": "좌측 필터에서 '자사 브랜드만'을 선택하시면 B.CAVE 브랜드의 성과 지표를 한눈에 확인하실 수 있습니다."}]
      },
      {
        "type": "heading",
        "attrs": {"level": 3},
        "content": [{"type": "text", "text": "최근 30일 성장 추이 확인하기"}]
      },
      {
        "type": "paragraph",
        "content": [{"type": "text", "text": "기간을 30일로 선택하시면 한 달 전 대비 각 브랜드의 TOP100 수와 평균 순위 변동을 확인하실 수 있습니다."}]
      },
      {
        "type": "heading",
        "attrs": {"level": 3},
        "content": [{"type": "text", "text": "브랜드 상세 정보 확인하기"}]
      },
      {
        "type": "paragraph",
        "content": [{"type": "text", "text": "테이블에서 브랜드 행을 클릭하시면 해당 브랜드의 상세 페이지로 이동합니다. 상품별 순위와 세부 지표를 확인하실 수 있습니다."}]
      },
      {
        "type": "heading",
        "attrs": {"level": 2},
        "content": [{"type": "text", "text": "관련 기능"}]
      },
      {
        "type": "bulletList",
        "content": [
          {"type": "listItem", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "브랜드 상세 — 브랜드 클릭 시 상품별 순위, 가격, 리뷰 현황을 확인하실 수 있습니다."}]}]},
          {"type": "listItem", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "상품 랭킹 — 상품 단위로 세부적인 순위를 조회할 수 있습니다."}]}]},
          {"type": "listItem", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "홈 대시보드 — 브랜드 랭킹 TOP10 위젯에서 빠른 확인이 가능합니다."}]}]}
        ]
      },
      {
        "type": "heading",
        "attrs": {"level": 2},
        "content": [{"type": "text", "text": "자주 묻는 질문"}]
      },
      {
        "type": "paragraph",
        "content": [{"type": "text", "marks": [{"type": "bold"}], "text": "Q: TOP100 수와 랭킹 상품 수의 차이는 무엇인가요?"}]
      },
      {
        "type": "paragraph",
        "content": [{"type": "text", "text": "A: TOP100 수는 TOP100 안에 진입한 상품의 개수이고, 랭킹 상품 수는 랭킹 전체에 한 번이라도 집계된 상품의 총 개수입니다."}]
      },
      {
        "type": "paragraph",
        "content": [{"type": "text", "marks": [{"type": "bold"}], "text": "Q: 기간을 '오늘'로 선택하면 변동 수치가 보이지 않습니다."}]
      },
      {
        "type": "paragraph",
        "content": [{"type": "text", "text": "A: 변동은 선택한 기간의 시작일과 비교하여 계산됩니다. '오늘'을 선택하면 비교 기준이 없어 변동 컬럼이 표시되지 않습니다."}]
      },
      {
        "type": "paragraph",
        "content": [{"type": "text", "marks": [{"type": "bold"}], "text": "Q: 평균 순위 숫자가 낮을수록 좋은 건가요?"}]
      },
      {
        "type": "paragraph",
        "content": [{"type": "text", "text": "A: 맞습니다. 순위 숫자가 낮을수록 상위를 의미합니다. 평균 순위 10은 평균적으로 10위권 내에 상품이 위치한다는 뜻입니다."}]
      }
    ]
  }'::jsonb,
  false
);


-- ── 4. 이상탐지 (/anomaly) ────────────────────────────────────────────────────
INSERT INTO public.help_articles (slug, title, page_path, category, sort_order, content, is_published)
VALUES (
  'anomaly-guide',
  '이상탐지 사용 가이드',
  '/anomaly',
  '분석',
  4,
  '{
    "type": "doc",
    "content": [
      {
        "type": "heading",
        "attrs": {"level": 2},
        "content": [{"type": "text", "text": "한 줄 요약"}]
      },
      {
        "type": "paragraph",
        "content": [{"type": "text", "text": "이상탐지(평소와 다른 변화를 자동으로 감지하는 기능)를 통해 상품 순위, 가격, 리뷰, 프로모션 영역의 급격한 변화를 빠르게 파악하실 수 있습니다."}]
      },
      {
        "type": "heading",
        "attrs": {"level": 2},
        "content": [{"type": "text", "text": "어떤 정보를 보여주나요?"}]
      },
      {
        "type": "heading",
        "attrs": {"level": 3},
        "content": [{"type": "text", "text": "탐지 이벤트 9가지"}]
      },
      {
        "type": "bulletList",
        "content": [
          {"type": "listItem", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "순위 급등: 경쟁 상품의 순위가 하루 사이에 크게 올라간 경우"}]}]},
          {"type": "listItem", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "자사 순위 이탈: 자사 상품 순위가 크게 하락한 경우"}]}]},
          {"type": "listItem", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "TOP10 신규 진입: 새로운 상품이 TOP10에 처음 진입한 경우"}]}]},
          {"type": "listItem", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "품절 전환: 상품이 품절 상태로 변경된 경우"}]}]},
          {"type": "listItem", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "가격 급락: 상품 가격이 급격히 내려간 경우"}]}]},
          {"type": "listItem", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "고할인 프로모션: 프로모션 할인율이 기준을 초과한 경우"}]}]},
          {"type": "listItem", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "리뷰 폭증: 하루 리뷰 수가 평소 대비 크게 증가한 경우"}]}]},
          {"type": "listItem", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "별점 급락: 상품 평균 별점이 급격히 내려간 경우"}]}]},
          {"type": "listItem", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "부정 리뷰 급증: 부정적인 내용의 리뷰가 갑자기 많아진 경우"}]}]}
        ]
      },
      {
        "type": "heading",
        "attrs": {"level": 3},
        "content": [{"type": "text", "text": "심각도 구분"}]
      },
      {
        "type": "paragraph",
        "content": [{"type": "text", "text": "HIGH(빨강)·MEDIUM(노랑)·LOW(회색) 세 단계로 표시됩니다. HIGH는 즉각적인 확인과 대응이 필요한 수준입니다."}]
      },
      {
        "type": "heading",
        "attrs": {"level": 2},
        "content": [{"type": "text", "text": "이렇게 사용해보세요"}]
      },
      {
        "type": "heading",
        "attrs": {"level": 3},
        "content": [{"type": "text", "text": "오늘의 HIGH 신호 먼저 확인하기"}]
      },
      {
        "type": "paragraph",
        "content": [{"type": "text", "text": "기간을 '오늘'로, 심각도를 HIGH만 선택하시면 즉시 주목해야 할 신호를 우선적으로 확인하실 수 있습니다."}]
      },
      {
        "type": "heading",
        "attrs": {"level": 3},
        "content": [{"type": "text", "text": "이상탐지 상세 내용 확인하기"}]
      },
      {
        "type": "paragraph",
        "content": [{"type": "text", "text": "목록에서 항목을 클릭하시면 우측 패널이 열립니다. 핵심 지표(이전·현재 수치 비교)와 연관 상품·브랜드 링크를 확인하실 수 있습니다."}]
      },
      {
        "type": "heading",
        "attrs": {"level": 3},
        "content": [{"type": "text", "text": "리뷰 관련 이상탐지 대응하기"}]
      },
      {
        "type": "paragraph",
        "content": [{"type": "text", "text": "별점 급락, 부정 리뷰 급증 신호가 감지되면 상세 패널에서 해당 상품 링크를 클릭해 자사 리뷰 화면에서 구체적인 내용을 확인하실 수 있습니다."}]
      },
      {
        "type": "heading",
        "attrs": {"level": 3},
        "content": [{"type": "text", "text": "메모 남기기"}]
      },
      {
        "type": "paragraph",
        "content": [{"type": "text", "text": "상세 패널 하단의 메모 버튼을 통해 해당 이상탐지 항목에 내부 메모를 남기실 수 있습니다. 대응 이력 기록에 활용하실 수 있습니다."}]
      },
      {
        "type": "heading",
        "attrs": {"level": 2},
        "content": [{"type": "text", "text": "관련 기능"}]
      },
      {
        "type": "bulletList",
        "content": [
          {"type": "listItem", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "상품 상세 — 이상탐지 패널의 링크를 통해 해당 상품 페이지로 이동할 수 있습니다."}]}]},
          {"type": "listItem", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "자사 리뷰 — 리뷰 관련 이상탐지 확인 후 상세 리뷰를 조회할 수 있습니다."}]}]},
          {"type": "listItem", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "홈 대시보드 — 최근 이상탐지 신호를 위젯으로 빠르게 확인할 수 있습니다."}]}]}
        ]
      },
      {
        "type": "heading",
        "attrs": {"level": 2},
        "content": [{"type": "text", "text": "자주 묻는 질문"}]
      },
      {
        "type": "paragraph",
        "content": [{"type": "text", "marks": [{"type": "bold"}], "text": "Q: HIGH·MEDIUM·LOW는 어떤 기준으로 나뉘나요?"}]
      },
      {
        "type": "paragraph",
        "content": [{"type": "text", "text": "A: 변화의 크기와 속도를 기준으로 시스템이 자동으로 분류합니다. HIGH는 가장 급격한 변화가 감지된 경우입니다."}]
      },
      {
        "type": "paragraph",
        "content": [{"type": "text", "marks": [{"type": "bold"}], "text": "Q: 같은 상품이 여러 번 감지될 수 있나요?"}]
      },
      {
        "type": "paragraph",
        "content": [{"type": "text", "text": "A: 같은 상품이라도 서로 다른 이벤트 유형으로 복수 탐지될 수 있습니다. 예를 들어 순위 급등과 가격 급락이 동시에 감지되면 각각 별도로 표시됩니다."}]
      },
      {
        "type": "paragraph",
        "content": [{"type": "text", "marks": [{"type": "bold"}], "text": "Q: 이상탐지 이후 해당 상품 페이지 링크가 없는 경우가 있습니다."}]
      },
      {
        "type": "paragraph",
        "content": [{"type": "text", "text": "A: 연관 상품·브랜드 정보가 아직 수집 완료되지 않은 경우 링크가 표시되지 않습니다. 잠시 후 다시 확인하시기 바랍니다."}]
      }
    ]
  }'::jsonb,
  false
);


-- ── 5. 회사 목록 (/companies) ─────────────────────────────────────────────────
INSERT INTO public.help_articles (slug, title, page_path, category, sort_order, content, is_published)
VALUES (
  'companies-guide',
  '회사 목록 사용 가이드',
  '/companies',
  '분석',
  5,
  '{
    "type": "doc",
    "content": [
      {
        "type": "heading",
        "attrs": {"level": 2},
        "content": [{"type": "text", "text": "한 줄 요약"}]
      },
      {
        "type": "paragraph",
        "content": [{"type": "text", "text": "무신사에 입점한 브랜드를 보유한 법인 목록과 함께 DART 공시(금융감독원 전자공시시스템 등록 재무 발표) 기반 재무 정보를 확인하실 수 있습니다."}]
      },
      {
        "type": "heading",
        "attrs": {"level": 2},
        "content": [{"type": "text", "text": "어떤 정보를 보여주나요?"}]
      },
      {
        "type": "heading",
        "attrs": {"level": 3},
        "content": [{"type": "text", "text": "회사 테이블 컬럼"}]
      },
      {
        "type": "bulletList",
        "content": [
          {"type": "listItem", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "회사명·로고"}]}]},
          {"type": "listItem", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "랭킹 상품 수: 무신사 랭킹에 집계된 해당 회사 소속 상품 수"}]}]},
          {"type": "listItem", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "매출액·성장률: 최근 공시 기준 (없으면 표시 안 됨)"}]}]},
          {"type": "listItem", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "영업이익률: 영업이익 ÷ 매출액"}]}]},
          {"type": "listItem", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "부채비율: 총부채 ÷ 자기자본"}]}]},
          {"type": "listItem", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "상장 구분: 상장 / 비상장"}]}]}
        ]
      },
      {
        "type": "heading",
        "attrs": {"level": 3},
        "content": [{"type": "text", "text": "기업 규모 구분"}]
      },
      {
        "type": "bulletList",
        "content": [
          {"type": "listItem", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "대기업: 연매출 1,000억원 이상"}]}]},
          {"type": "listItem", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "중견기업: 100억원 이상 ~ 1,000억원 미만"}]}]},
          {"type": "listItem", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "소기업: 100억원 미만"}]}]},
          {"type": "listItem", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "미수집: DART 공시가 없어 재무 정보를 수집할 수 없는 경우"}]}]}
        ]
      },
      {
        "type": "heading",
        "attrs": {"level": 2},
        "content": [{"type": "text", "text": "이렇게 사용해보세요"}]
      },
      {
        "type": "heading",
        "attrs": {"level": 3},
        "content": [{"type": "text", "text": "매출 규모 기준으로 경쟁사 파악하기"}]
      },
      {
        "type": "paragraph",
        "content": [{"type": "text", "text": "정렬을 '매출액'으로 선택하시면 무신사 입점 브랜드 중 매출 규모가 큰 법인 순서로 확인하실 수 있습니다."}]
      },
      {
        "type": "heading",
        "attrs": {"level": 3},
        "content": [{"type": "text", "text": "특정 회사 검색하기"}]
      },
      {
        "type": "paragraph",
        "content": [{"type": "text", "text": "상단 검색창에 회사명을 입력하시면 입력 후 0.3초 내에 자동으로 검색 결과가 표시됩니다."}]
      },
      {
        "type": "heading",
        "attrs": {"level": 3},
        "content": [{"type": "text", "text": "회사 상세 정보 확인하기"}]
      },
      {
        "type": "paragraph",
        "content": [{"type": "text", "text": "테이블에서 행을 클릭하시면 해당 법인의 상세 페이지로 이동합니다. 연도별 재무 추이와 보유 브랜드 목록을 확인하실 수 있습니다."}]
      },
      {
        "type": "heading",
        "attrs": {"level": 3},
        "content": [{"type": "text", "text": "랭킹 상품 수로 무신사 영향력 비교하기"}]
      },
      {
        "type": "paragraph",
        "content": [{"type": "text", "text": "정렬을 '랭킹 상품 수'로 변경하시면 무신사 내 상품 노출이 많은 법인 순서로 확인하실 수 있습니다. 매출과 무신사 영향력을 교차 비교하는 데 활용하실 수 있습니다."}]
      },
      {
        "type": "heading",
        "attrs": {"level": 2},
        "content": [{"type": "text", "text": "관련 기능"}]
      },
      {
        "type": "bulletList",
        "content": [
          {"type": "listItem", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "회사 상세 — 클릭 시 연도별 재무 데이터와 보유 브랜드 정보를 확인할 수 있습니다."}]}]},
          {"type": "listItem", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "상품 랭킹 — 회사 필터를 활용해 특정 법인 브랜드의 상품만 조회할 수 있습니다."}]}]}
        ]
      },
      {
        "type": "heading",
        "attrs": {"level": 2},
        "content": [{"type": "text", "text": "자주 묻는 질문"}]
      },
      {
        "type": "paragraph",
        "content": [{"type": "text", "marks": [{"type": "bold"}], "text": "Q: 매출액이 없는 회사가 많습니다."}]
      },
      {
        "type": "paragraph",
        "content": [{"type": "text", "text": "A: 소규모 법인은 DART 공시 의무가 없어 재무 데이터를 수집할 수 없습니다. '미수집'으로 표시됩니다."}]
      },
      {
        "type": "paragraph",
        "content": [{"type": "text", "marks": [{"type": "bold"}], "text": "Q: 브랜드와 회사의 차이는 무엇인가요?"}]
      },
      {
        "type": "paragraph",
        "content": [{"type": "text", "text": "A: 브랜드는 상품에 표시되는 레이블이고, 회사는 해당 브랜드를 보유한 법인입니다. 하나의 법인이 여러 브랜드를 운영할 수 있습니다."}]
      },
      {
        "type": "paragraph",
        "content": [{"type": "text", "marks": [{"type": "bold"}], "text": "Q: 자사 브랜드 보유 회사란 무엇인가요?"}]
      },
      {
        "type": "paragraph",
        "content": [{"type": "text", "text": "A: B.CAVE가 직접 운영하는 브랜드(커버낫, 리 등)를 보유한 법인을 의미합니다. 필터에서 '자사 브랜드 보유 회사만'을 선택하시면 해당 법인만 표시됩니다."}]
      }
    ]
  }'::jsonb,
  false
);


-- ── 6. 자사 리뷰 (/reviews) ───────────────────────────────────────────────────
INSERT INTO public.help_articles (slug, title, page_path, category, sort_order, content, is_published)
VALUES (
  'reviews-guide',
  '자사 리뷰 사용 가이드',
  '/reviews',
  '주요기능',
  6,
  '{
    "type": "doc",
    "content": [
      {
        "type": "heading",
        "attrs": {"level": 2},
        "content": [{"type": "text", "text": "한 줄 요약"}]
      },
      {
        "type": "paragraph",
        "content": [{"type": "text", "text": "B.CAVE 자사 브랜드 상품에 달린 무신사 리뷰를 별점, 상품 속성, 구매자 체형 정보와 함께 조회하실 수 있습니다."}]
      },
      {
        "type": "heading",
        "attrs": {"level": 2},
        "content": [{"type": "text", "text": "어떤 정보를 보여주나요?"}]
      },
      {
        "type": "heading",
        "attrs": {"level": 3},
        "content": [{"type": "text", "text": "리뷰 카드"}]
      },
      {
        "type": "paragraph",
        "content": [{"type": "text", "text": "별점, 작성 날짜, 도움됨 수, 리뷰 본문이 표시됩니다. 리뷰 사진이 있는 경우 클릭하시면 크게 보실 수 있습니다."}]
      },
      {
        "type": "paragraph",
        "content": [{"type": "text", "text": "별점 색상으로 리뷰 성격을 빠르게 파악하실 수 있습니다. 1~2점은 빨강, 3점은 노랑, 4~5점은 초록으로 표시됩니다."}]
      },
      {
        "type": "heading",
        "attrs": {"level": 3},
        "content": [{"type": "text", "text": "상품 속성 정보"}]
      },
      {
        "type": "paragraph",
        "content": [{"type": "text", "text": "구매자가 답한 사이즈, 퀄리티, 신축성, 두께감, 보온성, 무게감, 착용감, 색감 항목이 표시됩니다. 속성 필터를 활용하시면 특정 불만 유형의 리뷰만 조회하실 수 있습니다."}]
      },
      {
        "type": "heading",
        "attrs": {"level": 3},
        "content": [{"type": "text", "text": "우측 CS 이상탐지 패널"}]
      },
      {
        "type": "paragraph",
        "content": [{"type": "text", "text": "별점 급락, 부정 리뷰 급증, 리뷰 수 급증 등 CS 관련 이상 신호가 감지되면 우측 패널에 표시됩니다."}]
      },
      {
        "type": "heading",
        "attrs": {"level": 2},
        "content": [{"type": "text", "text": "이렇게 사용해보세요"}]
      },
      {
        "type": "heading",
        "attrs": {"level": 3},
        "content": [{"type": "text", "text": "저점 리뷰만 모아보기"}]
      },
      {
        "type": "paragraph",
        "content": [{"type": "text", "text": "별점 필터에서 1점, 2점을 선택하시면 부정적인 리뷰만 모아서 확인하실 수 있습니다. 개선이 필요한 점을 파악하는 데 활용하시기 바랍니다."}]
      },
      {
        "type": "heading",
        "attrs": {"level": 3},
        "content": [{"type": "text", "text": "사이즈 문제 리뷰 필터링하기"}]
      },
      {
        "type": "paragraph",
        "content": [{"type": "text", "text": "속성 필터에서 '사이즈'를 '조금 작음' 또는 '조금 큼'으로 선택하시면 사이즈 불만 리뷰만 조회하실 수 있습니다. 기획 단계에서 사이즈 가이드 개선에 참고하실 수 있습니다."}]
      },
      {
        "type": "heading",
        "attrs": {"level": 3},
        "content": [{"type": "text", "text": "특정 상품 리뷰 집중 분석하기"}]
      },
      {
        "type": "paragraph",
        "content": [{"type": "text", "text": "브랜드를 선택하신 후 상품을 선택하시면 해당 상품의 리뷰만 표시됩니다. 신상품 출시 후 초기 반응을 모니터링하는 데 활용하시기 바랍니다."}]
      },
      {
        "type": "heading",
        "attrs": {"level": 3},
        "content": [{"type": "text", "text": "리뷰 데이터 엑셀로 저장하기"}]
      },
      {
        "type": "paragraph",
        "content": [{"type": "text", "text": "우상단 엑셀 내보내기 버튼을 클릭하시면 현재 필터가 적용된 리뷰 데이터를 엑셀 파일로 저장하실 수 있습니다."}]
      },
      {
        "type": "heading",
        "attrs": {"level": 2},
        "content": [{"type": "text", "text": "관련 기능"}]
      },
      {
        "type": "bulletList",
        "content": [
          {"type": "listItem", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "이상탐지 — 리뷰 관련 이상 신호의 전체 목록을 확인할 수 있습니다."}]}]},
          {"type": "listItem", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "오늘의 매거진 CS 탭 — 오늘의 리뷰 동향을 AI 요약으로 빠르게 파악할 수 있습니다."}]}]}
        ]
      },
      {
        "type": "heading",
        "attrs": {"level": 2},
        "content": [{"type": "text", "text": "자주 묻는 질문"}]
      },
      {
        "type": "paragraph",
        "content": [{"type": "text", "marks": [{"type": "bold"}], "text": "Q: 속성 필터(사이즈, 퀄리티 등)란 무엇인가요?"}]
      },
      {
        "type": "paragraph",
        "content": [{"type": "text", "text": "A: 무신사 리뷰 작성 시 구매자가 답하는 만족도 항목입니다. 사이즈 적합성, 소재 퀄리티, 신축성 등 8가지 항목이 있습니다."}]
      },
      {
        "type": "paragraph",
        "content": [{"type": "text", "marks": [{"type": "bold"}], "text": "Q: 키·몸무게 필터가 적용되지 않는 리뷰가 있습니다."}]
      },
      {
        "type": "paragraph",
        "content": [{"type": "text", "text": "A: 구매자가 해당 정보를 입력한 리뷰에만 적용됩니다. 입력하지 않은 리뷰는 키·몸무게 필터 대상에서 제외됩니다."}]
      },
      {
        "type": "paragraph",
        "content": [{"type": "text", "marks": [{"type": "bold"}], "text": "Q: CS 이상탐지 패널에 아무것도 표시되지 않습니다."}]
      },
      {
        "type": "paragraph",
        "content": [{"type": "text", "text": "A: 최근 CS 관련 이상 신호가 감지되지 않은 경우 패널이 비어 있습니다. 정상적인 상태입니다."}]
      }
    ]
  }'::jsonb,
  false
);


-- ── 7. 홈 대시보드 (/) ───────────────────────────────────────────────────────
INSERT INTO public.help_articles (slug, title, page_path, category, sort_order, content, is_published)
VALUES (
  'home-guide',
  '홈 대시보드 사용 가이드',
  '/',
  '시작하기',
  7,
  '{
    "type": "doc",
    "content": [
      {
        "type": "heading",
        "attrs": {"level": 2},
        "content": [{"type": "text", "text": "한 줄 요약"}]
      },
      {
        "type": "paragraph",
        "content": [{"type": "text", "text": "수집 현황, 오늘의 상품·브랜드 랭킹, 자사 브랜드 현황, 이상탐지 신호, 리뷰 통계를 한 화면에서 빠르게 파악하실 수 있는 전체 현황 대시보드입니다."}]
      },
      {
        "type": "heading",
        "attrs": {"level": 2},
        "content": [{"type": "text", "text": "어떤 정보를 보여주나요?"}]
      },
      {
        "type": "heading",
        "attrs": {"level": 3},
        "content": [{"type": "text", "text": "상단 KPI 카드 (6개)"}]
      },
      {
        "type": "bulletList",
        "content": [
          {"type": "listItem", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "상품 랭킹 스냅샷 수 — 수집 완료된 랭킹 데이터 건수"}]}]},
          {"type": "listItem", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "브랜드 랭킹 건수"}]}]},
          {"type": "listItem", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "자사 SKU 수 — 자사 브랜드 등록 상품 총 수"}]}]},
          {"type": "listItem", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "TOP100 진입 수 — 오늘 기준 자사 상품의 TOP100 진입 개수"}]}]},
          {"type": "listItem", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "수집 리뷰 수 + 평균 별점"}]}]},
          {"type": "listItem", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "프로모션 수 — 현재 진행 중인 프로모션 건수"}]}]}
        ]
      },
      {
        "type": "heading",
        "attrs": {"level": 3},
        "content": [{"type": "text", "text": "오늘의 상품 랭킹 / 브랜드 랭킹 위젯"}]
      },
      {
        "type": "paragraph",
        "content": [{"type": "text", "text": "성별(전체·남성·여성)을 선택하여 TOP10을 확인하실 수 있습니다. 상품 이름을 클릭하면 상품 상세 페이지로 이동합니다."}]
      },
      {
        "type": "heading",
        "attrs": {"level": 3},
        "content": [{"type": "text", "text": "자사 브랜드 현황 위젯"}]
      },
      {
        "type": "paragraph",
        "content": [{"type": "text", "text": "커버낫, 리, 와키윌리 등 자사 브랜드별 TOP100 진입 수와 SKU 수를 확인하실 수 있습니다."}]
      },
      {
        "type": "heading",
        "attrs": {"level": 3},
        "content": [{"type": "text", "text": "이상탐지·리뷰·프로모션 위젯"}]
      },
      {
        "type": "paragraph",
        "content": [{"type": "text", "text": "최근 이상 신호, 리뷰 통계, 진행 중인 프로모션을 간략히 확인하실 수 있습니다."}]
      },
      {
        "type": "heading",
        "attrs": {"level": 3},
        "content": [{"type": "text", "text": "수집 상태 패널"}]
      },
      {
        "type": "paragraph",
        "content": [{"type": "text", "text": "각 수집 작업의 상태(활성·미완·대기)와 최근 수집일을 확인하실 수 있습니다. 수집이 진행 중일 때는 진행률(%)이 실시간으로 업데이트됩니다."}]
      },
      {
        "type": "heading",
        "attrs": {"level": 2},
        "content": [{"type": "text", "text": "이렇게 사용해보세요"}]
      },
      {
        "type": "heading",
        "attrs": {"level": 3},
        "content": [{"type": "text", "text": "KPI 카드로 상세 화면 바로 이동하기"}]
      },
      {
        "type": "paragraph",
        "content": [{"type": "text", "text": "상단 KPI 카드를 클릭하시면 해당 상세 화면으로 바로 이동하실 수 있습니다. 숫자가 예상보다 낮거나 높을 때 바로 확인하시기 바랍니다."}]
      },
      {
        "type": "heading",
        "attrs": {"level": 3},
        "content": [{"type": "text", "text": "오늘의 자사 상품 순위 빠르게 확인하기"}]
      },
      {
        "type": "paragraph",
        "content": [{"type": "text", "text": "상품 랭킹 위젯에서 성별을 전환하시면 남성복·여성복·전체 세그먼트별로 오늘 자사 상품 위치를 확인하실 수 있습니다."}]
      },
      {
        "type": "heading",
        "attrs": {"level": 3},
        "content": [{"type": "text", "text": "수집 완료 여부 확인하기"}]
      },
      {
        "type": "paragraph",
        "content": [{"type": "text", "text": "하단 수집 상태 패널에서 오늘 데이터 수집이 정상적으로 완료되었는지 확인하실 수 있습니다. '미완' 상태가 있다면 데이터가 아직 최신이 아닐 수 있습니다."}]
      },
      {
        "type": "heading",
        "attrs": {"level": 2},
        "content": [{"type": "text", "text": "관련 기능"}]
      },
      {
        "type": "bulletList",
        "content": [
          {"type": "listItem", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "오늘의 매거진 — AI가 분석한 오늘 무신사 동향 브리핑을 확인할 수 있습니다."}]}]},
          {"type": "listItem", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "상품 랭킹 — 홈 위젯의 전체보기 링크로 이동하거나 사이드바에서 직접 접근하실 수 있습니다."}]}]},
          {"type": "listItem", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "이상탐지 — 이상탐지 위젯의 신호를 클릭하시면 전체 목록 화면으로 이동합니다."}]}]}
        ]
      },
      {
        "type": "heading",
        "attrs": {"level": 2},
        "content": [{"type": "text", "text": "자주 묻는 질문"}]
      },
      {
        "type": "paragraph",
        "content": [{"type": "text", "marks": [{"type": "bold"}], "text": "Q: KPI 숫자가 언제 업데이트되나요?"}]
      },
      {
        "type": "paragraph",
        "content": [{"type": "text", "text": "A: 수집 작업이 완료되면 실시간으로 자동 갱신됩니다. 최대 30초 간격으로 최신 값을 확인합니다."}]
      },
      {
        "type": "paragraph",
        "content": [{"type": "text", "marks": [{"type": "bold"}], "text": "Q: 수집 상태가 '미완'으로 표시됩니다."}]
      },
      {
        "type": "paragraph",
        "content": [{"type": "text", "text": "A: 당일 수집이 시작되었으나 아직 완료되지 않은 상태입니다. 수집이 완료되면 자동으로 '활성'으로 변경됩니다."}]
      },
      {
        "type": "paragraph",
        "content": [{"type": "text", "marks": [{"type": "bold"}], "text": "Q: 자사 브랜드 현황에 특정 브랜드가 표시되지 않습니다."}]
      },
      {
        "type": "paragraph",
        "content": [{"type": "text", "text": "A: 자사 브랜드로 등록된 브랜드만 표시됩니다. 신규 브랜드 등록이 필요한 경우 관리자에게 문의하시기 바랍니다."}]
      }
    ]
  }'::jsonb,
  false
);


-- ============================================================
-- 검증 SQL (적용 후 실행)
-- ============================================================
-- SELECT slug, title, page_path, category, sort_order, is_published
--   FROM public.help_articles
--  ORDER BY sort_order;
--
-- 예상 결과:
--   today-guide          | /today          | 주요기능 | 1 | false
--   ranking-guide        | /ranking        | 주요기능 | 2 | false
--   brand-ranking-guide  | /brand-ranking  | 주요기능 | 3 | false
--   anomaly-guide        | /anomaly        | 분석     | 4 | false
--   companies-guide      | /companies      | 분석     | 5 | false
--   reviews-guide        | /reviews        | 주요기능 | 6 | false
--   home-guide           | /               | 시작하기 | 7 | false
-- ============================================================
