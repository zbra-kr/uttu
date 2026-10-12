"""Complete, bounded CS inputs from stored own reviews by written date.

No database mutation or client creation. An incomplete read aborts input collection.
"""

from __future__ import annotations

from collections import Counter
from datetime import date, datetime, timedelta, timezone
from uuid import UUID

from httpx import Headers

PAGE_SIZE = 250
MAX_REVIEWS = 10_000


class CSReviewInputError(RuntimeError):
    """No partial inputs may be published as an absence of reviews."""


def _pages(db, start: date, end: date, cutoff: str):
    total = None
    previous_id = None
    offset = 0
    while True:
        try:
            query = (
                db.table("reviews")
                .select(
                    "id,product_id,rating,review_text,review_date,created_at,helpful_count,"
                    "products!inner(is_own,name,brands(slug))",
                    count="exact",
                )
                .eq("products.is_own", True)
                .gte("review_date", start.isoformat())
                .lte("review_date", end.isoformat())
                .lte("created_at", cutoff)
                .order("id")
                .range(offset, offset + PAGE_SIZE - 1)
                .retry(False)
            )
            # Inspect the raw response before SDK empty-body normalization.
            # This scoped request uses the builder's existing session/headers/auth.
            if query.request.http_method != "GET":
                raise CSReviewInputError("CS review input requires GET")
            response = query.request.send(Headers())
            if response.status_code not in (200, 206):
                raise CSReviewInputError("CS review input HTTP read failed")
            rows = response.json()
            span, raw_count = response.headers["content-range"].split("/")
            if not raw_count.isdecimal():
                raise CSReviewInputError("CS review input count is missing")
            count = int(raw_count)
            expected = min(PAGE_SIZE, max(0, count - offset))
            if span != (f"{offset}-{offset + expected - 1}" if expected else "*"):
                raise CSReviewInputError("CS review input range is incomplete")
        except Exception:
            raise CSReviewInputError("CS review input read failed") from None
        if (
            not isinstance(rows, list)
            or type(count) is not int
            or count < 0
            or count > MAX_REVIEWS
            or (total is not None and total != count)
            or len(rows) != min(PAGE_SIZE, max(0, count - offset))
        ):
            raise CSReviewInputError("CS review input response is incomplete")
        total = count
        for row in rows:
            try:
                identifier = UUID(row["id"])
                product_identifier = UUID(row["product_id"])
                written = date.fromisoformat(row["review_date"])
                inserted = datetime.fromisoformat(row["created_at"])
                product = row["products"]
                brand = product["brands"]
                valid = (
                    isinstance(row["id"], str)
                    and str(identifier) == row["id"]
                    and (previous_id is None or identifier.int > previous_id)
                    and written.isoformat() == row["review_date"]
                    and start <= written <= end
                    and inserted.tzinfo is not None
                    and inserted <= datetime.fromisoformat(cutoff)
                    and isinstance(product, dict)
                    and product["is_own"] is True
                    and isinstance(product["name"], str)
                    and (
                        brand is None
                        or (isinstance(brand, dict) and isinstance(brand["slug"], str))
                    )
                    and str(product_identifier) == row["product_id"]
                    and type(row["rating"]) is int
                    and 0 <= row["rating"] <= 5
                    and type(row["helpful_count"]) is int
                    and row["helpful_count"] >= 0
                    and isinstance(row["review_text"], str)
                )
            except (KeyError, TypeError, ValueError, AttributeError):
                valid = False
            if not valid:
                raise CSReviewInputError("CS review input row is invalid or duplicated")
            previous_id = identifier.int
            yield row
        offset += len(rows)
        if offset == total:
            return


def _keep_sample(rows, row, maximum=10):
    # Bounded sample; tie-break by stable review primary key. Never send row IDs.
    rows.append({**row, "review_text": row["review_text"][:200]})
    rows.sort(key=lambda r: (-r["helpful_count"], r["id"]))
    del rows[maximum:]


def read_cs_review_inputs(db, target_date: date) -> dict:
    yesterday = target_date - timedelta(days=1)
    monday = target_date - timedelta(days=target_date.weekday())
    cutoff = datetime.now(timezone.utc).isoformat()
    daily = Counter()
    low, high = [], []
    brands = {}
    products = {}
    total = 0
    missing_brand_rows = 0
    for row in _pages(db, min(monday, yesterday), yesterday, cutoff):
        total += 1
        rating = row["rating"]
        brand = row["products"]["brands"]
        slug = brand["slug"] if brand is not None else "unknown"
        missing_brand_rows += brand is None
        if row["review_date"] == yesterday.isoformat():
            daily[rating] += 1
            if rating <= 2:
                _keep_sample(low, row)
            if rating >= 4:
                _keep_sample(high, row)
        if monday <= yesterday and row["review_date"] >= monday.isoformat():
            product = row["products"]
            brands.setdefault(slug, Counter())[rating] += 1
            item = products.setdefault(
                row["product_id"],
                {
                    "name": product["name"],
                    "brand_slug": slug,
                    "low": 0,
                    "high": 0,
                },
            )
            item["low"] += rating <= 2
            item["high"] += rating >= 4
    count = sum(daily.values())

    def sample(row):
        return {
            "rating": row["rating"],
            "text": row["review_text"][:200],
            "review_date": row["review_date"],
        }

    def top(kind):
        ranked = sorted(products.items(), key=lambda item: (-item[1][kind], item[0]))
        return [
            {
                "product_id": pid,
                "product_name": value["name"],
                "brand_slug": value["brand_slug"],
                f"{kind}_review_count": value[kind],
            }
            for pid, value in ranked
            if value[kind] > 0
        ][:5]

    return {
        "review_input_scope": {
            "state": "complete",
            "source": "stored_own_reviews",
            "date_basis": "review_date (작성일)",
            "timezone": "Asia/Seoul",
            "daily_written_date": yesterday.isoformat(),
            "weekly_written_start": monday.isoformat() if monday <= yesterday else None,
            "weekly_written_end": yesterday.isoformat() if monday <= yesterday else None,
            "inserted_at_field": "created_at (DB 최초 삽입 시각)",
            "inserted_at_cutoff_utc": cutoff,
            "queried_rows": total,
            "missing_brand_rows": missing_brand_rows,
            "page_size": PAGE_SIZE,
            "row_safety_limit": MAX_REVIEWS,
            "collection_complete": "unverified",
        },
        "review_summary_yesterday": {
            "count": count,
            "avg_rating": round(sum(k * v for k, v in daily.items()) / count, 2) if count else None,
            "rating_dist": {str(i): daily[i] for i in range(0, 6)},
            "low_samples": [sample(r) for r in low[:5]],
            "high_samples": [sample(r) for r in high[:5]],
        },
        "low_reviews": [sample(r) for r in low],
        "high_reviews": [sample(r) for r in high],
        "weekly_review_pattern": [
            {
                "brand_slug": slug,
                "period": f"{monday.isoformat()} ~ {yesterday.isoformat()}",
                "count": sum(ratings.values()),
                "avg_rating": round(
                    sum(k * v for k, v in ratings.items()) / sum(ratings.values()), 2
                ),
                "rating_dist": {str(i): ratings[i] for i in range(0, 6)},
            }
            for slug, ratings in sorted(brands.items())
        ],
        "problem_products_top": top("low"),
        "strength_products_top": top("high"),
    }
