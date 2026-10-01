'use client';
import React from 'react';

export interface TeamsConnectionState { available: boolean; connected: boolean }

export default function TeamsConnection() {
  const [state, setState] = React.useState<TeamsConnectionState | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [message, setMessage] = React.useState('');

  React.useEffect(() => {
    const controller = new AbortController();
    fetch('/api/me/teams/connection', { cache: 'no-store', signal: controller.signal })
      .then(response => response.ok ? response.json() : null).then(setState).catch(() => {});
    const result = new URL(window.location.href).searchParams.get('teams');
    if (result === 'connected') setMessage('Teams에 연결되었습니다.');
    if (result === 'failed') setMessage('Teams 연결을 완료하지 못했습니다. UTTU와 같은 Microsoft 계정으로 다시 연결해 주세요.');
    return () => controller.abort();
  }, []);

  const act = async (action: 'connect' | 'disconnect') => {
    if (busy) return;
    setBusy(true); setMessage('');
    try {
      const response = await fetch('/api/me/teams/connection', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error();
      if (action === 'connect' && typeof result.url === 'string') {
        const url = new URL(result.url);
        if (url.protocol !== 'https:' || url.hostname !== 'login.microsoftonline.com') throw new Error();
        window.location.assign(url.toString());
        return;
      }
      setState({ available: result.available === true, connected: false });
      setMessage('연결을 해제했습니다. 이미 전송을 시작한 메시지는 도착할 수 있습니다.');
    } catch { setMessage('요청을 완료하지 못했습니다. 잠시 후 다시 시도해 주세요.'); }
    setBusy(false);
  };

  if (!state?.available && !state?.connected && !message) return null;
  return (
    <section className="panel" style={{ padding: 16, marginTop: 12 }} aria-label="Teams 멘션 연결">
      <h3 style={{ fontSize: 14, margin: '0 0 8px' }}>Teams 멘션 DM {state?.connected ? '· 연결됨' : ''}</h3>
      <p style={{ fontSize: 12, lineHeight: 1.6, color: 'var(--f3)' }}>
        멘션 메모를 제출할 때 선택한 사람에게 내 Microsoft 계정 명의로 1:1 메시지를 보냅니다.
        메시지에는 메모 내용과 UTTU 링크가 포함되며 Teams에 별도로 남습니다.
        연결을 유지하기 위한 갱신 토큰은 서버에 암호화해 보관합니다.
      </p>
      {(state?.available || state?.connected) && <div style={{ display: 'flex', gap: 8 }}>
        {state.available && <button className="btn sm" disabled={busy} onClick={() => act('connect')}>
          {busy ? '처리 중…' : state.connected ? '다시 연결' : 'Microsoft에서 동의하고 연결'}
        </button>}
        {state.connected && <button className="btn sm" disabled={busy} onClick={() => act('disconnect')}>연결 해제</button>}
      </div>}
      {message && <p role="status" style={{ fontSize: 12, color: 'var(--f3)' }}>{message}</p>}
    </section>
  );
}
