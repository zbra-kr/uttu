'use client';

export interface AdminUser {
  id: string;
  email: string;
  full_name: string | null;
  display_name: string | null;
  role: 'admin' | 'viewer';
  team: string | null;
  avatar_url: string | null;
  created_at: string;
  last_sign_in_at: string | null;
  quota: {
    monthly_token_limit: number | null;
    daily_token_limit: number | null;
    is_blocked: boolean;
    note: string | null;
  };
  usage_this_month: {
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
    session_count: number;
  };
  usage_today: number;
}

export async function fetchAdminUsers(opts: {
  q?: string;
  role?: 'admin' | 'viewer' | 'all';
  page?: number;
  limit?: number;
} = {}): Promise<{ users: AdminUser[]; total: number }> {
  const params = new URLSearchParams();
  if (opts.q)                        params.set('q',     opts.q);
  if (opts.role && opts.role !== 'all') params.set('role', opts.role);
  if (opts.page)                     params.set('page',  String(opts.page));
  if (opts.limit)                    params.set('limit', String(opts.limit));
  const res = await fetch(`/api/admin/users?${params}`);
  if (!res.ok) return { users: [], total: 0 };
  return res.json();
}

export interface AdminUserPatch {
  profile?: { role?: 'admin' | 'viewer'; display_name?: string | null; team?: string | null };
  quota?: {
    monthly_token_limit?: number | null;
    daily_token_limit?: number | null;
    is_blocked?: boolean;
    note?: string | null;
  };
}

export async function updateAdminUser(id: string, patch: AdminUserPatch): Promise<{ error: string | null }> {
  const res = await fetch(`/api/admin/users/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    const { error } = await res.json().catch(() => ({ error: '요청 실패' }));
    return { error };
  }
  return { error: null };
}

export interface AdminUserSession {
  id: string;
  route: string | null;
  context: string[] | null;
  started_at: string;
  ended_at: string | null;
  message_count: number;
  input_tokens: number;
  output_tokens: number;
  title: string | null;
  ai_provider: string | null;
  ai_model: string | null;
}

export async function fetchAdminUserSessions(id: string, limit = 10): Promise<AdminUserSession[]> {
  const res = await fetch(`/api/admin/users/${id}/sessions?limit=${limit}`);
  if (!res.ok) return [];
  const { sessions } = await res.json();
  return sessions ?? [];
}

// ── 수집 작업 모니터링 ────────────────────────────────────────────────────────

export interface CollectionJob {
  id: string;
  script: string;
  label: string | null;
  status: 'running' | 'done' | 'error';
  rows_done: number;
  target: number | null;
  started_at: string;
  finished_at: string | null;
  error_msg: string | null;
  updated_at: string;
}

export interface JobsKpi {
  total_today: number;
  success_today: number;
  error_today: number;
  running_today: number;
  avg_duration_7d_sec: number | null;
}

export interface JobHistoryPoint {
  date: string;
  success: number;
  error: number;
}

export async function fetchTodayJobs(): Promise<CollectionJob[]> {
  const res = await fetch('/api/admin/jobs/today');
  if (!res.ok) return [];
  const { jobs } = await res.json();
  return jobs ?? [];
}

export async function fetchJobsHistory(days = 14): Promise<JobHistoryPoint[]> {
  const res = await fetch(`/api/admin/jobs/history?days=${days}`);
  if (!res.ok) return [];
  const { history } = await res.json();
  return history ?? [];
}

export async function fetchJobsKpi(): Promise<JobsKpi | null> {
  const res = await fetch('/api/admin/jobs/kpi');
  if (!res.ok) return null;
  return res.json();
}

export async function fetchJobDetail(id: string): Promise<CollectionJob | null> {
  const res = await fetch(`/api/admin/jobs/${id}`);
  if (!res.ok) return null;
  const { job } = await res.json();
  return job ?? null;
}

// ── LLM 모델 관리 ─────────────────────────────────────────────────────────────

export interface LlmModel {
  id: string;
  provider: string;
  model_id: string;
  display_name: string;
  is_default: boolean;
  is_active: boolean;
  max_tokens: number | null;
  created_at: string;
}

export interface LlmProviders {
  claude: boolean;
  openai: boolean;
  gemini: boolean;
}

export async function fetchLlmProviders(): Promise<LlmProviders> {
  const res = await fetch('/api/admin/llm/providers');
  if (!res.ok) return { claude: false, openai: false, gemini: false };
  return res.json();
}

export async function fetchAllLlmModels(): Promise<LlmModel[]> {
  const res = await fetch('/api/admin/llm/models');
  if (!res.ok) return [];
  const { models } = await res.json();
  return models ?? [];
}

export interface LlmModelInput {
  provider: string;
  model_id: string;
  display_name: string;
  is_default?: boolean;
  is_active?: boolean;
  max_tokens?: number | null;
}

export async function createLlmModel(input: LlmModelInput): Promise<{ error: string | null }> {
  const res = await fetch('/api/admin/llm/models', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const { error } = await res.json().catch(() => ({ error: '요청 실패' }));
    return { error };
  }
  return { error: null };
}

export async function updateLlmModel(id: string, patch: Partial<{
  is_active: boolean;
  is_default: boolean;
  display_name: string;
  max_tokens: number | null;
}>): Promise<{ error: string | null }> {
  const res = await fetch(`/api/admin/llm/models/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    const { error } = await res.json().catch(() => ({ error: '요청 실패' }));
    return { error };
  }
  return { error: null };
}

