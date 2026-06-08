-- notification_event ENUM에 funding_collection_done 추가
-- 워커가 투자정보 수집 완료 시 요청자에게 앱내 알림 발송에 사용

alter type notification_event add value if not exists 'funding_collection_done';
