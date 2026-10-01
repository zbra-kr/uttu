'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { safeTeamsSetupNext } from '@/lib/teams/setup-navigation';
import styles from './teams-setup.module.css';

interface Props {
  nextPath: string;
  reason: string;
  canConnect: boolean;
  initialError: boolean;
  attempted: boolean;
}

const OAUTH_FAILURE = 'Teams 연결을 완료하지 못했습니다. UTTU에 로그인한 회사 Microsoft 계정으로 다시 연결해 주세요. 계정 확인이나 MFA가 표시되면 Microsoft 화면에서 완료해 주세요.';
const REQUEST_FAILURE = '연결 요청을 완료하지 못했습니다. 잠시 후 다시 연결해 주세요. 계속되면 IT팀에 문의해 주세요.';

/** Only a validated Microsoft destination may leave this setup screen. */
export function microsoftConnectionUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.hostname !== 'login.microsoftonline.com'
      || url.username || url.password || url.port
      || !/^\/[a-z0-9-]+\/oauth2\/v2\.0\/authorize$/i.test(url.pathname)) return null;
    return url.toString();
  } catch { return null; }
}

export default function TeamsSetupClient({ nextPath, reason, canConnect, initialError, attempted }: Props) {
  const [busy, setBusy] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [message, setMessage] = useState(initialError ? OAUTH_FAILURE : '');
  const started = useRef(false);
  const connecting = useRef(false);
  const leaving = useRef(false);
  const request = useRef<AbortController | null>(null);
  const safeNext = safeTeamsSetupNext(nextPath);
  const eligible = reason === 'setup_required' || reason === 'reconnect_required';

  const markAttempted = useCallback(() => {
    const current = new URL(window.location.href);
    current.searchParams.set('attempted', '1');
    // Replace, rather than push, so Back or Refresh cannot silently restart
    // an interrupted/cancelled OAuth attempt. Explicit Retry remains available.
    window.history.replaceState(window.history.state, '', `${current.pathname}${current.search}${current.hash}`);
  }, []);

  const connect = useCallback(async () => {
    if (!canConnect || !eligible || connecting.current || leaving.current) return;
    connecting.current = true;
    setBusy(true);
    setMessage('');
    const controller = new AbortController();
    request.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), 15_000);
    try {
      markAttempted();
      const response = await fetch('/api/me/teams/connection', {
        method: 'POST', credentials: 'same-origin', cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'connect', return_to: safeNext }),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error('Connection unavailable');
      const result: unknown = await response.json();
      const url = microsoftConnectionUrl(result && typeof result === 'object' && 'url' in result ? result.url : null);
      if (!url) throw new Error('Invalid connection destination');
      if (!leaving.current && !controller.signal.aborted) window.location.assign(url);
    } catch {
      if (!leaving.current) setMessage(REQUEST_FAILURE);
    } finally {
      window.clearTimeout(timeout);
      if (request.current === controller) request.current = null;
      connecting.current = false;
      if (!leaving.current) setBusy(false);
    }
  }, [canConnect, eligible, markAttempted, safeNext]);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    // Read the live marker too: it is updated before navigation and survives
    // remounts, browser history restoration and refresh without localStorage.
    if (canConnect && eligible && !initialError && !attempted
      && !new URL(window.location.href).searchParams.has('attempted')) void connect();
  }, [attempted, canConnect, connect, eligible, initialError]);

  const signOut = async () => {
    if (leaving.current) return;
    leaving.current = true;
    request.current?.abort();
    setSigningOut(true);
    setMessage('');
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await fetch('/api/auth/local-signout', {
        method: 'POST', credentials: 'same-origin', cache: 'no-store',
        headers: { 'Content-Type': 'application/json' }, body: '{}', signal: controller.signal,
      });
      if (!response.ok) throw new Error('Sign out failed');
      const result: unknown = await response.json();
      if (!result || typeof result !== 'object' || !('url' in result) || result.url !== '/login') {
        throw new Error('Invalid sign out destination');
      }
      window.location.replace('/login');
    } catch {
      leaving.current = false;
      setSigningOut(false);
      setBusy(false);
      setMessage('로그아웃을 완료하지 못했습니다. 다시 눌러 주세요.');
    } finally { window.clearTimeout(timeout); }
  };

  const refreshStatus = () => {
    try { markAttempted(); window.location.reload(); }
    catch { setMessage('상태를 새로 확인하지 못했습니다. 이 페이지를 새로고침해 주세요.'); }
  };

  return (
    <main className={styles.page}>
      <div className={styles.container}>
        <header className={styles.brand} aria-label="UTTU 계정 연결">
          <span className={styles.wordmark}>UTTU</span><span>계정 연결</span>
        </header>
        <section className={styles.card} aria-labelledby="teams-setup-title">
          <p className={styles.step}>로그인 완료 · Teams 연결</p>
          <h1 id="teams-setup-title">Teams 연결을 마무리해 주세요</h1>
          <p className={styles.intro}>Teams 연결을 완료하면 UTTU를 사용할 수 있어요.</p>
          <div className={styles.explanation}>
            <p>멘션 메모를 제출할 때 선택한 사람에게 내 회사 Microsoft 계정 명의로 1:1 메시지를 보낼 수 있습니다.</p>
            <p>메시지에는 메모 내용과 UTTU 링크가 포함되며 Teams에 별도로 남습니다. 연결을 유지하기 위한 정보는 서버에 암호화해 보관합니다.</p>
            <p>연결만으로 메시지가 발송되지는 않습니다.</p>
          </div>

          {reason === 'identity_required' ? (
            <p className={styles.notice}>현재 로그인에서 회사 Microsoft 계정을 확인하지 못했습니다. 로그아웃한 뒤 회사 Microsoft 계정으로 다시 로그인해 주세요.</p>
          ) : !canConnect || reason === 'unavailable' ? (
            <p className={styles.notice}>Teams 연결 설정이나 상태를 확인하지 못했습니다. 다시 확인해도 같으면 IT팀에 문의해 주세요.</p>
          ) : (
            <p className={styles.notice}>UTTU에 로그인한 것과 같은 회사 계정을 선택해 주세요. Microsoft에서 계정 확인이나 MFA를 요청할 수 있습니다.</p>
          )}

          {message && <p className={styles.error} role="alert">{message}</p>}
          <div className={styles.actions}>
            {canConnect && eligible ? (
              <button className={styles.primary} type="button" disabled={busy || signingOut}
                aria-busy={busy} onClick={() => void connect()}>
                {busy ? 'Microsoft로 이동 중…' : initialError || attempted || message || reason === 'reconnect_required'
                  ? 'Microsoft Teams 다시 연결' : 'Microsoft Teams 연결 계속하기'}
              </button>
            ) : reason !== 'identity_required' && (
              <button className={styles.primary} type="button" disabled={signingOut} onClick={refreshStatus}>연결 상태 다시 확인</button>
            )}
            <button className={styles.secondary} type="button" disabled={signingOut}
              aria-busy={signingOut} onClick={() => void signOut()}>
              {signingOut ? '로그아웃 중…' : '로그아웃하고 다시 로그인'}
            </button>
          </div>
          <p className={styles.footer} role="status" aria-live="polite">
            {busy ? 'Microsoft 화면으로 이동합니다. 이 화면에 머물러 있으면 다시 연결해 주세요.' : '연결이 완료되면 원래 보려던 화면으로 돌아갑니다.'}
          </p>
          <noscript><p className={styles.notice}>연결을 계속하려면 브라우저에서 JavaScript를 켠 뒤 새로고침해 주세요.</p></noscript>
        </section>
      </div>
    </main>
  );
}
