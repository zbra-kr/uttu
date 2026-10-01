export type Channel = "teams" | "telegram";
export interface Claim {
  notification_id: string;
  channel: Channel;
  claim_id: string;
}
export interface Delivery {
  notificationId: string;
  channel: Channel;
  claimId: string;
  title: string;
  body: string | null;
  link: string | null;
  target: string;
}
export interface Outcome {
  status: "accepted" | "failed" | "unknown";
  errorCode?: string;
  messageId?: string;
  retryAfter?: string;
}
export interface Config {
  enabled: boolean;
  invocationSecret: string;
  supabaseUrl: string;
  serviceKey: string;
  telegramToken: string;
  teamsHosts: string[];
  appOrigin: string;
}
export type Rpc = <T>(
  name: string,
  args: Record<string, unknown>,
) => Promise<T>;
export interface Dependencies {
  rpc: Rpc;
  fetch: typeof fetch;
  now: () => number;
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_RESPONSE_BYTES = 65_536;
const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};
const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);

export function readConfig(env: (name: string) => string | undefined): Config {
  let serviceKey = env("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!serviceKey) {
    try {
      const keys = JSON.parse(env("SUPABASE_SECRET_KEYS") || "{}");
      serviceKey = typeof keys.default === "string" ? keys.default : "";
    } catch { /* fail closed */ }
  }
  const hosts = (env("NOTIFICATION_TEAMS_ALLOWED_HOSTS") || "").split(",").map(
    (s) => s.trim().toLowerCase(),
  ).filter(Boolean);
  return {
    enabled: env("NOTIFICATION_DISPATCH_ENABLED") === "true",
    invocationSecret: env("NOTIFICATION_DISPATCH_SECRET") || "",
    supabaseUrl: env("SUPABASE_URL") || "",
    serviceKey,
    telegramToken:
      /^[0-9]+:[A-Za-z0-9_-]{20,}$/.test(env("TELEGRAM_BOT_TOKEN") || "")
        ? env("TELEGRAM_BOT_TOKEN")!
        : "",
    teamsHosts: [
      ...new Set(
        hosts.filter((h) =>
          /^[a-z0-9][a-z0-9.-]*[a-z0-9]$/.test(h) && h.includes(".") &&
          !/^\d+(\.\d+){3}$/.test(h) && !h.endsWith(".local") &&
          !h.endsWith(".internal")
        ),
      ),
    ],
    appOrigin: "https://uttu.bcave.ai",
  };
}

export async function authorized(
  header: string | null,
  secret: string,
): Promise<boolean> {
  if (
    secret.length < 32 || secret.length > 4096 || !header ||
    header.length > 4096
  ) return false;
  const digest = async (s: string) =>
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)),
    );
  const [left, right] = await Promise.all([digest(header), digest(secret)]);
  let difference = 0;
  for (let i = 0; i < left.length; i++) difference |= left[i] ^ right[i];
  return difference === 0;
}

export function safeLink(link: string | null, origin: string): string | null {
  if (
    !link || !link.startsWith("/") || link.startsWith("//") ||
    Array.from(link).some((character) => {
      const code = character.charCodeAt(0);
      return code <= 32 || code === 127 || code === 92;
    })
  ) return null;
  try {
    const url = new URL(link, origin);
    return url.origin === origin ? url.toString() : null;
  } catch {
    return null;
  }
}

export function teamsTarget(value: string, hosts: string[]): string | null {
  if (value.length > 8192) return null;
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" || url.username || url.password || url.hash ||
      (url.port && url.port !== "443") ||
      !hosts.includes(url.hostname.toLowerCase())
    ) return null;
    return url.toString();
  } catch {
    return null;
  }
}

async function responseText(response: Response): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new Error("Response too large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return new TextDecoder().decode(bytes);
}

function retryAfter(response: Response, now: number): string | undefined {
  const raw = response.headers.get("retry-after");
  if (!raw) return undefined;
  const seconds = /^\d+$/.test(raw)
    ? Number(raw)
    : (Date.parse(raw) - now) / 1000;
  return Number.isFinite(seconds) && seconds >= 0
    ? new Date(now + Math.min(seconds, 86400) * 1000).toISOString()
    : undefined;
}

