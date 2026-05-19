# DART OpenAPI — 제공 데이터 전체 정리

> 재무팀 협의용 레퍼런스 문서. DART OpenAPI 공개 명세 기준 (2026-05-20).
> 수집 여부·테이블 설계는 별도 결정. 이 문서는 "뭘 얻을 수 있는가"만 정리.

---

## 기본 정보

```
Base URL:     https://opendart.fss.or.kr/api
인증:          ?crtfc_key={API_KEY}  (쿼리 파라미터)
Rate Limit:   1,000 req/min
응답 형식:     JSON (일부 XML/ZIP)
비상장사:      주요 비상장법인만 조회 가능 (사업보고서 제출 의무 있는 곳)
              → 소규모 비상장법인은 공시 없음
```

---

## API 그룹 개요

| 그룹 | API 수 | 설명 |
|---|---|---|
| DS001 | 4 | 공시정보 (검색, 기업개황, 원문) |
| DS002 | 30 | 정기보고서 주요정보 |
| DS003 | 7 | 재무제표 |
| DS004 | 2 | 지분공시 |
| DS005 | 36 | 주요사항보고서 — **이상탐지 핵심** |
| DS006 | 6 | 증권신고서 |

---

## DS001 — 공시정보

### 1-1. 공시 검색 (`list.json`)

```
GET /api/list.json
  ?corp_code    기업 고유번호 (선택 — 없으면 전체)
  &bgn_de       검색 시작일 YYYYMMDD
  &end_de       검색 종료일 YYYYMMDD
  &pblntf_ty    공시유형 코드 (선택)
               A=정기공시 / B=주요사항보고 / C=발행공시 / D=지분공시
               E=기타공시 / F=외부감사 / G=펀드공시 / H=자산유동화
               I=거래소공시 / J=공정위공시
  &corp_cls     법인구분 Y=유가증권 / K=코스닥 / N=코넥스 / E=기타(비상장)
  &page_no      페이지 (기본 1)
  &page_count   페이지당 건수 (최대 100)
```

반환 필드:
```
corp_code       기업 고유번호
corp_name       회사명
stock_code      주식 코드 (상장사만)
corp_cls        법인구분 (Y/K/N/E)
report_nm       공시 제목
rcept_no        접수번호 (원문 조회 키)
flr_nm          공시 제출인명
rcept_dt        공시 접수일 YYYYMMDD
rm              비고 (유가증권시장·코스닥시장·코넥스시장·테슬라요건·중요사항누락·
                      불성실공시·무증자공시·증권취득목적·공시불이행·합병등보고)
```

### 1-2. 기업 개황 (`company.json`)

```
GET /api/company.json?corp_code={corp_code}
```

반환 필드:
```
corp_code       고유번호
corp_name       정식 회사명
corp_name_eng   영문 회사명
stock_name      종목명 (상장사)
stock_code      종목 코드 (상장사)
ceo_nm          대표이사명
corp_cls        법인구분 Y/K/N/E
jurir_no        법인등록번호
bizr_no         사업자등록번호 ← companies.business_number 매핑 키
adres           주소
hm_url          홈페이지 URL
ir_url          IR 홈페이지 URL
phn_no          전화번호
fax_no          팩스번호
industry_code   산업코드 (KSIC)
est_dt          설립일 YYYYMMDD
acc_mt          결산월 (01~12)
```

### 1-3. 공시 원본 (`document.json`)

```
GET /api/document.json?rcept_no={rcept_no}
→ ZIP 파일 반환 (HTML/XML)
```

### 1-4. 기업 고유번호 목록 (`corpCode.xml`)

```
GET /api/corpCode.xml
→ ZIP 반환 (CORPCODE.xml)
→ 전체 상장·비상장 기업 고유번호 목록
→ corp_code, corp_name, stock_code, modify_date 포함
```

---

## DS002 — 정기보고서 주요정보 (30개 API)

