# EIS × 무신사: 기존 약속을 실행으로 좁히는 1단계

상태: 격리 로컬 계약 구현. DB/배치/운영 화면 미연결. PR19 및 기존 패치 보존.

## 원래 약속과 현재 차이

원문 근거는 /tmp/uttu-portal-lab/handoff-evidence.json. EIS 분석 고정 SHA709c1a783542e59f934f3f4a8275090d2ff1a3e9, implementation-contract.json과 DATA-CONTRACTS.md, UTTU viewer/dev/erp-insights/reference 및 lib/erp-insight-workspace.ts의 5개 시안을 재사용한다. 합성 시안의 임계값을 현업 합격 기준으로 승격하지 않는다.

| 기존 시안/현업 질문 | 판단 뒤 사람이 할 행동 | 내부/외부 지표·연결/기간 | 현재 근거와 빠진 조건 |
|---|---|---|---|
| 기획×시장: 순위 상승 상품의 판매율이 낮은가? | 노출·가격·옵션 결품을 먼저 점검, 자동 발주 금지 | STYLECD+BRANDCD→검증 product_id/musinsa_no; 판매수량/정의된 누적입고; 동일 store/category/gender/age 순위 시작·끝; 시즌연도 명시 | 원천 발주/입고 SQL 근거 존재. 입고 제한 표본 확인. 단위·누적분모/발주배분/브랜드별 상품 매핑 미확인 → 판매율 보류 |
| 매출×시장: 내부 매출 하락과 시장 반응 상승이 같이 보이는가? | 차이가 큰 상품의 가격·리뷰·채널 상세를 확인 | VAT제외 signed 매출, 동일요일 7일 vs 직전7일; 상품 crosswalk 및 동일 조건 순위; 시장순위는 매출/점유율 아님 | 일별 브랜드 매출 실제 연결. 기존 상품상세200그룹 한도·감사 로직 존재. 전 상품 완전 집계/상품crosswalk/시장기간 대사 미완료 → 첫 제품 우선순위 |
| 할인×이익: 할인 확대·이익 감소 상품의 경쟁 표시가격은? | 가격 정책과 비교상품 조건 검토 | 내부 실현할인/원가/제조이익 vs 외부 표시가격·할인; 동일상품군/관측일/쿠폰포함범위 | EIS 지표 근거·무신사 가격 수집 코드 존재. 내부 원가·세금·반품·가중평균 계약 없음. 외부 할인으로 이익 추정 금지 |
| 이월×재노출: 이월재고와 시장 관심 상승이 겹치는가? | 온라인 노출·재고이동 검토 | 시즌연도+이월정의, 창고/매장 구분 재고, 동일 시장순위 | 재고 provider 로컬합격(PR19), 업무 snapshot시각 미확인; 수집시각으로 대체 불가. 재고주수·소진예상 보류 |
| 리뷰×품질: 판매·관심 증가 상품에 저평점 신호가 있는가? | 익명 리뷰 표본을 읽고 품질팀 확인 요청 준비 | product_id와 review 작성일; 표본수/저평점비율, 동일 판매기간; 개인식별 결합 금지 | reviews/ranking 수집 존재. 상품매핑/리뷰완전성/수집일vs작성일 대사 필요. 표본0은 만족100% 아님 |

사실: 매출·입고 제한 실제 검증은 별도 증거 파일에 존재한다. 소스가 존재함과 운영 적재/완전한 상품결합은 다르다. 위 연결 완료로 선언하지 않는다. QA 현업평가 시인성4/10·유용성2/10은 전달받은 정성평가이며 성능 측정값이 아니다.

## 기존 경로를 재사용하는 구조

- 현재 ERP page force-dynamic → central-sales-runtime → existing requester REST → Snowflake EXPLAIN/SELECT. 입고도 receipt-source-server/rest가 GET마다 읽는다. 폼 세 개는 매출/입고/재고 공급자 범위를 별도로 유지한다. 현재 이 경로를 바꾸지 않았다.
- UTTU own_sales_daily 기존 스키마는 날짜/브랜드/매장(채널), BIGINT amount/기본0. 상품 STYLECD 없음. own_inventory와 MDA의 brand집계 테이블도 목적/자연키가 다르다. 기존 테이블의 존재를 상품 인사이트 캐시 완료로 취급하지 않는다.
- MDA snowflake_erp.py는 SW_SALEINFO를 브랜드·채널로 집계 후 Supabase upsert하는 기존 ETL이 있다. 이는 VW_SALES_VAT 이관매장제외·NULL감사·FLOAT 표현과 동일하지 않으므로 그대로 대체 불가. inventory는 실행일을 snapshot_date로 부여하므로 업무 기준시각으로 재사용 금지.
- UTTU worker/agent/_briefing_queries.py fetch_own_sales는 stub. ranking_snapshots/가격/리뷰는 Supabase 수집 경로가 있지만 해당 운영 job 성공/신선도는 이번 단계에서 새조회하지 않음. PR19 순위 RPC/ACL은 미설치 조건 그대로.

## 첫 구현과 최소 적재 설계 (제안, 미적용)

이번에 작성한 insight-cache-contract.ts는 이미 검토된 CentralState 일별 DTO를 작은 immutable generation으로 변환하고, NULL감사/원문/부호를 보존한다. 진단/비밀은 투영하지 않는다. 부분조회·중복일자는 적재후보를 만들지 않는다. 조회시각 observedAt과 sourceWatermark(null)을 분리한다. fresh/stale/expired 및 갱신실패를 반환하며 마지막 정상결과를 보존할 수 있다. 기존 인증 어댑터가 공급할 session+role+brand pin을 읽기 전후 비교한다. 현재 주입된 함수만 있으며 DB/Supabase/화면 연결은 없다. 완전한 인사이트 구현 또는 실제 속도 개선 완료가 아니다.

