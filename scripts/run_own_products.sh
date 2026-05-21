#!/bin/bash
# 자사 브랜드 상품 전수 수집 (커버낫/와키윌리/리 계열 ~9,271개)
# cron: 30 0 * * *  (매일 00:30 — 랭킹 수집 전)
cd "$(dirname "$0")/.."
source .venv/bin/activate
python -m worker.scrapers.musinsa_own_products