> 공통 파라미터: `corp_code`, `bsns_year`(사업연도), `reprt_code`
>
> reprt_code:
> - `11011` 사업보고서 (연간)
> - `11012` 반기보고서
> - `11013` 1분기보고서
> - `11014` 3분기보고서

### 주요 API 목록

| API명 | 엔드포인트 | 핵심 반환 필드 |
|---|---|---|
| 증자(감자) 현황 | `irdsSttus.json` | isu_dcrs_de(발행일), isu_dcrs_stle(발행형태), isu_dcrs_qy(주식수), isu_dcrs_mstvdv_fval_amount(액면가), isu_dcrs_qy(발행가액) |
| 배당 현황 | `alotMatter.json` | se(구분), thstrm(당기), frmtrm(전기), lwfr(전전기) — 주당배당금·배당수익률 포함 |
| 자기주식 현황 | `tesstkAcqsDspsSttus.json` | acqs_mth1(취득방법1), acqs_mth2(취득방법2), acqs_mth3(취득방법3), stock_knd(주식종류), bsis_qy(기초수량), change_qy_acqs(변동수량취득), change_qy_dsps(변동수량처분), change_qy_incnr(변동수량소각), trmend_qy(기말수량), acqs_rt(취득한도율) |
| 최대주주 현황 | `hyslrSttus.json` | nm(성명), relate(관계), stock_knd(주식종류), bsis_posesn_stock_co(기초보유주식수), bsis_posesn_stock_qota_rt(기초비율), trmend_posesn_stock_co(기말보유주식수), trmend_posesn_stock_qota_rt(기말비율) |
| 최대주주 변동 | `hyslrChgSttus.json` | change_de(변동일), mxmm_shrholdr_nm(최대주주명), change_cause(변동원인), bftr_qota_rt(변동전 지분율), aftr_qota_rt(변동후 지분율) |
| 소액주주 현황 | `mrhlSttus.json` | se(구분), shrholdr_co(주주수), shrholdr_tot_co(전체 주주수), hold_stock_co(보유주식수), tot_stock_co(전체 주식수), hold_stock_qota_rt(비율) |
| 임원 현황 | `exctvSttus.json` | nm(성명), sexdstn(성별), birth_ym(생년월일), ofcps(직위), rgit_exctv_at(등기임원여부), fte_at(상시근무여부), chrg_job(담당업무), main_career(주요경력), mxmm_shrholdr_relate(최대주주관계), hffc_pd(재임기간), tenure_end_on(임기만료일) |
| 직원 현황 | `empSttus.json` | fo_bbm(사업부문), sexdstn(성별), reform_bfe_emp_co_rgllbr(정규직), reform_bfe_emp_co_cnttk(계약직), reform_bfe_emp_co_etc(기타), rgllbr_co(정규직합), cnttk_co(계약직합), etc_co(기타합), avg_career(평균근속년수), annsal_co(연간급여총액), jan_salary_am(1인평균급여) |
| 이사·감사 전체보수 | `drctrAdtAllPymntamtSttus.json` | nmpr(인원수), pymnt_totamt(보수총액), jan_avrg_pymnt_am(1인평균) |
| 이사·감사 개인별 보수 | `drctrAdtIndvdlPymntamtSttus.json` | nm(성명), ofcps(직위), mendng_amt(보수총액), mendng_amt_ct009_jandy_mendng_am(1인기준급여월액) |
| 5억 이상 개인보수 | `drctrAdtIndvdlPymntamtSttusOver5irdPrs.json` | nm, ofcps, pymnt_amt — 5억원 이상 수령자만 |
| 감사의견 | `auditOpinion.json` | bsns_year, corp_code, reprt_code, adtor(감사인명), adt_reprt_spcmnt_matter(강조사항), adt_prrgrs(진행현황 — 내부 진행중인 것), adt_opinion(감사의견: 적정/한정/부적정/의견거절) |