최소 논리 스키마(DDL/마이그레이션 없음):
1. erp_insight_runs: run_id, brand, from/to, definition_version, grain, status(staging/complete/failed), fetched_at, source_watermark nullable, coverage/rowcount/hash, failure_code. 완료 generation 포인터만 읽기.
2. erp_insight_daily: (run_id,brand,sale_date) PK, raw_response_text, approximate_amount nullable, source_rows/amount_rows/null_rows, audit_status. 첫 thin slice는 최대31일 브랜드 집계. 기존 table에 덮어쓰기 금지.
3. 후속 style_daily: 위 키+STYLECD, 상품 매핑 version/상태 별도. 빈 기간을0으로 채우지 않음. 기간완전성 확인 후에만 직전 동일요일7일 변화 계산. 200 sentinel 결과를 전상품 fact로 게시하지 않음.
4. 외부 facts는 기존 ranking/price/review tables 재사용. crosswalk(BRANDCD,STYLECD,product_id,musinsa_no,valid_from/to,status,evidence_ref)를 검증한 뒤에만 연결. 모호한 매핑은 별도 건수로 남김.

배치(미활성 제안): KST 전일 마감 후 하루1회, 영업 중 필요하면1시간 간격 선택. 실제 upstream 확정시각/수정분 정책을 먼저 확인한다. 최소 최근14일 재집계 범위와 적재량 EXPLAIN 예산을 별도 승인/측정. generation 전체검사→원자적 완료 포인터 교체; 실패/부분응답이면 기존 정상 generation 유지. UI는 마지막성공시각·대상기간·원천기준시각 미확인을 함께 표시. 임시 freshness 목표1시간/최대보관7일은 코드의 정책 매개변수와 문서 제안이지 upstream SLA가 아니다. 만료 뒤 수치 보류, 실패를0으로 치환하지 않는다.

인증 경계: 서비스 writer는 기존 승인된 배치 권한에 한정하며 브라우저에 service key 제공 금지. 읽기는 기존 두 요청자+서버 세션/역할 pin 및 브랜드 범위 재검증. 공용/anon 캐시에 ERP를 넣지 않는다. 기존00099_rls.sql에는 anon read 예시가 있어 자동 재사용 금지. 실제 새private schema/RLS는 별도 검토·승인 전 실행하지 않는다. 사용자별 권한이 다른 결과를 공용키로 공유하지 않는다.

## 단계별 실행과 완료기준

1. 현재: 기존5시안/소스/실제연결 간 차이표 + 순수캐시변환/읽기 계약 + 합성 검사. 완료기준은 NULL/부분/신선도/세션실패검사 통과, DB무변경. 이번 산출물.
2. 다음: 매출×시장 하나에 집중. 사람이 확인한5~10상품 crosswalk와 동일14일 판매/시장 coverage를 대사. 완료기준: 매핑 제외/중복/기간/NULL 공개, 전주변화와 순위관측 나란히 표시, 인과 주장은 하지 않음. 미매핑품목 제외 숫자 포함.
3. 다음: 승인된 private 적재 어댑터/배치/정상포인터/실패복구 연결. 완료기준: 새로고침 때 Snowflake0호출, 권한 변경 후 재조회차단, last-good/갱신실패가 실제 동작. 이때만 DB변경 논의.
4. 다음: 현황 첫 화면을 변화→가능한 설명근거→확인할상품 순서로 교체. 미확인 큰 카드 제거, 표/설명/원천/진단은 상세. 이유는 '경쟁 할인 동시관측'처럼 근거로 표시하고 원인 확정 금지. 사용자가 상품을 열어 다음 행동을 선택하는 현업 QA로 합격 판단.
5. 검증 후 나머지4시안은 필요한 지표 정의가 갖춰진 순서로 확장. 재고시점/판매율분모/이익/반품 계약 없는 영역은 숫자 자리채우기 금지.

성능: 실제 초기표시/조회 p50/p95는 미측정. 목표 첫 표시1초/기본결과3초. 기존 로컬 입고 읽기3.697초는 서버+SDK+EXPLAIN 세번의 단일실행으로 페이지 SLA가 아니다. 측정계획은 동일요청·cold/warm·권한상태별 TTFB, 화면 LCP/첫 유효결과, 캐시쿼리수, Snowflake호출수를 분리 수집. 목표달성으로 보고하지 않는다.

남은 결정: 첫 주사용자/의사결정(매출×시장 우선 제안 수용), 실제상품 crosswalk 확인자, upstream완료시간/수정분·신선도 정책, 사적 ERP 집계 저장의 권한 범위. 이 결정 없이 원천검증을 제품완료로 처리하지 않는다.

추가 관측: 부모가 전달한 QA에서 7일 화면 조작부터 첫 결과 관찰까지 5,419ms였다. 도구 처리·관찰 대기 포함이며 순수 페이지/쿼리 시간이 아니다. 첫 픽셀·TTFB·DB·네트워크·렌더 구간은 미측정이다. Snowflake를 실측 병목으로 단정하지 않는다. 다음 통합의 계측은 단계 enum(auth/cache/source/render), 상대 경과ms, 성공/실패 enum만 남기고 사용자·브랜드·품번·SQL·URL·토큰은 제외한다. 캐시의 속도 효과도 같은 조건의 측정으로 검증한다.
