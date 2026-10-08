-- Local reviewed candidate only: manual application after separate DB review.
-- No index, table grant, RLS policy, or existing function changes.
CREATE FUNCTION public.get_review_stats_v1(p_from_date date)
RETURNS TABLE (
  rating_5 bigint, rating_4 bigint, rating_3 bigint,
  rating_2 bigint, rating_1 bigint, image_count bigint
)
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT
    count(*) FILTER (WHERE rating = 5),
    count(*) FILTER (WHERE rating = 4),
    count(*) FILTER (WHERE rating = 3),
    count(*) FILTER (WHERE rating = 2),
    count(*) FILTER (WHERE rating = 1),
    count(*) FILTER (WHERE has_image = true)
  FROM public.reviews
  WHERE p_from_date IS NULL OR review_date >= p_from_date;
$$;

-- Only the new routine ACL; caller table privileges and RLS remain authoritative.
REVOKE ALL ON FUNCTION public.get_review_stats_v1(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_review_stats_v1(date) TO authenticated;

-- Rollback, only after restoring the previous adapter:
-- DROP FUNCTION public.get_review_stats_v1(date);