---

## DS003 — 재무제표 (7개 API)

> 공통 파라미터: `corp_code`, `bsns_year`, `reprt_code`, `fs_div`
>
> fs_div:
> - `CFS` 연결재무제표 (상장 대기업 기준)
> - `OFS` 별도재무제표 (단독 법인 기준)
>
> sj_div (재무제표 종류):
> - `BS`  재무상태표 (자산/부채/자본)
> - `IS`  손익계산서 (매출/영업이익/당기순이익)
> - `CIS` 포괄손익계산서
> - `CF`  현금흐름표
> - `SCE` 자본변동표

### 3-1. 단일회사 주요계정 (`fnlttSinglAcnt.json`)

> 핵심 5개 계정만 반환 (빠른 조회)

```
GET /api/fnlttSinglAcnt.json
  ?corp_code, bsns_year, reprt_code, fs_div
```

반환 필드 (계정별로 행 구성):
```
rcept_no        접수번호
bsns_year       사업연도
corp_code       고유번호
sj_div          재무제표 구분 (BS/IS/CIS/CF/SCE)
sj_nm           재무제표명
account_id      계정 ID
account_nm      계정명
account_detail  계정 세부
thstrm_nm       당기명 (예: 제 23 기)
thstrm_amount   당기금액 (원)
frmtrm_nm       전기명
frmtrm_amount   전기금액
bfefrmtrm_nm    전전기명
bfefrmtrm_amount 전전기금액
ord             정렬순서
currency        통화 (KRW)
```

### 3-2. 단일회사 전체 재무제표 (`fnlttSinglAcntAll.json`)

> sj_div 전체 (BS/IS/CIS/CF/SCE) 모든 계정 반환

동일 구조, 모든 계정 포함 → 대용량 주의

### 3-3. 다중회사 주요계정 (`fnlttMultiAcnt.json`)

```
?corp_code=corp1,corp2,...  최대 100개사 동시 조회
```

### 3-4. XBRL 재무정보

```
fnlttXbrl.json          상장법인 XBRL 데이터
fnlttSinglAcntAll.json  전체 재무제표 (XBRL 기반)
```

### 수집 가능 주요 계정 (재무상태표 BS)

```
자산총계          ifrs-full:Assets
유동자산          ifrs-full:CurrentAssets
현금및현금성자산  ifrs-full:CashAndCashEquivalents
매출채권          ifrs-full:TradeAndOtherCurrentReceivables
재고자산          ifrs-full:Inventories
비유동자산        ifrs-full:NoncurrentAssets
유형자산          ifrs-full:PropertyPlantAndEquipment
부채총계          ifrs-full:Liabilities
유동부채          ifrs-full:CurrentLiabilities
단기차입금        dart:ShortTermBorrowings
비유동부채        ifrs-full:NoncurrentLiabilities
장기차입금        dart:LongTermBorrowings
자본총계          ifrs-full:Equity
```

### 수집 가능 주요 계정 (손익계산서 IS)

```
매출액            ifrs-full:Revenue
매출원가          ifrs-full:CostOfSales
매출총이익        ifrs-full:GrossProfit
판매비와관리비    dart:SalesAndAdministrativeCosts
영업이익          dart:OperatingIncomeLoss
금융수익          ifrs-full:FinanceIncome
금융비용          ifrs-full:FinanceCosts
법인세비용차감전  ifrs-full:ProfitLossBeforeTax
법인세비용        ifrs-full:IncomeTaxExpense
당기순이익        ifrs-full:ProfitLoss
```

### 수집 가능 주요 계정 (현금흐름표 CF)

```
영업활동 현금흐름  ifrs-full:CashFlowsFromUsedInOperatingActivities
투자활동 현금흐름  ifrs-full:CashFlowsFromUsedInInvestingActivities
재무활동 현금흐름  ifrs-full:CashFlowsFromUsedInFinancingActivities
기초 현금          ifrs-full:CashAndCashEquivalentsAtBeginningOfPeriod
기말 현금          ifrs-full:CashAndCashEquivalentsAtEndOfPeriod
```

