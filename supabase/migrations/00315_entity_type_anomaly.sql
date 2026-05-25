-- entity_type enum에 anomaly 추가, anomaly_notes 테이블 제거 (user_notes로 통합)
ALTER TYPE public.entity_type ADD VALUE IF NOT EXISTS 'anomaly';
DROP TABLE IF EXISTS public.anomaly_notes;
