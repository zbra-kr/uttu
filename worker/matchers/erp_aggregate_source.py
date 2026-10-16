"""Read-only daily source over an existing supplied Snowflake connection.
No env/SDK/key loader, client construction, SQL write, Supabase, or scheduler.
"""
from datetime import date

from .central_sales_readonly import LocalReadBlocked, _execute_fixed_read

DAILY_SQL = "SELECT BRANDCD,SALEDT,SUM(SALEAMT_VAT_EX) AS SALES_VAT_EX,COUNT(*) AS SOURCE_ROWS,COUNT(SALEAMT_VAT_EX) AS AMOUNT_ROWS\nFROM BCAVE.SEWON.VW_SALES_VAT\nWHERE BRANDCD = %s AND SALEDT BETWEEN %s AND %s AND LENGTH(SALEDT)=8\nAND SHOPCD NOT IN ('B6055','B6057','B6063')\nGROUP BY BRANDCD,SALEDT\nORDER BY SALEDT\nLIMIT 32"
STYLE_DAILY_SQL = """SELECT BRANDCD,STYLECD,SALEDT,SUM(SALEAMT_VAT_EX) AS SALES_VAT_EX,COUNT(*) AS SOURCE_ROWS,COUNT(SALEAMT_VAT_EX) AS AMOUNT_ROWS
FROM BCAVE.SEWON.VW_SALES_VAT
WHERE BRANDCD = %s AND SALEDT BETWEEN %s AND %s AND LENGTH(SALEDT)=8
AND SHOPCD NOT IN ('B6055','B6057','B6063')
AND STYLECD IN ({placeholders})
GROUP BY BRANDCD,STYLECD,SALEDT
ORDER BY SALEDT,STYLECD
LIMIT 141"""


def _binds(scope):
    if type(scope) is not dict:
        raise LocalReadBlocked("INVALID_SCOPE")
    captured = scope.copy()
    try:
        start, end = date.fromisoformat(captured["from"]), date.fromisoformat(captured["to"])
        if captured.get("brand") != "CO" or captured.get("aggregate") != "daily" or (end-start).days != 13 or start.isoformat() != captured["from"] or end.isoformat() != captured["to"]:
            raise ValueError()
    except (ValueError, KeyError, TypeError):
        raise LocalReadBlocked("INVALID_SCOPE") from None
    return ("CO", start.strftime("%Y%m%d"), end.strftime("%Y%m%d"))


def _transport(receipt):
    # Source FLOAT stays approximate. Numeric strings preserve driver-returned digits,
    # not accounting precision; count strings avoid JSON integer rounding.
    for row in receipt["rows"]:
        for field in ("SOURCE_ROWS", "AMOUNT_ROWS"):
            if type(row[field]) is not int or row[field] < 0:
                raise LocalReadBlocked("COUNT_INVALID")
            row[field] = str(row[field])
        value = row["SALES_VAT_EX"]
        if value is not None:
            if type(value) not in (int, float, str):
                raise LocalReadBlocked("AMOUNT_INVALID")
            row["SALES_VAT_EX"] = str(value)
    return receipt


def execute_central_daily_sales(connection, scope):
    binds = _binds(scope)
    return _transport(_execute_fixed_read(connection, binds, DAILY_SQL,
        ["BRANDCD", "SALEDT", "SALES_VAT_EX", "SOURCE_ROWS", "AMOUNT_ROWS"], 32))


def execute_central_style_daily_sales(connection, scope, styles):
    binds = _binds(scope)
    if type(styles) not in (list, tuple) or not 1 <= len(styles) <= 10 or any(type(s) is not str or not s.strip() or len(s) > 160 or any(ord(c) < 32 for c in s) for s in styles) or len(set(styles)) != len(styles):
        raise LocalReadBlocked("STYLES_INVALID")
    captured = tuple(styles)
    sql = STYLE_DAILY_SQL.format(placeholders=",".join(["%s"]*len(captured)))
    return _transport(_execute_fixed_read(connection, binds+captured, sql,
        ["BRANDCD", "STYLECD", "SALEDT", "SALES_VAT_EX", "SOURCE_ROWS", "AMOUNT_ROWS"], 141))
