"""
리 키즈 (LEE KIDS) 리뷰 수집 — backfill 누락분 보완
"""
import asyncio, pathlib, sys
sys.path.insert(0, str(pathlib.Path(__file__).parent.parent))
from dotenv import load_dotenv
load_dotenv(pathlib.Path("/Users/macmini/projects/uttu/.env"))

from supabase import create_client
import os

service_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ["SUPABASE_SERVICE_KEY"]
client = create_client(os.environ["SUPABASE_URL"], service_key)

# leekids 브랜드 id
brand = client.table("brands").select("id").eq("slug", "leekids").single().execute().data
brand_id = brand["id"]

# review_count > 0인 상품만 (나머지는 어차피 리뷰 없음)
products = (
    client.table("products")
    .select("id, musinsa_no, name, review_count")
    .eq("brand_id", brand_id)
    .eq("is_own", True)
    .gt("review_count", 0)
    .order("review_count", desc=True)
    .execute()
    .data or []
)
print(f"대상 상품: {len(products)}개 (review_count > 0)")

from worker.scrapers.musinsa_review import ReviewScraper

async def run():
    scraper = ReviewScraper(client)
    total = 0
    for i, p in enumerate(products, 1):
        collected = await scraper.run_product(
            product_id=p["id"],
            musinsa_no=p["musinsa_no"],
            full_collect=True,
            product_idx=i,
            product_total=len(products),
        )
        total += collected
        print(f"[{i}/{len(products)}] {p['musinsa_no']} {p['name']} → {collected}건 (누적 {total}건)")
    print(f"\n완료: 총 {total}건 수집")

asyncio.run(run())
