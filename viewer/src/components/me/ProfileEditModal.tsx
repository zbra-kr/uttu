'use client';
import React from 'react';
import { MyProfile, updateMyProfile } from '@/lib/queries-me';

interface Props {
  profile: MyProfile;
  onClose: () => void;
  onSaved: (patch: Partial<MyProfile>) => void;
}

export default function ProfileEditModal({ profile, onClose, onSaved }: Props) {
  const [form, setForm] = React.useState({
    full_name: profile.full_name ?? '',
    display_name: profile.display_name ?? '',
    team: profile.team ?? '',
    teams_webhook_url: profile.teams_webhook_url ?? '',
    telegram_chat_id: profile.telegram_chat_id ?? '',
  });
  const [saving, setSaving] = React.useState(false);
  const [fieldError, setFieldError] = React.useState<string | null>(null);

  const isAdmin = profile.role === 'admin';

  const handleSave = async () => {
    setSaving(true);
    setFieldError(null);
    const patch: Parameters<typeof updateMyProfile>[0] = {
      full_name: form.full_name || null,
      display_name: form.display_name || null,
      team: form.team || null,
      teams_webhook_url: form.teams_webhook_url || null,
    };
    if (isAdmin) {
      patch.telegram_chat_id = form.telegram_chat_id || null;
    }
    const { error } = await updateMyProfile(patch);
    setSaving(false);
    if (error) {
      if (error.includes('23505') || error.includes('profiles_display_name_uq')) {
        setFieldError('이미 사용 중인 표시명입니다.');
      } else {
        setFieldError(error);
      }
      return;
    }
    onSaved(patch);
  };

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 500, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="panel" style={{ width: 440, padding: 24, background: 'var(--bg)', maxHeight: '90vh', overflowY: 'auto' }}>
        <h3 style={{ margin: '0 0 20px', fontSize: 15, fontWeight: 500 }}>프로필 편집</h3>

        <div className="col-flex gap-14">
          <label>
            <span className="field-lbl">이름</span>
            <input
              className="input"
              value={form.full_name}
              onChange={e => setForm(f => ({ ...f, full_name: e.target.value }))}
              placeholder="홍길동"
            />
          </label>

          <label>
            <span className="field-lbl">표시명 <span style={{ textTransform: 'none', letterSpacing: 0, color: 'var(--f4)', fontSize: 10 }}>(멘션용 @태그)</span></span>
            <input
              className="input"
              value={form.display_name}
              onChange={e => setForm(f => ({ ...f, display_name: e.target.value }))}
              placeholder="홍길동"
            />
          </label>

          <label>
            <span className="field-lbl">팀</span>
            <input
              className="input"
              value={form.team}
              onChange={e => setForm(f => ({ ...f, team: e.target.value }))}
              placeholder="IT팀"
            />
          </label>

          <label>
            <span className="field-lbl">Teams Webhook URL</span>
            <input
              className="input mono"
              value={form.teams_webhook_url}
              onChange={e => setForm(f => ({ ...f, teams_webhook_url: e.target.value }))}
              placeholder="https://..."
            />
          </label>

          {isAdmin && (
            <label>
              <span className="field-lbl">Telegram Chat ID <span style={{ textTransform: 'none', letterSpacing: 0, color: 'var(--f4)', fontSize: 10 }}>(admin 전용)</span></span>
              <input
                className="input mono"
                value={form.telegram_chat_id}
                onChange={e => setForm(f => ({ ...f, telegram_chat_id: e.target.value }))}
                placeholder="123456789"
              />
            </label>
          )}
        </div>

        {fieldError && (
          <div style={{ marginTop: 12, fontSize: 12, color: 'var(--shf)' }}>{fieldError}</div>
        )}

        <div className="row-flex gap-8" style={{ marginTop: 20, justifyContent: 'flex-end' }}>
          <button className="btn sm" onClick={onClose} disabled={saving}>취소</button>
          <button className="btn sm" onClick={handleSave} disabled={saving}
            style={{ background: 'var(--hs)', color: '#fff', borderColor: 'var(--hs)' }}>
            {saving ? '저장 중…' : '저장'}
          </button>
        </div>
      </div>
    </div>
  );
}
