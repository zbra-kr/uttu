/**
 * Pure/Edge-safe interpretation of the actor-bound setup-status RPC.
 * Both verifiedRole and rpcData MUST come from authenticated server-side
 * database reads. Never pass browser input, user_metadata or JWT role claims.
 */
export type TeamsSetupStatus =
  | 'admin_exempt'
  | 'connected'
  | 'setup_required'
  | 'identity_required'
  | 'reconnect_required';

export type TeamsAccessReason = TeamsSetupStatus | 'disabled' | 'unavailable';

export interface TeamsAccessPolicyInput {
  enabled: boolean;
  verifiedRole?: unknown;
  rpcData?: unknown;
  rpcError?: unknown;
  /** App-side authenticated AES-GCM verification of the server-minted bundle. */
  connectionVerified?: boolean;
}

export interface TeamsAccessDecision {
  allowed: boolean;
  reason: TeamsAccessReason;
}

export function evaluateTeamsAccess({
  enabled, verifiedRole, rpcData, rpcError, connectionVerified,
}: TeamsAccessPolicyInput): TeamsAccessDecision {
  if (enabled !== true) return { allowed: true, reason: 'disabled' };
  // This independent protected-role read prevents an unavailable Teams RPC
  // from locking out an administrator's existing email/password fallback.
  if (verifiedRole === 'admin') return { allowed: true, reason: 'admin_exempt' };
  if (rpcError != null || !rpcData || typeof rpcData !== 'object' || Array.isArray(rpcData)) {
    return { allowed: false, reason: 'unavailable' };
  }
  let status: unknown;
  try {
    if (!Object.prototype.hasOwnProperty.call(rpcData, 'status')) {
      return { allowed: false, reason: 'unavailable' };
    }
    status = (rpcData as Record<string, unknown>).status;
  } catch {
    return { allowed: false, reason: 'unavailable' };
  }
  switch (status) {
    case 'admin_exempt':
      return { allowed: true, reason: status };
    case 'connected':
      return connectionVerified === true
        ? { allowed: true, reason: status }
        : { allowed: false, reason: 'reconnect_required' };
    case 'setup_required':
    case 'identity_required':
    case 'reconnect_required':
      return { allowed: false, reason: status };
    default:
      return { allowed: false, reason: 'unavailable' };
  }
}
