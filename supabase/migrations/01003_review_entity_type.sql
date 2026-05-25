-- 리뷰 메모 기능을 위한 entity_type enum 확장
ALTER TYPE public.entity_type ADD VALUE IF NOT EXISTS 'review';
