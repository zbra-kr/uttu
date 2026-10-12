import 'server-only';
import type { RequesterRestBinding } from './requester-sales-rest';
import { bindingFromExistingEnvironment } from './existing-node-binding';

// Actual page composition. Missing/invalid server-owned dependencies stay null.
// No secret provisioning or request/user-role fallback occurs here.
export function configuredCentralRequesterBinding(): RequesterRestBinding | null {
  return bindingFromExistingEnvironment(process.env);
}
