-- reviews.rating 제약 완화: 0 허용 (무신사에서 별점 없이 텍스트만 남긴 리뷰)
ALTER TABLE reviews DROP CONSTRAINT reviews_rating_check;
ALTER TABLE reviews ADD CONSTRAINT reviews_rating_check CHECK (rating BETWEEN 0 AND 5);
