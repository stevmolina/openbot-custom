/** Shared error labels for the optional deployment-wide WorkOS account provider. */
export const WEB_APP_WORKOS_SIGN_IN_ERROR_PARAM = "workosSignInError";
const WORKOS_ERROR_KEYS = {
  cancelled: "error.auth.workosSignInCancelled",
  timeout: "error.auth.workosSignInTimeout",
  listener_failed: "error.auth.workosSignInUnavailable",
  browser_failed: "error.auth.workosSignInUnavailable",
  workos_provider_refused: "error.auth.workosSignInRefused",
  workos_email_missing: "error.auth.workosSignInEmailMissing",
  workos_sign_in_not_configured: "error.auth.workosSignInUnavailable",
  workos_provider_rejected: "error.auth.workosSignInProviderRejected",
  workos_token_invalid: "error.auth.workosSignInTokenInvalid",
  workos_provider_unreachable: "error.auth.workosSignInProviderUnreachable",
  workos_sign_in_required: "error.auth.workosSignInRequired",
} as const;
type WorkosErrorKey = (typeof WORKOS_ERROR_KEYS)[keyof typeof WORKOS_ERROR_KEYS] | "error.auth.workosSignInFailed";
const errorKeys = new Map<string, WorkosErrorKey>(Object.entries(WORKOS_ERROR_KEYS));
export function workosSignInErrorKey(code: string): WorkosErrorKey {
  return errorKeys.get(code) ?? "error.auth.workosSignInFailed";
}
