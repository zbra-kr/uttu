"""Local-only adapter over a supplied, already authenticated Snowflake connection.

No authentication/env/key loading, worker spawning or service registration.
The caller must first verify/pin the requester's existing server session.
"""
from datetime import date

BRANDS = frozenset(("CO", "LE", "WA", "CK", "LK"))
SQL = """SELECT BRANDCD,STYLECD,SALEDT,SUM(SALEAMT_VAT_EX) AS SALES_VAT_EX
FROM BCAVE.SEWON.VW_SALES_VAT
WHERE BRANDCD = %s AND SALEDT BETWEEN %s AND %s AND LENGTH(SALEDT)=8
AND SHOPCD NOT IN ('B6055','B6057','B6063')
GROUP BY BRANDCD,STYLECD,SALEDT
ORDER BY SALEDT,STYLECD
LIMIT 201"""


class LocalReadBlocked(RuntimeError):
    """Fixed code only; never include a driver's raw error/credential material."""


def execute_central_sales(connection, scope):
    """Use existing local client; return internal aggregate projection, not UI DTO.

    No arbitrary SQL input. Actual SDK cancellation is governed by the existing
    session timeout; client/session creation and auth stay outside this adapter.
    """
    if type(scope) is not dict:
        raise LocalReadBlocked("INVALID_SCOPE")
    captured = scope.copy()
    brand, from_value, to_value = captured.get("brand"), captured.get("from"), captured.get("to")
    if not isinstance(brand, str) or brand not in BRANDS:
        raise LocalReadBlocked("INVALID_SCOPE")
    try:
        start, end = date.fromisoformat(from_value), date.fromisoformat(to_value)
        if start.isoformat() != from_value or end.isoformat() != to_value:
            raise ValueError()
        if not 1 <= (end - start).days + 1 <= 31:
            raise ValueError()
    except (ValueError, KeyError, TypeError):
        raise LocalReadBlocked("INVALID_SCOPE") from None
    # Immutable binds constructed from the validated snapshot before cursor/I/O.
    binds = (brand, start.strftime("%Y%m%d"), end.strftime("%Y%m%d"))
    try:
        cursor = connection.cursor()
    except Exception:
        raise LocalReadBlocked("LOCAL_CURSOR_UNAVAILABLE") from None
    try:
        cursor.execute("SHOW PARAMETERS LIKE 'STATEMENT_TIMEOUT_IN_SECONDS' IN SESSION")
        columns = [c[0].lower() for c in cursor.description]
        params = [dict(zip(columns, row)) for row in cursor.fetchall()]
        timeout = next((p.get("value") for p in params if p.get("key") == "STATEMENT_TIMEOUT_IN_SECONDS"), None)
        if timeout is None or not str(timeout).isdigit() or not 1 <= int(timeout) <= 10:
            raise LocalReadBlocked("TIMEOUT_UNCONFIRMED")
        cursor.execute("EXPLAIN USING JSON " + SQL, binds)
        import json
        raw = cursor.fetchone()[0]
        plan = json.loads(raw) if isinstance(raw, str) else raw
        stats = plan.get("GlobalStats", {}) if isinstance(plan, dict) else {}
        size, partitions = stats.get("bytesAssigned"), stats.get("partitionsAssigned")
        if type(size) is not int or type(partitions) is not int or not 0 <= size <= 16777216 or not 0 <= partitions <= 32:
            raise LocalReadBlocked("SCAN_BUDGET_UNCONFIRMED")
        cursor.execute(SQL, binds)
        rows = cursor.fetchmany(201)
        names = [c[0] for c in cursor.description]
        if names != ["BRANDCD", "STYLECD", "SALEDT", "SALES_VAT_EX"] or len(rows) > 201 or any(not isinstance(row, (tuple, list)) or len(row) != 4 for row in rows):
            raise LocalReadBlocked("PROJECTION_INVALID")
        return {"complete": len(rows) <= 200, "rows": [dict(zip(names, row)) for row in rows]}
    except LocalReadBlocked:
        raise
    except Exception:
        raise LocalReadBlocked("LOCAL_READ_FAILED") from None
    finally:
        try:
            cursor.close()
        except Exception:
            raise LocalReadBlocked("LOCAL_CURSOR_CLOSE_FAILED") from None