export async function deleteLlmModel(id: string): Promise<{ error: string | null }> {
  const res = await fetch(`/api/admin/llm/models/${id}`, { method: 'DELETE' });
  if (!res.ok) {
    const { error } = await res.json().catch(() => ({ error: '요청 실패' }));
    return { error };
  }
  return { error: null };
}

// ── 알림 모니터링 ─────────────────────────────────────────────────────────────

export interface NotificationsKpi {
  total_24h: number;
  total_7d: number;
  pending: number;
  stuck: number;
  webhook_set_users: number;
  total_users: number;
  last_dispatch_at: string | null;
}

export interface NotificationRow {
  id: string;
  user_id: string;
  user_label: string;
  event_type: string;
  title: string;
  sent_to_teams_at: string | null;
  sent_to_telegram_at: string | null;
  created_at: string;
}

export interface EventTypeDistribution {
  event_type: string;
  count_24h: number;
  count_7d: number;
}

export interface UserWebhookStatus {
  user_id: string;
  display_name: string | null;
  email: string;
  team: string | null;
  has_teams_webhook: boolean;
  has_telegram_chat_id: boolean;
  active_subscriptions: number;
}

export async function fetchNotificationsKpi(): Promise<NotificationsKpi | null> {
  const res = await fetch('/api/admin/notifications/kpi');
  if (!res.ok) return null;
  return res.json();
}

export async function fetchRecentNotifications(limit = 50): Promise<NotificationRow[]> {
  const res = await fetch(`/api/admin/notifications/recent?limit=${limit}`);
  if (!res.ok) return [];
  const { notifications } = await res.json();
  return notifications ?? [];
}

export async function fetchEventTypeDistribution(): Promise<EventTypeDistribution[]> {
  const res = await fetch('/api/admin/notifications/distribution');
  if (!res.ok) return [];
  const { distribution } = await res.json();
  return distribution ?? [];
}

export async function fetchUserWebhookStatus(): Promise<UserWebhookStatus[]> {
  const res = await fetch('/api/admin/notifications/users');
  if (!res.ok) return [];
  const { users } = await res.json();
  return users ?? [];
}

// ── 종합 대시보드 ──────────────────────────────────────────────────────────────

export interface DashboardKpi {
  users: {
    total: number;
    active_7d: number;
    blocked: number;
    ai_tokens_this_month: number;
  };
  jobs: {
    total_today: number;
    success_today: number;
    error_today: number;
    avg_duration_7d_sec: number | null;
  };
  notifications: {
    total_24h: number;
    pending: number;
    stuck: number;
    last_dispatch_at: string | null;
  };
  data: {
    total_companies: number;
    unmapped_companies: number;
    total_brands: number;
    total_products: number;
    high_anomalies_unread: number;
  };
}

export interface DashboardActivity {
  type: 'anomaly' | 'signup' | 'job_error';
  occurred_at: string;
  label: string;
  link?: string;
}

export async function fetchDashboardKpi(): Promise<DashboardKpi | null> {
  const res = await fetch('/api/admin/dashboard/kpi');
  if (!res.ok) return null;
  return res.json();
}

export async function fetchDashboardActivity(): Promise<DashboardActivity[]> {
  const res = await fetch('/api/admin/dashboard/activity');
  if (!res.ok) return [];
  const { activity } = await res.json();
  return activity ?? [];
}

// ── 이상탐지 룰 관리 ──────────────────────────────────────────────────────────

export type RuleModule   = 'product_planning' | 'brand_planning' | 'cs' | 'custom';
export type RuleSeverity = 'high' | 'medium' | 'low';

export interface DetectorRule {
  id: string;
  detector_key: string;
  label: string;
  module: RuleModule;
  severity: RuleSeverity;
  enabled: boolean;
  params: Record<string, unknown>;
  description: string | null;
  updated_at: string;
  updated_by: string | null;
}

export async function fetchDetectorRules(): Promise<DetectorRule[]> {
  const res = await fetch('/api/admin/anomalies/rules');
  if (!res.ok) return [];
  const { rules } = await res.json();
  return rules ?? [];
}

export async function updateDetectorRule(
  id: string,
  patch: Partial<Pick<DetectorRule, 'enabled' | 'severity' | 'label' | 'description' | 'params'>>,
): Promise<{ error: string | null }> {
  const res = await fetch(`/api/admin/anomalies/rules/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    const { error } = await res.json().catch(() => ({ error: '요청 실패' }));
    return { error };
  }
  return { error: null };
}

export async function createDetectorRule(input: {
  detector_key: string;
  label: string;
  severity: RuleSeverity;
  params: Record<string, unknown>;
  description?: string;
}): Promise<{ rule: DetectorRule | null; error: string | null }> {
  const res = await fetch('/api/admin/anomalies/rules', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...input, module: 'custom' }),
  });
  if (!res.ok) {
    const { error } = await res.json().catch(() => ({ error: '요청 실패' }));
    return { rule: null, error };
  }
  const { rule } = await res.json();
  return { rule, error: null };
}

export async function deleteDetectorRule(id: string): Promise<{ error: string | null }> {
  const res = await fetch(`/api/admin/anomalies/rules/${id}`, { method: 'DELETE' });
  if (!res.ok) {
    const { error } = await res.json().catch(() => ({ error: '요청 실패' }));
    return { error };
  }
  return { error: null };
}
