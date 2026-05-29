#!/bin/bash
# 색상 그룹 ID 수집 (1회성 또는 주기적 갱신)
#
# 동작:
#   is_own + review_count > 0 + color_group_id IS NULL 상품에 대해
#   goods-detail.musinsa.com/api2/goods/{goodsNo}/curation/other-color 호출
#   그룹 발견 시 그룹 내 모든 상품 color_group_id 일괄 세팅
#   단독 상품은 color_group_id = 0 으로 마킹 (처리 완료 표시)
#
# 재시작 안전: color_group_id IS NOT NULL 상품 자동 스킵
#
# [전체 실행]
#   ./scripts/run_color_group.sh
#
# [테스트 - 50개만]
#   ./scripts/run_color_group.sh --limit 50
#
# 완료 후 Supabase SQL Editor에서 실행:
#   UPDATE reviews r
#   SET color_group_id = p.color_group_id
#   FROM products p
#   WHERE p.musinsa_no = r.goods_no
#     AND p.color_group_id IS NOT NULL
#     AND p.color_group_id != 0
#     AND r.color_group_id IS NULL;

cd "$(dirname "$0")/.."
source worker/.venv/bin/activate
python -m worker.scrapers.musinsa_color_group "$@"
