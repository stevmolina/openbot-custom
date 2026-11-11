import { isString } from "@openbot/contracts/runtime-values";
import { sourceText } from "@openbot/i18n/source";
import { createFileRoute } from "@tanstack/solid-router";
import { Effect } from "effect";
import { runApiResponse } from "../../../../server/effect-runtime";
import { readJsonObject } from "../../../../server/json-body";
import { apiError, json, requestWorkosSignIn, workosSignInErrorResponse } from "../../../../server/request-auth";
import { requestSourceIp } from "../../../../server/source-ip";

// The app asks for the WorkOS's sign-in page after the email start answers
// `workos_sign_in_required`. The app opens the answer in the browser.
export const Route = createFileRoute("/v1/auth/workos/start")({
  server: {
    handlers: {
      POST: ({ request }) =>
        runApiResponse(
          Effect.gen(function* () {
            const body = yield* readJsonObject(request);
            const { email, returnTo, clientState, clientChallenge } = body;
            if (!isString(email) || !isString(returnTo) || !isString(clientState) || !isString(clientChallenge)) {
              return apiError(400, "invalid_workos_sign_in", sourceText("error.auth.workosSignInFailed"));
            }
            return json(
              yield* requestWorkosSignIn().startSignIn(
                { email, returnTo, clientState, clientChallenge, sourceIp: requestSourceIp(request) },
                request.url,
              ),
            );
          }),
          workosSignInErrorResponse,
        ),
    },
  },
});