export async function deliver(
  item: Delivery,
  config: Config,
  dependencies: Pick<Dependencies, "fetch" | "now">,
): Promise<Outcome> {
  const title = typeof item.title === "string" ? item.title.slice(0, 512) : "";
  const body = typeof item.body === "string" ? item.body.slice(0, 4000) : "";
  const link = safeLink(item.link, config.appOrigin);
  let url: string;
  let payload: unknown;
  if (item.channel === "teams") {
    const target = teamsTarget(item.target, config.teamsHosts);
    if (!target) return { status: "failed", errorCode: "target_not_allowed" };
    url = target;
    const blocks: unknown[] = [{
      type: "TextBlock",
      text: title,
      weight: "Bolder",
      size: "Medium",
      wrap: true,
    }];
    if (body) {
      blocks.push({
        type: "TextBlock",
        text: body,
        wrap: true,
        spacing: "Small",
      });
    }
    if (link) {
      blocks.push({
        type: "ActionSet",
        actions: [{ type: "Action.OpenUrl", title: "열기", url: link }],
      });
    }
    payload = {
      type: "AdaptiveCard",
      $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
      version: "1.4",
      body: blocks,
    };
  } else if (item.channel === "telegram") {
    if (
      !config.telegramToken || /[\s/\r\n]/.test(config.telegramToken) ||
      !/^(?:-?\d+|@[a-zA-Z0-9_]{5,32})$/.test(item.target)
    ) return { status: "failed", errorCode: "telegram_configuration_invalid" };
    url = `https://api.telegram.org/bot${config.telegramToken}/sendMessage`;
    let text = `<b>${escapeHtml(title)}</b>`;
    if (body) text += `\n\n${escapeHtml(body)}`;
    if (link) text += `\n\n<a href="${escapeHtml(link)}">열기</a>`;
    // Telegram's 4096-character limit applies after entity parsing. Keep a
    // conservative plain-text budget so escaping/markup never cuts an entity.
    if (title.length + body.length + (link ? 4 : 0) > 4000) {
      return { status: "failed", errorCode: "message_too_long" };
    }
    payload = {
      chat_id: item.target,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
    };
  } else return { status: "failed", errorCode: "invalid_channel" };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await dependencies.fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      redirect: "error",
      signal: controller.signal,
    });
    if (item.channel === "teams" || !response.ok) {
      try {
        await response.body?.cancel();
      } catch { /* discard body without logging */ }
    }
    if (response.status === 429) {
      return {
        status: "failed",
        errorCode: "provider_rate_limited",
        retryAfter: retryAfter(response, dependencies.now()),
      };
    }
    if (response.status >= 500 || response.status === 408) {
      return { status: "unknown", errorCode: "provider_outcome_unknown" };
    }
    if (!response.ok) {
      return { status: "failed", errorCode: "provider_rejected" };
    }
    if (item.channel === "teams") return { status: "accepted" }; // HTTP acceptance, not proof of delivery/read.
    let value: unknown;
    try {
      value = JSON.parse(await responseText(response));
    } catch {
      return { status: "unknown", errorCode: "response_unreadable" };
    }
    const result = value as { ok?: boolean; result?: { message_id?: unknown } };
    if (result?.ok === false) {
      return { status: "failed", errorCode: "provider_rejected" };
    }
    const messageId = result?.result?.message_id;
    if (
      result?.ok !== true ||
      !(typeof messageId === "number" && Number.isSafeInteger(messageId) &&
        messageId >= 0)
    ) return { status: "unknown", errorCode: "acceptance_unconfirmed" };
    return { status: "accepted", messageId: String(messageId) };
  } catch {
    return { status: "unknown", errorCode: "network_outcome_unknown" };
  } finally {
    clearTimeout(timeout);
  }
}

