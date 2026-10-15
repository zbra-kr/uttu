export type ReviewStatsReadPath = 'legacy-counts' | 'aggregate-rpc';
// Default remains PR26's existing reader while the optional RPC is uninstalled/unverified.
// A future aggregate selection requires separate exact routine/ACL acceptance and source review.
// No environment key, cookie, URL, caller argument, probe or automatic fallback enables it.
export function reviewStatsReadPath(): ReviewStatsReadPath {
  return 'legacy-counts';
}
