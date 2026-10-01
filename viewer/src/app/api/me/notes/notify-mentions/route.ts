import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';
import { isSameOriginPost, teamsConfig } from '@/lib/teams/config';
import { isUuid, microsoftIdentity } from '@/lib/teams/identity';
import { getTeamsAuthorGrant } from '@/lib/teams/oauth';
import { sendAuthorMention, type MentionSendResult } from '@/lib/teams/graph';

export const runtime = 'nodejs';
export const maxDuration = 300;
const json = (body: unknown, status = 200) => NextResponse.json(body, {
  status, headers: { 'Cache-Control': 'no-store' },
});

interface Delivery {
  id: string; recipient_id: string; body_snapshot: string; link_snapshot: string;
  recipient_tenant_id: string; recipient_object_id: string; status: string;
}

export async function POST(request: NextRequest) {
  // Use a deployment-owned origin even when Teams has not been enabled.
  let origin: string;
  try {
    origin = new URL(process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_SITE_URL || '').origin;
  } catch { return json({ error: '알림 주소가 설정되지 않았습니다.' }, 503); }
  if (!isSameOriginPost(request, origin)) return json({ error: '잘못된 요청' }, 403);

  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return json({ error: '인증 필요' }, 401);

  let input: { note_id?: unknown; send_teams?: unknown; expected_body?: unknown; recipient_ids?: unknown };
  try { input = await request.json(); } catch { return json({ error: '잘못된 요청' }, 400); }
  // Already-open pre-release tabs submit only note_id. Preserve their in-app
  // notification without treating that old request as consent to send a DM.
  const legacyInAppOnly = !!input && Object.keys(input).length === 1
    && Object.prototype.hasOwnProperty.call(input, 'note_id');
  if (!input || !isUuid(input.note_id) || (!legacyInAppOnly
    && (typeof input.expected_body !== 'string' || !Array.isArray(input.recipient_ids)
      || input.recipient_ids.some(id => !isUuid(id))))) {
    return json({ error: '잘못된 요청' }, 400);
  }
  const { data: note, error: noteError } = await sb.from('user_notes')
    .select('id,user_id,body,mentioned_user_ids,created_at').eq('id', input.note_id).single();
  if (noteError || !note || note.user_id !== user.id) return json({ error: '권한 없음' }, 403);
  const targets = [...new Set<string>((note.mentioned_user_ids ?? []).filter((id: string) => id !== user.id))].sort();
  const expectedBody = legacyInAppOnly ? note.body : input.expected_body;
  const requested = legacyInAppOnly ? targets
    : [...new Set<string>((input.recipient_ids as string[]).filter(id => id !== user.id))].sort();
  if (note.body !== expectedBody || JSON.stringify(targets) !== JSON.stringify(requested)) {
    return json({ error: '메모 또는 받는 사람이 변경되었습니다. 다시 확인해 주세요.' }, 409);
  }
  if (targets.length === 0) return json({ inserted: 0, message: '메모를 저장했습니다.' });

  const config = teamsConfig();
  const fresh = Date.now() - Date.parse(note.created_at) <= 5 * 60_000;
  const sendRequested = !legacyInAppOnly && input.send_teams === true && !!config && fresh && targets.length <= 10;
  try {
    const { error: prepareError } = await sb.rpc('uttu_teams_prepare_mentions', {
      p_note_id: note.id, p_author_id: user.id, p_title: null, p_link: null, p_send_requested: sendRequested,
      p_expected_body: expectedBody, p_expected_recipient_ids: requested,
    });
    if (prepareError) throw new Error();
    if (!sendRequested || !config) {
      return json({ message: input.send_teams === true
        ? 'UTTU 멘션 알림을 만들었습니다. Teams 연결 상태·수신 인원·제출 시간을 확인할 수 없어 DM은 보내지 않았습니다.'
        : 'UTTU 멘션 알림을 만들었습니다.' });
    }
    const author = microsoftIdentity(user, config.tenantId);
    let grant = null;
    try { grant = await getTeamsAuthorGrant(sb, user, config); } catch { /* Reconnect, never fall back to a bot. */ }
    for (const recipientId of targets) {
      const claimId = randomUUID();
      const { data, error } = await sb.rpc('uttu_teams_claim_delivery', {
        p_note_id: note.id, p_author_id: user.id, p_recipient_id: recipientId, p_claim_id: claimId,
      });
      if (error) throw new Error();
      const delivery = (Array.isArray(data) ? data[0] : null) as Delivery | null;
      if (!delivery) continue; // Already sent, opted out, unmapped, disconnected or concurrently claimed.
      if (delivery.body_snapshot !== input.expected_body) throw new Error();
      let result: MentionSendResult = { status: 'reconnect_required' };
      let boundaryRejected = false;
      if (author && grant) {
        const link = new URL(`/me/notes/${encodeURIComponent(note.id)}`, config.origin).toString();
        result = await sendAuthorMention({
          enabled: true, authorActionConfirmed: true, deliveryId: delivery.id,
          authenticatedAuthor: author,
          recipient: { userId: recipientId, tenantId: delivery.recipient_tenant_id, objectId: delivery.recipient_object_id },
          grant,
          authorizeMessage: async () => {
            // Chat creation can take time. Recheck disconnect/edits/opt-out only
            // after it returns and immediately before the actual message POST.
            const { data: started, error: startError } = await sb.rpc('uttu_teams_begin_send', {
              p_delivery_id: delivery.id, p_author_id: user.id, p_claim_id: claimId,
            });
            boundaryRejected = !!startError || started !== true;
            return !boundaryRejected;
          },
          text: `[UTTU] 메모에서 회원님을 멘션했습니다.\n\n${delivery.body_snapshot}\n\n${link}`,
        });
      }
      if (boundaryRejected) continue;
      const status = result.status === 'not_sent' ? 'skipped' : result.status;
      const { data: finished, error: finishError } = await sb.rpc('uttu_teams_finish_delivery', {
        p_delivery_id: delivery.id, p_author_id: user.id, p_claim_id: claimId, p_status: status,
        p_error_code: result.status === 'sent' ? null : result.status,
        p_message_id: result.status === 'sent' ? result.messageId : null,
        p_chat_id: result.status === 'sent' ? result.chatId : null,
        p_retry_after: result.status === 'throttled'
          ? new Date(Date.now() + result.retryAfterSeconds * 1000).toISOString() : null,
      });
      // A confirmed Graph send with an unrecorded DB result must not be retried.
      if (finishError || finished !== true) throw new Error();
    }
    const { data: final, error } = await sb.rpc('uttu_teams_get_delivery_status', {
      p_note_id: note.id, p_author_id: user.id,
    });
    if (error || !Array.isArray(final)) throw new Error();
    const sent = final.filter((item: Delivery) => item.status === 'sent').length;
    const unknown = final.filter((item: Delivery) => ['unknown', 'claimed'].includes(item.status)).length;
    const message = unknown > 0
      ? `UTTU 알림을 만들었고 Teams ${sent}건의 전송을 확인했습니다. ${unknown}건은 결과를 확인할 수 없어 자동 재전송하지 않습니다.`
      : sent === targets.length ? `UTTU 알림과 Teams DM ${sent}건을 전송했습니다.`
        : `UTTU 알림을 만들었고 Teams DM ${sent}/${targets.length}건을 전송했습니다. 미전송은 연결·계정 매핑·수신 설정을 확인해 주세요.`;
    return json({ message, sent, unknown });
  } catch {
    return json({ error: '메모는 저장되었지만 알림 전달을 확인하지 못했습니다. 자동 재전송하지 않습니다.' }, 503);
  }
}
