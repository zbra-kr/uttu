-- anomaly_notes: 이상탐지 항목별 팀 메모
CREATE TABLE public.anomaly_notes (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  anomaly_id  uuid        NOT NULL REFERENCES public.anomalies(id) ON DELETE CASCADE,
  user_id     uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  body        text        NOT NULL CHECK (char_length(body) > 0),
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.anomaly_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth_select"     ON public.anomaly_notes FOR SELECT TO authenticated USING (true);
CREATE POLICY "users_insert_own" ON public.anomaly_notes FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "users_delete_own" ON public.anomaly_notes FOR DELETE TO authenticated USING (user_id = auth.uid());
CREATE POLICY "admin_all"       ON public.anomaly_notes FOR ALL TO authenticated
  USING ((SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin');

CREATE INDEX anomaly_notes_anomaly_id_idx ON public.anomaly_notes (anomaly_id);