export async function runBatch(config: Config, dependencies: Dependencies) {
  const channels: Channel[] = [];
  if (config.teamsHosts.length) channels.push("teams");
  if (config.telegramToken) channels.push("telegram");
  const result = {
    claimed: 0,
    accepted: 0,
    skipped: 0,
    failed: 0,
    unknown: 0,
    deferred: 0,
    configurationBlocked: 2 - channels.length,
  };
  if (!channels.length) return result;
  const claims = await dependencies.rpc<Claim[]>("uttu_dispatch_claim", {
    p_channels: channels,
    p_limit: 20,
  });
  if (
    !Array.isArray(claims) || claims.length > 20 ||
    claims.some((c) =>
      !UUID.test(c.notification_id) || !UUID.test(c.claim_id) ||
      !channels.includes(c.channel)
    )
  ) throw new Error("Invalid dispatch claims");
  result.claimed = claims.length;
  const deadline = dependencies.now() + 60_000;
  let cursor = 0;
  const work = async () => {
    while (cursor < claims.length) {
      const claim = claims[cursor++];
      const args = {
        p_notification_id: claim.notification_id,
        p_channel: claim.channel,
        p_claim_id: claim.claim_id,
      };
      if (dependencies.now() >= deadline) {
        try {
          await dependencies.rpc("uttu_dispatch_release", args);
        } catch { /* Lease expiry safely reclaims an unattempted row. */ }
        result.deferred++;
        continue;
      }
      let item: Delivery | null;
      try {
        item = await dependencies.rpc<Delivery | null>(
          "uttu_dispatch_begin",
          args,
        );
      } catch {
        result.unknown++;
        continue;
      } // Ambiguous DB response: never send without confirmed begin.
      if (!item) {
        result.skipped++;
        continue;
      }
      if (
        item.notificationId !== claim.notification_id ||
        item.channel !== claim.channel || item.claimId !== claim.claim_id ||
        typeof item.target !== "string"
      ) {
        result.unknown++;
        continue;
      }
      const outcome = await deliver(item, config, dependencies);
      try {
        const saved = await dependencies.rpc<boolean>("uttu_dispatch_finish", {
          ...args,
          p_status: outcome.status,
          p_error_code: outcome.errorCode ?? null,
          p_provider_message_id: outcome.messageId ?? null,
          p_retry_after: outcome.retryAfter ?? null,
        });
        if (!saved) {
          result.unknown++;
          continue;
        }
        result[outcome.status]++;
      } catch {
        result.unknown++;
      } // No second provider attempt after uncertain persistence.
    }
  };
  await Promise.all(Array.from({ length: Math.min(3, claims.length) }, work));
  return result;
}

export function makeRpc(config: Config, fetcher: typeof fetch): Rpc {
  return async <T>(name: string, args: Record<string, unknown>): Promise<T> => {
    const response = await fetcher(
      new URL(`/rest/v1/rpc/${name}`, config.supabaseUrl),
      {
        method: "POST",
        headers: {
          apikey: config.serviceKey,
          authorization: `Bearer ${config.serviceKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(args),
        redirect: "error",
        signal: AbortSignal.timeout(5000),
      },
    );
    if (!response.ok) throw new Error("Dispatch database unavailable");
    return JSON.parse(await responseText(response)) as T;
  };
}

export function createHandler(config: Config, injected?: Dependencies) {
  return async (request: Request): Promise<Response> => {
    const json = (body: unknown, status = 200) =>
      Response.json(body, { status, headers: { "cache-control": "no-store" } });
    if (request.method !== "POST") {
      return json({ error: "method_not_allowed" }, 405);
    }
    if (
      !await authorized(
        request.headers.get("x-dispatch-secret"),
        config.invocationSecret,
      )
    ) return json({ error: "unauthorized" }, 401);
    if (!config.enabled) return json({ enabled: false });
    if (
      !config.serviceKey ||
      !/^https:\/\/ogtrvberttzupxrffpoh\.supabase\.co\/?$/.test(
        config.supabaseUrl,
      )
    ) return json({ error: "configuration_missing" }, 503);
    try {
      const dependencies = injected ??
        { rpc: makeRpc(config, fetch), fetch, now: Date.now };
      const result = await runBatch(config, dependencies);
      return json(
        { enabled: true, ...result },
        result.configurationBlocked === 2 ? 503 : 200,
      );
    } catch {
      return json({ error: "dispatch_unavailable" }, 503);
    }
  };
}
