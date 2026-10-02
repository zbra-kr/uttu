-- Add a bounded source snapshot for new ranking notes. Existing rows stay null.
-- Apply separately after review; this changes no RLS, grants, or dispatch ledger.
ALTER TABLE public.user_notes
  ADD COLUMN IF NOT EXISTS source_context jsonb;

ALTER TABLE public.user_notes
  ADD CONSTRAINT user_notes_source_context_bounded_object
  CHECK (
    source_context IS NULL
    OR (jsonb_typeof(source_context) = 'object' AND octet_length(source_context::text) <= 8192)
  );
