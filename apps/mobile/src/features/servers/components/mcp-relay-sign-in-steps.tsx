import { Button, Spinner, Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import Check from "lucide-react-native/icons/check";
import { useState } from "react";
import { View } from "react-native";
import { useCSSVariable } from "uniwind";
import type { McpSignInRelayState } from "@/features/servers/model/use-mcp-sign-in-relay";
import { SettingsRow, SettingsSection } from "@/features/settings/components/settings-content";
import { SheetFormField } from "@/shared/components/sheet-form-field";
import { useText } from "@/shared/lib/text";
import { typeScale } from "@/shared/lib/type-scale";

/** The address that the sign-in page opens at its end: a local address with the code. */
const PASTE_PLACEHOLDER = "http://localhost/callback?code=…";

/**
 * The steps of a relayed browser sign-in (`sign-in-relay-v1`) to `name`, and its action: open the
 * page, open it again, or paste back the address that the page ended on.
 */
export function McpRelaySignInSteps({
  name,
  state,
  working,
  onStart,
  onPaste,
  onReopen,
}: {
  name: string;
  /** The `waiting` and `signIn` steps of the sign-in; `idle` before it starts. */
  state: McpSignInRelayState | { phase: "working" | "done" };
  /** The sign-in starts or finishes: the start button waits. */
  working: boolean;
  onStart: () => void;
  onPaste: (address: string) => void;
  onReopen: () => void;
}) {
  const { t } = useText();
  const actionForeground = String(useCSSVariable("--openbot-action-foreground"));
  const [address, setAddress] = useState("");
  const signingIn = state.phase === "signIn" ? state : null;
  // The step the browser sign-in is on: 0 before the page opens, 1 while the user signs in.
  const step = signingIn ? 1 : 0;
  return (
    <View className="gap-4">
      <SettingsSection>
        <ConnectStep index={0} current={step} label={t("mobile.marketplace.app.stepOpen", { name })} />
        <ConnectStep index={1} current={step} label={t("mobile.marketplace.app.stepAllow")} />
        <ConnectStep index={2} current={step} label={t("mobile.marketplace.app.stepReturn", { name })} />
      </SettingsSection>
      {signingIn?.paste ? (
        <View className="gap-3">
          <Typography.Paragraph type="body-sm" className="px-1 text-grouped-secondary">
            {t("mobile.marketplace.app.pasteHint")}
          </Typography.Paragraph>
          <SheetFormField
            label={t("mobile.marketplace.app.pasteLabel")}
            placeholder={PASTE_PLACEHOLDER}
            value={address}
            autoCapitalize="none"
            autoCorrect={false}
            inputMode="url"
            onChangeText={setAddress}
          />
        </View>
      ) : null}
      {signingIn?.paste ? (
        <Button
          className="bg-action"
          feedbackVariant="scale"
          isDisabled={!address.trim()}
          onPress={() => onPaste(address)}
        >
          <Button.Label className="text-action-foreground">{t("mobile.marketplace.app.finishSignIn")}</Button.Label>
        </Button>
      ) : signingIn ? (
        <Button variant="secondary" feedbackVariant="scale" onPress={onReopen}>
          <Button.Label>{t("mobile.marketplace.app.openAgain")}</Button.Label>
        </Button>
      ) : (
        <Button className="bg-action" feedbackVariant="scale" isDisabled={working} onPress={onStart}>
          {working ? <Spinner size="sm" color={actionForeground} /> : null}
          <Button.Label className="text-action-foreground">
            {working ? t("mobile.marketplace.app.waiting") : t("mobile.marketplace.app.openSignIn")}
          </Button.Label>
        </Button>
      )}
    </View>
  );
}

/** One step of a browser sign-in: a done step has a check, the current one the accent, the rest wait. */
function ConnectStep({ index, current, label }: { index: number; current: number; label: string }) {
  const [accent, muted, control] = useThemeColor(["accent", "muted", "surface-secondary"]);
  const done = index < current;
  const active = index === current;
  return (
    <SettingsRow
      leading={
        <View
          className="h-7 w-7 items-center justify-center rounded-full"
          style={{ backgroundColor: done || active ? String(accent) : String(control) }}
        >
          {done ? (
            <Check color="#ffffff" size={15} strokeWidth={2.8} />
          ) : (
            <Typography.Paragraph
              className="font-semibold"
              style={{ ...typeScale.caption, color: active ? "#ffffff" : String(muted) }}
            >
              {index + 1}
            </Typography.Paragraph>
          )}
        </View>
      }
    >
      <Typography.Paragraph className={active ? undefined : "text-grouped-secondary"}>{label}</Typography.Paragraph>
    </SettingsRow>
  );
}
