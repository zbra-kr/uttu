"""Read bounded source style/color sets and exact-code linked catalog products."""

from urllib.parse import urlparse

from .central_sales_readonly import LocalReadBlocked, _execute_fixed_read
from .erp_aggregate_source import _binds, execute_central_style_daily_sales
from .erp_code_candidates import direct_code
from .erp_existing_connection import (
    ExistingReadFailure,
    existing_mda_connection,
    existing_uttu_product_reader,
)
from .erp_session_bounded_read import SET_OWNED_TIMEOUT, _timeout


def read_style_color_sales(styles, scope, factory=existing_mda_connection):
    _binds(scope)
    if type(styles) not in (list, tuple):
        raise RuntimeError("STYLE_SCOPE_INVALID")
    captured = tuple(styles)
    if (
        not 1 <= len(captured) <= 10
        or len(set(captured)) != len(captured)
        or any(direct_code(s) is None for s in captured)
    ):
        raise RuntimeError("STYLE_SCOPE_INVALID")
    scope = scope.copy()
    metadata = {
        "timeout_before": None,
        "timeout_confirmed": None,
        "closed": False,
        "read_failure": None,
    }
    connection = None
    try:
        connection = factory()
        c = connection.cursor()
        try:
            metadata["timeout_before"] = _timeout(c)
            if not 1 <= metadata["timeout_before"] <= 10:
                c.execute(SET_OWNED_TIMEOUT, timeout=10)
            metadata["timeout_confirmed"] = _timeout(c)
            if not 1 <= metadata["timeout_confirmed"] <= 10:
                raise RuntimeError("TIMEOUT_UNCONFIRMED")
        finally:
            c.close()

        class Cursor:
            def __init__(self, raw):
                self.raw = raw

            def __getattr__(self, name):
                return getattr(self.raw, name)

            def execute(self, sql, binds=None):
                return self.raw.execute(sql, binds, timeout=10)

        class Connection:
            def cursor(self):
                return Cursor(connection.cursor())

        sql = (
            "SELECT DISTINCT BRANDCD,STYLECD,COLORCD FROM BCAVE.SEWON.SW_STYLEINFO_DETAIL WHERE BRANDCD=%s AND STYLECD IN ("
            + ",".join(["%s"] * len(captured))
            + ") ORDER BY STYLECD,COLORCD LIMIT 101"
        )
        colors = _execute_fixed_read(
            Connection(), ("CO",) + captured, sql, ["BRANDCD", "STYLECD", "COLORCD"], 101
        )
        if any(
            r["BRANDCD"] != "CO"
            or r["STYLECD"] not in captured
            or direct_code(r["COLORCD"]) is None
            for r in colors["rows"]
        ):
            raise RuntimeError("COLOR_SCOPE_INVALID")
        sales = execute_central_style_daily_sales(Connection(), scope, list(captured))
        return {
            "scope": scope,
            "styles": list(captured),
            "colors": colors,
            "sales": sales,
            "metadata": metadata,
        }
    except Exception as error:
        metadata["read_failure"] = (
            str(error) if isinstance(error, LocalReadBlocked) else "STYLE_EVIDENCE_READ_FAILED"
        )
        raise ExistingReadFailure(metadata["read_failure"], metadata) from None
    finally:
        if connection is not None:
            try:
                connection.close()
                check = getattr(connection, "is_closed", None)
                if callable(check) and check() is not True:
                    raise RuntimeError("CLOSE_UNCONFIRMED")
                metadata["closed"] = True
            except Exception as error:
                metadata["close_exception_class"] = type(error).__name__
                raise ExistingReadFailure("STYLE_EVIDENCE_CLOSE_FAILED", metadata) from None


def read_linked_market_products(colors, dates, factory=existing_uttu_product_reader):
    if colors.get("complete") is not True or len(colors.get("rows", [])) > 100:
        return {"complete": False, "products": [], "ranks": [], "reason": "COLOR_SOURCE_INCOMPLETE"}
    if any(
        type(r) is not dict
        or r.get("BRANDCD") != "CO"
        or direct_code(r.get("STYLECD")) is None
        or direct_code(r.get("COLORCD")) is None
        for r in colors["rows"]
    ):
        raise RuntimeError("COLOR_SCOPE_INVALID")
    codes = sorted({r["STYLECD"] + r["COLORCD"] for r in colors["rows"]})
    if not codes or len(codes) > 100 or tuple(dates) != ("2026-10-07", "2026-10-14"):
        raise RuntimeError("MARKET_SCOPE_INVALID")
    client = factory()
    url = urlparse(str(client.supabase_url))
    if (
        url.scheme != "https"
        or url.hostname != "ogtrvberttzupxrffpoh.supabase.co"
        or url.username
        or url.password
        or url.port
    ):
        raise RuntimeError("DESTINATION_UNVERIFIED")
    response = (
        client.table("products")
        .select(
            "id,musinsa_no,brand_id,name,style_no,erp_style_code,brands!inner(slug)", count="exact"
        )
        .eq("is_own", True)
        .eq("brands.slug", "covernat")
        .in_("style_no", codes)
        .order("id")
        .limit(101)
        .execute()
    )
    products = response.data
    if type(products) is not list or len(products) > 101:
        raise RuntimeError("PRODUCT_RESPONSE_INVALID")
    complete = (
        type(response.count) is int and response.count == len(products) and response.count <= 100
    )
    if not complete:
        return {
            "complete": False,
            "products": products,
            "ranks": [],
            "exact_count": response.count,
            "reason": "PRODUCT_LINKS_INCOMPLETE",
        }
    for p in products:
        if (
            p.get("style_no") not in codes
            or type(p.get("brands")) is not dict
            or p["brands"].get("slug") != "covernat"
        ):
            raise RuntimeError("PRODUCT_SCOPE_INVALID")
    ids = [p["id"] for p in products]
    ranks = []
    rank_complete = False
    queries = 1
    if ids:
        r = (
            client.table("ranking_snapshots")
            .select(
                "product_id,snapshot_date,rank_position,store_code,category_code,gender_filter,age_filter",
                count="exact",
            )
            .in_("product_id", ids)
            .in_("snapshot_date", list(dates))
            .eq("store_code", "musinsa")
            .eq("category_code", "000")
            .eq("gender_filter", "A")
            .eq("age_filter", "AGE_BAND_ALL")
            .limit(201)
            .execute()
        )
        queries += 1
        if type(r.data) is list and len(r.data) <= 200:
            ranks = r.data
            rank_complete = type(r.count) is int and r.count == len(ranks)
    return {
        "complete": complete,
        "products": [
            {
                k: p.get(k)
                for k in ("id", "musinsa_no", "brand_id", "name", "style_no", "erp_style_code")
            }
            for p in products
        ],
        "ranks": ranks,
        "rank_read_complete": rank_complete,
        "exact_count": response.count,
        "queries": queries,
        "relation": "exact observed STYLECD+COLORCD == style_no under covernat catalog; not confirmed mapping",
    }
