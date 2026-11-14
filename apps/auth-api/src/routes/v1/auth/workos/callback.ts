import { sourceText } from "@openbot/i18n/source-english";
import { createFileRoute } from "@tanstack/solid-router";
import { Effect } from "effect";
import { runApiResponse } from "../../../../server/effect-runtime";
import { apiError, requestWorkosSignIn, workosSignInErrorResponse } from "../../../../server/request-auth";

// WorkOS sends the browser here after a sign-in or a test. The browser goes on to the
// app's loopback listener with a one-time code, or with the error code.
export const Route = createFileRoute("/v1/auth/workos/callback")({
  server: {
    handlers: {
      GET: ({ request }) =>
        runApiResponse(
          Effect.gen(function* () {
            const target = yield* requestWorkosSignIn().finish(new URL(request.url).searchParams, request.url);
            if (!target) {
              return apiError(410, "workos_sign_in_expired", sourceText("error.auth.workosSignInFailed"));
            }
            return new Response(null, {
              status: 303,
              headers: { Location: target, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" },
            });
          }),
          workosSignInErrorResponse,
        ),
    },
  },
});
