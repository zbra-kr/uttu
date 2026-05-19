-- 00099_rls.sql
-- 전 테이블 RLS 활성화 + anon SELECT 허용
-- service_role은 RLS bypass — 별도 정책 불필요 (worker 전용)
-- viewer에는 SUPABASE_ANON_KEY만 사용 — service_role 절대 포함 금지
-- 적용: SQL Editor 수동 실행 (자동 적용 금지)

-- ─── companies ───────────────────────────────────────────────────────────────
ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon read companies"
  ON companies FOR SELECT TO anon USING (true);

-- ─── brands ──────────────────────────────────────────────────────────────────
ALTER TABLE brands ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon read brands"
  ON brands FOR SELECT TO anon USING (true);

-- ─── products ────────────────────────────────────────────────────────────────
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon read products"
  ON products FOR SELECT TO anon USING (true);

-- ─── ranking_snapshots ───────────────────────────────────────────────────────
ALTER TABLE ranking_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon read ranking_snapshots"
  ON ranking_snapshots FOR SELECT TO anon USING (true);

-- ─── promotions ──────────────────────────────────────────────────────────────
ALTER TABLE promotions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon read promotions"
  ON promotions FOR SELECT TO anon USING (true);

-- ─── reviews ─────────────────────────────────────────────────────────────────
ALTER TABLE reviews ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon read reviews"
  ON reviews FOR SELECT TO anon USING (true);

-- ─── review_analysis ─────────────────────────────────────────────────────────
ALTER TABLE review_analysis ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon read review_analysis"
  ON review_analysis FOR SELECT TO anon USING (true);

-- ─── own_sales_daily ─────────────────────────────────────────────────────────
ALTER TABLE own_sales_daily ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon read own_sales_daily"
  ON own_sales_daily FOR SELECT TO anon USING (true);

-- ─── own_inventory ───────────────────────────────────────────────────────────
ALTER TABLE own_inventory ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon read own_inventory"
  ON own_inventory FOR SELECT TO anon USING (true);

-- ─── dart_disclosures ────────────────────────────────────────────────────────
ALTER TABLE dart_disclosures ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon read dart_disclosures"
  ON dart_disclosures FOR SELECT TO anon USING (true);

-- ─── dart_financials ─────────────────────────────────────────────────────────
ALTER TABLE dart_financials ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon read dart_financials"
  ON dart_financials FOR SELECT TO anon USING (true);

-- Rollback (테이블 삭제 없이 RLS만 비활성화):
-- ALTER TABLE companies         DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE brands            DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE products          DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE ranking_snapshots DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE promotions        DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE reviews           DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE review_analysis   DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE own_sales_daily   DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE own_inventory     DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE dart_disclosures  DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE dart_financials   DISABLE ROW LEVEL SECURITY;