---

## DS004 — 지분공시 (2개 API)

### 4-1. 대량보유 상황 (`majorstock.json`)

```
GET /api/majorstock.json?corp_code, bsns_year, reprt_code
```

반환:
```
rcept_no        접수번호
rcept_dt        접수일
corp_code       고유번호
corp_name       회사명
report_tp       보고구분 (최초/변동/임원)
hldr_nm         보고자명
hldr_relate     보고자 관계
stock_knd       주식종류
bsis_posesn_stock_qota_rt  변동전 지분율
change_stock_qota_rt       변동량 지분율
trmend_posesn_stock_qota_rt 변동후 지분율
acqs_mth_main   취득방법
report_resn     보고이유
```

### 4-2. 임원·주요주주 소유보고 (`elestock.json`)

```
GET /api/elestock.json?corp_code, bsns_year, reprt_code
```

반환:
```
rcept_no, rcept_dt, corp_code, corp_name
repror_nm       보고자명
repror_relate   보고자 관계
isu_stock_knd   발행주식 종류
before_qota_rt  보고전 지분율
change_qota_rt  변동 지분율
after_qota_rt   보고후 지분율
acqs_mth        취득방법
acqs_de         취득일
acqs_amount     취득금액
```

---

## DS005 — 주요사항보고서 (36개 API) ★ 이상탐지 핵심

> **재무팀 이상탐지에 가장 중요한 그룹.**
> 발생 즉시 공시 의무 → DS001 list.json(pblntf_ty=B)로 실시간 감지 가능.

| API명 | 엔드포인트 | 설명 |
|---|---|---|
| 부도발생 | `dfOccrrncSttus.json` | 부도 발생 또는 은행 거래 정지 |
| 영업 정지 | `bsnSspnSttus.json` | 영업 일부 또는 전부 정지 |
| 회생절차 개시 신청 | `rviPetitionSttus.json` | 법원에 회생절차 신청 |
| 해산 사유 | `dsltnRsn.json` | 합병·분할·파산 등 해산 사유 |
| 유상증자 결정 | `piicDecsn.json` | 신주 발행으로 자금 조달 — 대규모 희석 신호 |
| 무상증자 결정 | `fricDecsn.json` | 준비금 자본전입 — 주가 희석 없음 |
| 유상감자 결정 | `prfdStockDividendDecsn.json` | 자본 감소 (주주 환원 or 재무 악화 신호) |
| 무상감자 결정 | `srfdStockDecsn.json` | 결손 보전 목적 감자 — 재무 악화 신호 |
| 합병 결정 | `mmgDecsn.json` | 흡수합병·신설합병 |
| 영업양수 결정 | `asstTrfDecsn.json` | 영업 자산 양수 (M&A 초기 신호) |
| 영업양도 결정 | `asstSlDecsn.json` | 영업 자산 양도 (사업 축소 신호) |
| 자산 양수 결정 | `asstAcqsDecsn.json` | 중요 자산 취득 |
| 자산 양도 결정 | `asstDspDecsn.json` | 중요 자산 처분 |
| 타법인 출자 결정 | `extrInvsDecsn.json` | 타 법인 지분 취득 |
| 분할 결정 | `dvsnDecsn.json` | 인적분할·물적분할 |
| 주식교환·이전 결정 | `stkExchTrDecsn.json` | 완전자·모회사 전환 |
| 회사분할합병 결정 | `dvsnMmgDecsn.json` | 분할 후 합병 |
| 전환사채 발행 | `cvbdIsDecsn.json` | CB 발행 — 잠재 지분 희석 |
| 신주인수권부사채 발행 | `bdIsDecsn.json` | BW 발행 |
| 교환사채 발행 | `exbdIsDecsn.json` | EB 발행 |
| 신주인수권 행사 | `soDecsn.json` | 워런트 행사 |
| 주식 매수 선택권 | `soDecsn.json` | 스톡옵션 현황 |
| 소송 등 제기 | `lawSuit.json` | 중요 소송 접수·결과 |
| 조건부 자본증권 발행 | `cndtlCpBlIsDecsn.json` | 코코본드 |
| 신종자본증권 발행 | `nwCpIsDecsn.json` | 하이브리드채권 |
| 기타 중요사항 | `etcMtr.json` | 기타 주요 공시 (위의 항목에 없는 중요 사항) |

