import 'server-only';
import type { RequesterRestBinding } from './requester-sales-rest';

// The sole server composition point for already supplied dependencies. Connect
// the existing trusted requester binding and existing signer here when available.
// No environment/key reader, public setter, request-body fallback or new signer.
// This function is called by the actual review-page server path, not a new API.
export function configuredCentralRequesterBinding(): RequesterRestBinding | null {
  return null;
}
