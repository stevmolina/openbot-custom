import { isString } from "@openbot/contracts/runtime-values";
import { sourceText } from "@openbot/i18n/source-english";
import { createFileRoute } from "@tanstack/solid-router";
import { Effect } from "effect";
import { normalizeMobileDevice } from "../../../../server/auth-service";
import { runApiResponse } from "../../../../server/effect-runtime";
import { readJsonObject } from "../../../../server/json-body";
import { apiError, json, requestWorkosSignIn, workosSignInErrorResponse } from "../../../../server/request-auth";
import { WorkosSignInError } from "../../../../server/workos-sign-in";

// The phone gives the one-time code from its browser session, the verifier of its challenge and its
// device. Only this step makes the session a mobile session; `/v1/auth/workos/exchange` makes a
// desktop session.
export const Route = createFileRoute("/v1/mobile-auth/workos/exchange")({
  server: {
    handlers: {
      POST: ({ request }) =>
        runApiResponse(
          Effect.gen(function* () {
            const body = yield* readJsonObject(request);
            if (!isString(body.code) || !isString(body.codeVerifier)) {
              return apiError(400, "invalid_workos_sign_in_code", sourceText("error.auth.workosSignInFailed"));
            }
            const { deviceId, deviceName, platform } = body;
            if (
              !isString(deviceId) ||
              !isString(deviceName) ||
              (platform !== "ios" && platform !== "android" && platform !== "unknown")
            ) {
              return apiError(400, "invalid_mobile_device", sourceText("error.auth.serviceError"));
            }
            const device = yield* Effect.try({
              try: () => normalizeMobileDevice({ id: deviceId, name: deviceName, platform }),
              catch: () => new WorkosSignInError(400, "invalid_mobile_device", sourceText("error.auth.serviceError")),
            });
            return json(
              yield* requestWorkosSignIn().exchange({ code: body.code, codeVerifier: body.codeVerifier, device }),
            );
          }),
          workosSignInErrorResponse,
        ),
    },
  },
});
