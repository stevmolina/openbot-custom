import { isString } from "@openbot/contracts/runtime-values";
import { sourceText } from "@openbot/i18n/source-english";
import { createFileRoute } from "@tanstack/solid-router";
import { Effect } from "effect";
import { runApiResponse } from "../../../../server/effect-runtime";
import { readJsonObject } from "../../../../server/json-body";
import {
  apiError,
  json,
  requestWorkosSignIn,
  requestWorkosSignInEnabled,
  workosSignInErrorResponse,
} from "../../../../server/request-auth";
import { requestSourceIp } from "../../../../server/source-ip";

// GET tells the sign-in screen whether this deployment uses WorkOS, so it can hide the email code.
// POST asks for the WorkOS page. The email is optional and is only a login hint.
export const Route = createFileRoute("/v1/auth/workos/start")({
  server: {
    handlers: {
      GET: () => json({ enabled: requestWorkosSignInEnabled() }),
      POST: ({ request }) =>
        runApiResponse(
          Effect.gen(function* () {
            const body = yield* readJsonObject(request);
            const { returnTo, clientState, clientChallenge } = body;
            const email = isString(body.email) ? body.email : "";
            if (!isString(returnTo) || !isString(clientState) || !isString(clientChallenge)) {
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
