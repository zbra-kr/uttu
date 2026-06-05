"""
worker.funding — 투자유치/자금조달 on-demand 수집 패키지

소스:
  dart_source   : DART estkRs(증권신고서 지분증권) + piicDecsn(유상증자결정)
  news_source   : 뉴스 검색 + Ollama NLP 추출
  datago_source : data.go.kr (크라우드펀딩 등 — 403 접근제한 시 stub)
  merge         : dedup + 정규화
  orchestrator  : 잡 픽업 + 전체 흐름 실행
"""
