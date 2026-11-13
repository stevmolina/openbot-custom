import { agentTemplateIdFromWebAppSearch, WEB_APP_AGENT_TEMPLATE_PARAM } from "@openbot/contracts/agent-template-links";
import { companySignInErrorKey, WEB_APP_COMPANY_SIGN_IN_ERROR_PARAM } from "@openbot/contracts/company-sign-in";
import { type FirstTouch, readFirstTouch } from "@openbot/contracts/first-touch";
import { inviteUrlFromWebAppSearch, WEB_APP_INVITE_FIELDS } from "@openbot/contracts/invite-links";
import type { AppVariant, CentralAuthState, CentralAuthUser } from "@openbot/contracts/ipc";
import { isAvatarColor } from "@openbot/contracts/ipc-agent-identity";
import {
  type MarketplaceListingLink,
  marketplaceListingFromWebAppSearch,
  WEB_APP_MARKETPLACE_AGENT_PARAM,
  WEB_APP_MARKETPLACE_SKILL_PARAM,
} from "@openbot/contracts/marketplace-links";
import { pluginSlugFromWebAppSearch, WEB_APP_PLUGIN_PARAM } from "@openbot/contracts/plugin-links";
import { isBoolean, isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { WEB_APP_WORKOS_SIGN_IN_ERROR_PARAM, workosSignInErrorKey } from "@openbot/contracts/workos-sign-in";
import { formatLocale, resolveLocale } from "@openbot/i18n";
import { sourceText } from "@openbot/i18n/source";
import { markRemoteSync } from "@openbot/team-client/sync-marks";
import { classifyFailure } from "@openbot/telemetry";
// UI subpaths, not the `@openbot/ui` index: the sign-in screen loads this file, and the index holds
// every control.
import { NotificationObserver } from "@openbot/ui/alert";
import { AccountLogin } from "@openbot/ui/features/account/AccountLogin";
import { AppLoadingScreen } from "@openbot/ui/features/account/AppLoadingScreen";
import { currentText } from "@openbot/ui/text";
import { Toaster, toast } from "@openbot/ui/toast";
import { Dynamic } from "@solidjs/web";
import { createEffect, createSignal, createStore, onSettled, Show } from "solid-js";
import type { DesktopAnalyticsProperties } from "../../analytics";
import {
  configureWebReports,
  reportNotification,
  setWebAccountPending,
  setWebReportsEnabled,
  webAccountPending,
  webKeepsOff,
  webReportsAgreed,
  webReportsEnabled,
} from "../../error-reports";
import { StaticI18nProvider } from "../../i18n-context";
import { AnalyticsConsentRow, ConsentNotice } from "../onboarding/AnalyticsConsent";
import { createOnboardingTeam, onboardingSessionSeed } from "../onboarding/onboarding-avatars";
import { deleteRemoteWorkspaceFrames } from "../servers/remote-workspace-frame-keys";
import { WebLanguageStep } from "./WebLanguageStep";
import { WebServiceWorkerUpdates } from "./WebServiceWorkerUpdates";
import type { WebWorkspace } from "./WebWorkspace";
import { createWebAccountCalls } from "./web-account";
import { deleteSavedAgentPictures } from "./web-agent-pictures";
import { createWebAppearancePreference } from "./web-appearance-preference";
import { takeWebAppStart, WEB_APP_BILLING_PARAM, type WebAppStart } from "./web-billing";
import type { WebRuntimeFactory } from "./web-client-context";
import { takeHostingReturn } from "./web-hosted-servers";
import { createWebLanguagePreference } from "./web-language-preference";
import { retireSignInStyles } from "./web-sign-in-styles";
import { trackVisualViewport } from "./web-visual-viewport";

// The site loads this before it mounts `WebApp` (`apps/auth-api/src/routes/app.lazy.tsx`).
export { loadSavedLanguage } from "./web-language-preference";

/**
 * The workspace is its own chunk, so the sign-in screen does not wait for it. A browser that was
 * signed in starts it beside the session request, and a signed-in account waits for both. A
 * signed-out browser starts it when the user asks for a sign-in code: a phone then reads no
 * workspace code for a visitor who does not sign in. A failed import is tried again on the next call.
 *
 * The full stylesheet loads with it. The sign-in screens need only `web-sign-in.css`, which the
 * route loads, and which turns off when the full one is in.
 */
let workspaceImport: Promise<typeof WebWorkspace> | null = null;
function loadWorkspace(): Promise<typeof WebWorkspace> {
  if (!workspaceImport) {
    workspaceImport = Promise.all([import("./WebWorkspace"), import("./web-client.css")]).then(([module]) => {
      retireSignInStyles();
      return module.WebWorkspace;
    });
    workspaceImport.catch(() => {
      workspaceImport = null;
    });
  }
  return workspaceImport;
}

/** Set while this browser has an account session, so the next visit loads the workspace at once. */
const SIGNED_IN_HINT_KEY = "openbot.web.signedIn";
function readSignedInHint(): boolean {
  try {
    return window.localStorage.getItem(SIGNED_IN_HINT_KEY) === "1";
  } catch {
    return false;
  }
}
function writeSignedInHint(signedIn: boolean): void {
  try {
    if (signedIn) window.localStorage.setItem(SIGNED_IN_HINT_KEY, "1");
    else window.localStorage.removeItem(SIGNED_IN_HINT_KEY);
  } catch {
    // Blocked storage: the workspace loads after the session check.
  }
}

/** A sign-in refusal that the login form already shows. */
class SignInIssueShown extends Error {}

/** The browser has no account session. The sign-in screen is the answer, not a service outage. */
class SessionSignedOut extends Error {}

/** The email signs in with the company's provider, not with an email code. */
class CompanySignInRequired extends Error {
  constructor(readonly provider: "company" | "workos" = "company") {
    super();
  }
}

/**
 * The error code of a company sign-in that came back without a session, from
 * `/app?companySignInError=<code>`. The query is removed after it is read.
 */
function takeCompanySignInError(parameter = WEB_APP_COMPANY_SIGN_IN_ERROR_PARAM): string | null {
  const url = new URL(window.location.href);
  const code = url.searchParams.get(parameter);
  if (code === null) return null;
  url.searchParams.delete(parameter);
  window.history.replaceState(window.history.state, "", url);
  return code;
}

/** The error label of the selected account provider. */

function companySignInIssue(code: string, provider: "company" | "workos" = "company") {
  return {
    code,
    message: sourceText(provider === "workos" ? workosSignInErrorKey(code) : companySignInErrorKey(code)),
  };
}

/**
 * The shared agent a `/app?agent=<id>` link names. The query is removed after it is read, so a reload
 * does not open the preview again.
 */
function takeAgentTemplateLink(): string | null {
  const url = new URL(window.location.href);
  if (!url.searchParams.has(WEB_APP_AGENT_TEMPLATE_PARAM)) return null;
  const id = agentTemplateIdFromWebAppSearch(url.search);
  url.searchParams.delete(WEB_APP_AGENT_TEMPLATE_PARAM);
  window.history.replaceState(window.history.state, "", url);
  return id;
}

/**
 * The invitation a `/app?api=…&server=…&fingerprint=…&invite=…` link names, as the `/join` page
 * passes it on. The fields are removed after they are read, so the secret does not stay in the
 * address bar or the history, and a reload does not open the dialog again.
 */
function takeInviteLink(): string | null {
  const url = new URL(window.location.href);
  if (!WEB_APP_INVITE_FIELDS.some((field) => url.searchParams.has(field))) return null;
  const inviteUrl = inviteUrlFromWebAppSearch(url.search, { allowLocalDevelopmentApiUrl: import.meta.env.DEV });
  for (const field of WEB_APP_INVITE_FIELDS) url.searchParams.delete(field);
  window.history.replaceState(window.history.state, "", url);
  return inviteUrl;
}

/** The plugin listing a `/app?plugin=<slug>` link names. The query is removed after it is read. */
function takePluginLink(): string | null {
  const url = new URL(window.location.href);
  if (!url.searchParams.has(WEB_APP_PLUGIN_PARAM)) return null;
  const slug = pluginSlugFromWebAppSearch(url.search);
  url.searchParams.delete(WEB_APP_PLUGIN_PARAM);
  window.history.replaceState(window.history.state, "", url);
  return slug;
}

/**
 * The agent or skill a `/app?marketplaceAgent=<id>` or `/app?marketplaceSkill=<slug>` link names.
 * The query is removed after it is read.
 */
function takeMarketplaceLink(): MarketplaceListingLink | null {
  const url = new URL(window.location.href);
  const params = [WEB_APP_MARKETPLACE_AGENT_PARAM, WEB_APP_MARKETPLACE_SKILL_PARAM];
  if (!params.some((param) => url.searchParams.has(param))) return null;
  const link = marketplaceListingFromWebAppSearch(url.search);
  for (const param of params) url.searchParams.delete(param);
  window.history.replaceState(window.history.state, "", url);
  return link;
}

type BillingReturn = DesktopAnalyticsProperties<"billing_return_viewed">;

/**
 * A return from Stripe to Billing: `/app?billing=portal` from the Customer Portal, or
 * `/app?billing=license` from license Checkout, with `&cancelled=1` when the user went back. The
 * query is removed after it is read.
 */
function takeBillingReturn(): BillingReturn | null {
  const url = new URL(window.location.href);
  const kind = url.searchParams.get(WEB_APP_BILLING_PARAM);
  if (kind === null) return null;
  const outcome = url.searchParams.get("cancelled") === "1" ? "cancelled" : "completed";
  for (const name of [WEB_APP_BILLING_PARAM, "cancelled"]) url.searchParams.delete(name);
  window.history.replaceState(window.history.state, "", url);
  return kind === "license" || kind === "portal" ? { outcome, kind } : { outcome };
}

/** What a `/app?start=<server|license>` link from the pricing page opens. The query is removed after it is read. */
function takeStartLink(): WebAppStart | null {
  const url = new URL(window.location.href);
  const start = takeWebAppStart(url);
  if (url.href !== window.location.href) window.history.replaceState(window.history.state, "", url);
  return start;
}

export function WebApp(props: { createRuntime?: WebRuntimeFactory } = {}) {
  // This component renders the text provider, so it reads the text of the last provider that rendered.
  const text = currentText();
  const [state, setState] = createStore<{
    account: CentralAuthUser | null;
    loaded: boolean;
    login: CentralAuthState;
    resendAt: number;
  }>({
    account: null,
    loaded: false,
    login: { status: "signed_out" },
    resendAt: 0,
  });
  createEffect(
    () => ({ account: state.account, loaded: state.loaded }),
    ({ account, loaded }) => {
      if (!loaded) return;
      configureWebReports(account);
      // Analytics is optional. A failed import changes nothing in the app.
      import("./web-analytics")
        .then((module) => {
          module.configureWebAnalytics(account);
          if (!account || !billingReturnEvent) return;
          module.trackBillingReturn(billingReturnEvent);
          billingReturnEvent = null;
        })
        .catch(() => undefined);
    },
  );
  // Kept here, not in the workspace, so each link waits through sign-in.
  // Before a session check, so a signed-out browser gets the saved answer or its regional default.
  // A browser that agreed once keeps its answer: the sign-in screen does not show the box again.
  const [analyticsAgreed, setAnalyticsAgreed] = createSignal(webReportsAgreed());
  const [analyticsChoice, setAnalyticsChoice] = createSignal(webReportsEnabled());
  // Only a box that the user changed is a choice for the account; a regional default is not.
  let analyticsTouched = false;
  // After a sign-out, the sign-in screen starts again from the saved answer of this browser.
  function resetAnalyticsBox() {
    setAnalyticsAgreed(webReportsAgreed());
    setAnalyticsChoice(webReportsEnabled());
    analyticsTouched = false;
  }
  const [agentTemplateId, setAgentTemplateId] = createSignal(takeAgentTemplateLink());
  const [inviteUrl, setInviteUrl] = createSignal(takeInviteLink());
  const [pluginSlug, setPluginSlug] = createSignal(takePluginLink());
  const [marketplaceListing, setMarketplaceListing] = createSignal(takeMarketplaceLink());
  const [startLink, setStartLink] = createSignal(takeStartLink());
  const initialBillingReturn = takeBillingReturn();
  const initialHostingReturn = takeHostingReturn();
  const [billingReturn, setBillingReturn] = createSignal(initialBillingReturn !== null);
  const [hostingReturn, setHostingReturn] = createSignal(initialHostingReturn);
  /** Sent once, when analytics has the account. */
  let billingReturnEvent: BillingReturn | null =
    initialBillingReturn ??
    (initialHostingReturn ? { outcome: initialHostingReturn.paid ? "completed" : "cancelled", kind: "plan" } : null);
  /** Shown after the first session check, because its 401 resets the login state. */
  let companySignInReturnError = takeCompanySignInError();
  let workosSignInReturnError = takeCompanySignInError(WEB_APP_WORKOS_SIGN_IN_ERROR_PARAM);
  /** This deployment signs the account in with WorkOS, so the email code stays hidden. */
  let workosOnly = false;
  function signedOutState(): CentralAuthState {
    return { status: "signed_out", ...(workosOnly ? { provider: "workos" } : {}) };
  }
  const [workspace, setWorkspace] = createSignal<typeof WebWorkspace>();
  /** Sets the account when the workspace code is ready to show it. */
  async function showAccount(account: CentralAuthUser) {
    const view = await loadWorkspace();
    setWorkspace(() => view);
    return account;
  }
  // The loading screen stays over the app until its exit ends.
  const [loadingShown, setLoadingShown] = createSignal(true);
  let channel: BroadcastChannel | null = null;
  let disposed = false;
  let sessionGeneration = 0;
  /**
   * The cookie's account session has ended. The server ended its remote sessions in the same write
   * (`endAccountSession`), so the closing workspace does not end them again.
   */
  let sessionEnded = false;
  function clearSession(ended = true) {
    sessionEnded = ended;
    writeSignedInHint(false);
    // The saved workspace frames name the agents of the account's servers.
    if (ended) {
      deleteRemoteWorkspaceFrames(null);
      void deleteSavedAgentPictures(null);
    }
    sessionGeneration += 1;
    setState((draft) => {
      draft.account = null;
      draft.login = signedOutState();
    });
    resetAnalyticsBox();
  }
  const accountFetch: typeof fetch = async (input, init) => {
    const generation = sessionGeneration;
    const response = await fetch(input, init);
    if (
      !disposed &&
      generation === sessionGeneration &&
      response.status === 401 &&
      input !== "/api/browser/email/start" &&
      input !== "/api/browser/email/verify" &&
      input !== "/api/browser/company/start" &&
      input !== "/api/browser/workos/start"
    ) {
      if (state.account) channel?.postMessage("session-changed");
      clearSession();
    }
    return response;
  };
  const accountCalls = createWebAccountCalls(accountFetch, checkSession);
  async function request(
    path: string,
    body?:
      | { email: string }
      | { challengeId: string | null; code: string; firstTouch?: FirstTouch }
      | Record<string, never>,
  ) {
    const response = await accountFetch(`/api/browser/${path}`, {
      method: body ? "POST" : "GET",
      credentials: "same-origin",
      cache: "no-store",
      headers: body ? { "Content-Type": "application/json", "X-OpenBot-Browser": "1" } : {},
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const value = await response.json();
    if (!response.ok) {
      if (
        (path === "email/start" || path === "email/verify") &&
        isDynamicRecord(value) &&
        isDynamicRecord(value.error) &&
        (value.error.code === "company_sign_in_required" || value.error.code === "workos_sign_in_required")
      )
        throw new CompanySignInRequired(value.error.code === "workos_sign_in_required" ? "workos" : "company");
      if (path === "email/start" || path === "email/verify") {
        const retryAfterSeconds = Number.parseInt(response.headers.get("Retry-After") ?? "", 10);
        const issue = {
          code:
            isDynamicRecord(value) && isDynamicRecord(value.error) && isString(value.error.code)
              ? value.error.code
              : "sign_in_failed",
          message:
            isDynamicRecord(value) && isDynamicRecord(value.error) && isString(value.error.message)
              ? value.error.message
              : text.t("webClient.login.failed"),
          ...(retryAfterSeconds ? { retryAfterSeconds } : {}),
        };
        setState((draft) => {
          draft.login = draft.login.status === "code_sent" ? { ...draft.login, issue } : { status: "error", issue };
        });
        throw new SignInIssueShown();
      }
      if (response.status === 401 && path === "session") throw new SessionSignedOut();
      throw new Error(
        isDynamicRecord(value) && isDynamicRecord(value.error) && isString(value.error.message)
          ? value.error.message
          : text.t("webClient.login.requestFailed"),
      );
    }
    return value;
  }
  /** Like the desktop login, a server refusal is shown as the login issue, not also as a thrown error. */
  async function signInRequest(path: "email/start" | "email/verify", body: Parameters<typeof request>[1]) {
    try {
      return await request(path, body);
    } catch (error) {
      if (error instanceof SignInIssueShown) return null;
      throw error;
    }
  }
  function accountFrom(value: unknown): CentralAuthUser {
    if (
      !isDynamicRecord(value) ||
      !isDynamicRecord(value.user) ||
      !isString(value.user.id) ||
      !isString(value.user.email)
    )
      throw new Error(text.t("webClient.login.accountInvalid"));
    return {
      id: value.user.id,
      email: value.user.email,
      name: isString(value.user.name) ? value.user.name : null,
      avatarUrl: isString(value.user.avatarUrl) ? value.user.avatarUrl : null,
      analyticsEnabled: isBoolean(value.user.analyticsEnabled) ? value.user.analyticsEnabled : null,
      chatColor: isAvatarColor(value.user.chatColor) ? value.user.chatColor : null,
    };
  }
  /**
   * Keeps this browser and the account on the user's latest analytics answer. A choice that the
   * account does not have yet goes to it; otherwise this browser follows the account's answer. An
   * "off" from before the account kept answers does not follow an "on".
   */
  async function followAccountAnalytics(answer: boolean | null | undefined) {
    const module = await import("./web-analytics");
    if (webAccountPending()) return module.sendWebAnalyticsChoice(accountCalls);
    if (answer === null || answer === undefined || answer === webReportsEnabled()) return;
    if (answer && webKeepsOff()) return;
    setWebReportsEnabled(answer);
    module.followWebReportsPreference();
  }
  async function checkSession() {
    const generation = sessionGeneration;
    // The workspace code loads beside the session check, not after it, when this browser was signed in.
    if (readSignedInHint()) void loadWorkspace().catch(() => undefined);
    try {
      const session = await request("session");
      markRemoteSync("session");
      const account = await showAccount(accountFrom(session));
      markRemoteSync("workspace-code");
      if (!disposed && generation === sessionGeneration) {
        sessionEnded = false;
        setState((draft) => {
          draft.account = account;
        });
        writeSignedInHint(true);
        void followAccountAnalytics(account.analyticsEnabled).catch(() => undefined);
      }
    } catch (error) {
      if (!disposed && generation === sessionGeneration) {
        // A missing session is the sign-in screen. Any other failure, while signed out, offers a retry.
        if (error instanceof SessionSignedOut) {
          setState((draft) => {
            if (!draft.account) draft.login = signedOutState();
          });
        } else if (state.account)
          toast.error(
            text.sourceText(error instanceof Error ? error.message : text.t("webClient.login.sessionFailed")),
            { report: { operation: "other", source: "system", cause_code: classifyFailure(error) } },
          );
        else
          setState((draft) => {
            draft.login = {
              status: "error",
              issue: { code: "auth_api_unavailable", message: sourceText("error.auth.serviceUnavailable") },
            };
          });
      }
    } finally {
      const returnProvider = workosSignInReturnError !== null ? "workos" : "company";
      const returnError = workosSignInReturnError ?? companySignInReturnError;
      companySignInReturnError = null;
      workosSignInReturnError = null;
      if (!disposed)
        setState((draft) => {
          draft.loaded = true;
          if (returnError !== null && !draft.account && draft.login.status === "signed_out")
            draft.login = { status: "error", issue: companySignInIssue(returnError, returnProvider) };
        });
    }
  }
  async function start(email: string) {
    if (Date.now() < state.resendAt) throw new Error(text.t("webClient.login.wait"));
    // A request for a code answers the analytics box and accepts the Terms of Service.
    if (!analyticsAgreed()) {
      setWebReportsEnabled(analyticsChoice());
      if (analyticsTouched) setWebAccountPending(analyticsChoice());
      import("./web-analytics").then((module) => module.followWebReportsPreference()).catch(() => undefined);
    }
    // The user waits for the code email, so the workspace code loads now, before it is needed.
    void loadWorkspace().catch(() => undefined);
    const value = await signInRequest("email/start", { email }).catch((error: unknown) => {
      if (error instanceof CompanySignInRequired) return error;
      throw error;
    });
    if (value instanceof CompanySignInRequired) return openCompanySignIn(email, value.provider);
    if (value === null) return;
    if (!isDynamicRecord(value) || !isString(value.challengeId) || typeof value.resendAt !== "number")
      throw new Error(text.t("webClient.login.responseInvalid"));
    const challengeId = value.challengeId;
    const resendAt = value.resendAt;
    setState((draft) => {
      draft.resendAt = resendAt;
      draft.login = {
        status: "code_sent",
        challengeId,
        email,
        expiresAt: typeof value.expiresAt === "number" ? value.expiresAt : Date.now() + 600000,
        resendAvailableAt: resendAt,
        ...(isString(value.developmentCode) ? { developmentCode: value.developmentCode } : {}),
      };
    });
  }
  /**
   * Goes to the company's sign-in page in this tab. The account service sends the browser back to
   * `/app` with the session cookie, or with `companySignInError`.
   */
  async function openCompanySignIn(email: string, provider: "company" | "workos" = "company") {
    setState((draft) => {
      draft.login = { status: "company_sign_in", email, ...(provider === "workos" ? { provider } : {}) };
    });
    const response = await accountFetch(
      provider === "workos" ? "/api/browser/workos/start" : "/api/browser/company/start",
      {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: { "Content-Type": "application/json", "X-OpenBot-Browser": "1" },
        body: JSON.stringify(email ? { email } : {}),
      },
    );
    const value = await response.json().catch(() => null);
    if (response.ok && isDynamicRecord(value) && isString(value.authorizationUrl)) {
      window.location.assign(value.authorizationUrl);
      return;
    }
    const code =
      isDynamicRecord(value) && isDynamicRecord(value.error) && isString(value.error.code)
        ? value.error.code
        : provider === "workos"
          ? "workos_sign_in_failed"
          : "company_sign_in_failed";
    setState((draft) => {
      draft.login = {
        status: "company_sign_in",
        email,
        ...(provider === "workos" ? { provider } : {}),
        issue: companySignInIssue(code, provider),
      };
    });
  }
  async function verify(challengeId: string, code: string) {
    // The first website visit of this browser, so that reports can name the source of a new account.
    const firstTouch = readFirstTouch(() => window.localStorage, Date.now());
    const value = await signInRequest("email/verify", {
      challengeId,
      code,
      ...(firstTouch ? { firstTouch } : {}),
    }).catch((error: unknown) => {
      if (error instanceof CompanySignInRequired && state.login.status === "code_sent") {
        return openCompanySignIn(state.login.email, error.provider).then(() => null);
      }
      throw error;
    });
    if (value === null) return;
    const account = accountFrom(value);
    sessionGeneration += 1;
    sessionEnded = false;
    channel?.postMessage("session-changed");
    try {
      await showAccount(account);
    } catch {
      // The server has used the code and set the session, so the retry checks the session again.
      setState((draft) => {
        draft.login = {
          status: "error",
          issue: { code: "auth_api_unavailable", message: sourceText("error.auth.serviceUnavailable") },
        };
      });
      return;
    }
    setState((draft) => {
      draft.account = account;
    });
    writeSignedInHint(true);
    void followAccountAnalytics(account.analyticsEnabled).catch(() => undefined);
  }
  async function logout() {
    await request("logout", {});
    clearSession();
    channel?.postMessage("session-changed");
  }
  async function loadWorkosSignIn() {
    try {
      const response = await fetch("/api/browser/workos/start", {
        credentials: "same-origin",
        cache: "no-store",
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) return;
      const value = await response.json();
      workosOnly = isDynamicRecord(value) && value.enabled === true;
    } catch {
      workosOnly = false;
    }
  }
  onSettled(() => {
    channel = new BroadcastChannel("openbot.web.session");
    channel.onmessage = () => {
      clearSession();
      void checkSession();
    };
    void loadWorkosSignIn().then(() => {
      if (!disposed) void checkSession();
    });
    // A page restored from the back-forward cache still has its session; its connection ends normally.
    // A browser also sends `pageshow` after a normal load, which can come after the session check.
    const restore = (event: PageTransitionEvent) => {
      if (!event.persisted) return;
      clearSession(false);
      void checkSession();
    };
    window.addEventListener("pageshow", restore);
    return () => {
      disposed = true;
      channel?.close();
      window.removeEventListener("pageshow", restore);
    };
  });
  let appElement: HTMLDivElement | undefined;
  onSettled(() => (appElement ? trackVisualViewport(appElement) : undefined));
  const variant: AppVariant = import.meta.env.DEV ? "dev" : "production";
  const consentAgents = createOnboardingTeam(onboardingSessionSeed(), 3);
  const languagePreference = createWebLanguagePreference();
  const appearancePreference = createWebAppearancePreference();
  // The sign-in starts in the browser language; its language button opens the wheel to change it.
  const [languageWheelOpen, setLanguageWheelOpen] = createSignal(false);
  return (
    <StaticI18nProvider
      locale={resolveLocale(languagePreference.language(), navigator.language)}
      formatLocale={formatLocale(languagePreference.language(), navigator.language)}
    >
      <NotificationObserver onShown={reportNotification}>
        <div class="web-app" ref={(element) => (appElement = element)}>
          {/* The installed app draws under the notch, so the toasts start below the status bar. */}
          <Toaster
            onToastShown={reportNotification}
            offset={{ top: "calc(env(safe-area-inset-top, 0px) + 24px)" }}
            mobileOffset={{ top: "calc(env(safe-area-inset-top, 0px) + 16px)" }}
          />
          <WebServiceWorkerUpdates />
          <Show when={state.loaded}>
            <Show
              keyed
              when={state.account?.id}
              fallback={
                <Show
                  when={!languageWheelOpen()}
                  fallback={
                    <WebLanguageStep
                      variant={variant}
                      language={languagePreference.language()}
                      onChangeLanguage={languagePreference.setLanguage}
                      onDone={() => setLanguageWheelOpen(false)}
                    />
                  }
                >
                  <AccountLogin
                    variant={variant}
                    language={resolveLocale(languagePreference.language(), navigator.language)}
                    onChangeLanguage={() => setLanguageWheelOpen(true)}
                    state={state.login}
                    onRetry={checkSession}
                    onRequestEmailCode={start}
                    onVerifyEmailCode={verify}
                    onOpenCompanySignIn={() =>
                      state.login.status === "company_sign_in"
                        ? openCompanySignIn(state.login.email, state.login.provider ?? "company")
                        : state.login.status === "signed_out" && state.login.provider === "workos"
                          ? openCompanySignIn("", "workos")
                          : Promise.resolve()
                    }
                    onReset={async () => {
                      clearSession();
                      setState((draft) => {
                        draft.resendAt = 0;
                      });
                    }}
                    consent={
                      <Show when={!analyticsAgreed()}>
                        <AnalyticsConsentRow
                          class="web-consent-row"
                          checked={analyticsChoice()}
                          agents={consentAgents}
                          onChange={(checked) => {
                            analyticsTouched = true;
                            setAnalyticsChoice(checked);
                          }}
                        />
                      </Show>
                    }
                    notice={
                      <ConsentNotice
                        onOpenTerms={() => window.open("/terms", "_blank", "noopener")}
                        onOpenPrivacy={() => window.open("/privacy", "_blank", "noopener")}
                      />
                    }
                  />
                </Show>
              }
            >
              {(accountId) => (
                <Dynamic
                  component={workspace()}
                  accountId={accountId}
                  accountEmail={state.account?.email ?? ""}
                  accountName={state.account?.name ?? null}
                  accountAvatarUrl={state.account?.avatarUrl ?? null}
                  accountChatColor={state.account?.chatColor ?? null}
                  accountFetch={accountFetch}
                  onSessionCheck={checkSession}
                  accountSessionEnded={() => sessionEnded}
                  onLogout={logout}
                  createRuntime={props.createRuntime}
                  agentTemplateId={agentTemplateId()}
                  onAgentTemplateClose={() => setAgentTemplateId(null)}
                  inviteUrl={inviteUrl()}
                  onInviteClose={() => setInviteUrl(null)}
                  pluginSlug={pluginSlug()}
                  onPluginSlugConsumed={() => setPluginSlug(null)}
                  marketplaceListing={marketplaceListing()}
                  onMarketplaceListingConsumed={() => setMarketplaceListing(null)}
                  start={startLink()}
                  onStartConsumed={() => setStartLink(null)}
                  billingReturn={billingReturn()}
                  onBillingReturnConsumed={() => setBillingReturn(false)}
                  hostingReturn={hostingReturn()}
                  onHostingReturnConsumed={() => setHostingReturn(null)}
                  language={languagePreference.language()}
                  onChangeLanguage={languagePreference.setLanguage}
                  appearance={appearancePreference.appearance()}
                  onChangeAppearance={appearancePreference.setAppearance}
                />
              )}
            </Show>
          </Show>
          <Show when={loadingShown()}>
            <AppLoadingScreen ready={state.loaded} onExited={() => setLoadingShown(false)} />
          </Show>
        </div>
      </NotificationObserver>
    </StaticI18nProvider>
  );
}
