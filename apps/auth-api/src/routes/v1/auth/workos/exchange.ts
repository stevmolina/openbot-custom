import { isString } from "@openbot/contracts/runtime-values";
import { sourceText } from "@openbot/i18n/source";
import { createFileRoute } from "@tanstack/solid-router";
import { Effect } from "effect";
import { runApiResponse } from "../../../../server/effect-runtime";
import { readJsonObject } from "../../../../server/json-body";
import { apiError, json, requestWorkosSignIn, workosSignInErrorResponse } from "../../../../server/request-auth";

// The app gives the one-time code from its loopback listener and the verifier of its challenge.
// The answer is a session, as an email code gives.
export const Route = createFileRoute("/v1/auth/workos/exchange")({
  server: {
    handlers: {
      POST: ({ request }) =>
        runApiResponse(
          Effect.gen(function* () {
            const body = yield* readJsonObject(request);
            if (!isString(body.code) || !isString(body.codeVerifier)) {
              return apiError(400, "invalid_workos_sign_in_code", sourceText("error.auth.workosSignInFailed"));
            }
            return json(yield* requestWorkosSignIn().exchange({ code: body.code, codeVerifier: body.codeVerifier }));
          }),
          workosSignInErrorResponse,
        ),
    },
  },
});
