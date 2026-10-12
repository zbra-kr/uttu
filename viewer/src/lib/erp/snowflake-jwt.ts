import 'server-only';
import { KeyObject, constants, createHash, createPublicKey, sign } from 'node:crypto';

export interface SnowflakeJwtInputs {
  privateKey: KeyObject;
  // Trusted authentication identity, separately supplied from the REST origin.
  accountIdentifier: string;
  userName: string;
}
export type SnowflakeJwtSupplier = (signal: AbortSignal) => Promise<string>;
const LIFETIME_SECONDS = 59; // Same short lifetime as pinned EIS709c1a7.

// No key parsing/loading, environment access, token cache, logging or network.
// The host owns the already supplied key object's lifecycle and access scope.
export function createSnowflakeJwtSupplier(inputs: SnowflakeJwtInputs, now: () => number = Date.now): SnowflakeJwtSupplier {
  let privateKey: KeyObject, qualifiedUser: string, fingerprint: string;
  try {
    privateKey = inputs.privateKey;
    const account = inputs.accountIdentifier, user = inputs.userName;
    if (!(privateKey instanceof KeyObject) || privateKey.type !== 'private' || privateKey.asymmetricKeyType !== 'rsa' ||
        typeof privateKey.asymmetricKeyDetails?.modulusLength !== 'number' || privateKey.asymmetricKeyDetails.modulusLength < 2048 ||
        typeof account !== 'string' || account.length > 128 || !/^[A-Za-z0-9_]+(?:[-.][A-Za-z0-9_]+)*$/.test(account) ||
        /\.snowflakecomputing\.com$/i.test(account) || typeof user !== 'string' ||
        !/^[A-Za-z_][A-Za-z0-9_$]{0,127}$/.test(user) || typeof now !== 'function') throw new Error();
    // Preserve trusted account components; no host parsing/region guessing.
    qualifiedUser = `${account.toUpperCase()}.${user.toUpperCase()}`;
    const publicDer = createPublicKey(privateKey).export({ type:'spki', format:'der' });
    fingerprint = 'SHA256:' + createHash('sha256').update(publicDer).digest('base64');
  } catch { throw new Error('SNOWFLAKE_JWT_INPUT_INVALID'); }
  return async (signal: AbortSignal) => {
    let failureCode = 'SNOWFLAKE_JWT_SIGN_FAILED';
    const fail = (code: string): never => { failureCode = code; throw new Error(code); };
    try {
      if (!(signal instanceof AbortSignal)) fail('SNOWFLAKE_JWT_SIGNAL_INVALID');
      if (signal.aborted) fail('SNOWFLAKE_JWT_CANCELLED');
      const milliseconds = now();
      if (!Number.isSafeInteger(milliseconds) || milliseconds < 0) fail('SNOWFLAKE_JWT_CLOCK_INVALID');
      const issued = Math.floor(milliseconds / 1000);
      const header = Buffer.from(JSON.stringify({ alg:'RS256', typ:'JWT' })).toString('base64url');
      const payload = Buffer.from(JSON.stringify({ iss:`${qualifiedUser}.${fingerprint}`, sub:qualifiedUser,
        iat:issued, exp:issued + LIFETIME_SECONDS })).toString('base64url');
      if (signal.aborted) fail('SNOWFLAKE_JWT_CANCELLED');
      const message = `${header}.${payload}`;
      const signature = sign('sha256', Buffer.from(message), { key:privateKey, padding:constants.RSA_PKCS1_PADDING }).toString('base64url');
      if (signal.aborted) fail('SNOWFLAKE_JWT_CANCELLED');
      return `${message}.${signature}`;
    } catch {
      // Classify only guards owned by this call. Never inspect an unknown
      // thrown object's message/prototype/getters when redacting failures.
      throw new Error(failureCode);
    }
  };
}