### DS005 공통 반환 필드

```
rcept_no        접수번호 (DS001 원문 조회 키)
rcept_dt        접수일 YYYYMMDD
corp_code       고유번호
corp_name       회사명
report_nm       보고서명
flr_nm          제출인
```

---

## DS006 — 증권신고서 (6개 API)

| API명 | 엔드포인트 | 설명 |
|---|---|---|
| 지분증권 | `estkPblicnDecsn.json` | 주식 발행 (IPO·유상증자) 신고 |
| 채무증권 | `edtPblicnDecsn.json` | 채권 발행 신고 |
| 합병 | `bnkMrgrRgstSttus.json` | 합병 신고 (합병비율 포함) |
| 분할 | `bnkDvsnRgstSttus.json` | 분할 신고 |
| 주식교환·이전 | `bnkExchtrRgstSttus.json` | 주식 교환·이전 신고 |
| 기타 | `bnkEtcRgstSttus.json` | 기타 증권 신고 |

---

## 수집 전략 (현재 미결정 사항)

### 재무팀과 협의 필요한 항목

1. **재무제표 범위**
   - 연결(CFS) vs 별도(OFS) 중 어느 기준이 주요 분석 기준인가?
   - 분기별 재무제표(reprt_code=11013/11014)까지 필요한가, 연간(11011)만으로 충분한가?
   - 어떤 계정이 핵심인가? (매출/영업이익/현금흐름 외 자본총계, 차입금 등)

2. **이상탐지 대상 (DS005)**
   - 어떤 이벤트를 Slack/알림으로 즉시 수신하고 싶은가?
   - 경쟁사 전체를 모니터링할 것인가, 주요 브랜드 기업만인가?

3. **모니터링 기업 범위**
   - 현재: 자사(B.CAVE) + Musinsa 주요 경쟁 브랜드 기업
   - 확대: 무신사 랭킹 상위 N개사 전체 자동 포함?

4. **공시 알림 기준**
   - DS001 pblntf_ty=B (주요사항보고) 전체 수신?
   - 특정 키워드 필터? (부도, 회생, 합병, 영업정지)

### 비상장사 제약

```
비상장사(corp_cls=E)는:
  - DS003 재무제표 API: 미제공 (finstate API 없음)
  - DS001~DS002 일부: 제공 (사업보고서 제출 의무 있는 경우)
  - 재무 수집 방법: document.json → ZIP → XML 직접 파싱 (감사보고서)
  - 연간 감사보고서만 존재 (분기 없음)
```

---

## API 호출 예시

```python
# 기업 고유번호 조회
GET https://opendart.fss.or.kr/api/company.json
  ?crtfc_key=YOUR_KEY&bizr_no=1234567890

# 최근 1주일 주요사항보고서 전체
GET https://opendart.fss.or.kr/api/list.json
  ?crtfc_key=YOUR_KEY
  &pblntf_ty=B
  &bgn_de=20260512
  &end_de=20260519
  &page_count=100

# 연간 단일회사 전체 재무제표 (연결)
GET https://opendart.fss.or.kr/api/fnlttSinglAcntAll.json
  ?crtfc_key=YOUR_KEY
  &corp_code=00126380
  &bsns_year=2025
  &reprt_code=11011
  &fs_div=CFS
```
