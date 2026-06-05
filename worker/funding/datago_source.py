"""
data.go.kr 자금조달 공시 / 크라우드펀딩 정보 수집

현재 상태 (2026-06):
  - DATA_GO_KR_SERVICE_KEY 키는 존재하나 getFundIssuCompInfo 엔드포인트에 HTTP 403 반환
  - API 신청 승인 또는 IP 허용 필요 → stub 구현

TODO (승인 후 구현):
  1. 크라우드펀딩정보 (비상장 증권형):
     GET http://apis.data.go.kr/1160100/service/GetFundInfoService/getFundIssuCompInfo
     ?serviceKey=KEY&resultType=json&pageNo=1&numOfRows=100&co_nm=회사명
     source_type = 'datago_crowd'

  2. 자금조달공시 (GetFundInfoService — 공모·사모):
     source_type = 'datago_fund'

  3. 주식발행정보 (GetStockIssuInfoService):
     ⚠️ 공공누리 2유형 — 내부 시스템 전용만 허용, 외부 서비스 재배포 금지
     source_type = 'datago_stock'
"""
from __future__ import annotations

from loguru import logger


async def fetch_datago_rounds(company_name: str) -> list[dict]:
    """
    data.go.kr에서 해당 회사의 자금조달 정보 조회.

    현재: 403 접근제한으로 stub 반환 (빈 리스트).
    승인 완료 후 아래 TODO 구현.

    Parameters
    ----------
    company_name : 검색할 회사명

    Returns
    -------
    list of dicts (source_type='datago_crowd'|'datago_fund'|'datago_stock')
    """
    # TODO: DATA_GO_KR_SERVICE_KEY API 승인 후 구현
    # import os, httpx
    # key = os.environ.get("DATA_GO_KR_SERVICE_KEY")
    # if not key:
    #     logger.warning("datago_no_key")
    #     return []
    #
    # async with httpx.AsyncClient(timeout=30) as client:
    #     resp = await client.get(
    #         "http://apis.data.go.kr/1160100/service/GetFundInfoService/getFundIssuCompInfo",
    #         params={
    #             "serviceKey": key,
    #             "resultType": "json",
    #             "pageNo": 1,
    #             "numOfRows": 100,
    #             "co_nm": company_name,
    #         },
    #     )
    #     resp.raise_for_status()
    #     data = resp.json()
    #     items = data.get("response", {}).get("body", {}).get("items", {}).get("item", [])
    #     if isinstance(items, dict):
    #         items = [items]
    #     return [_parse_crowd_item(it) for it in items]

    logger.debug("datago_stub", company=company_name)
    return []
