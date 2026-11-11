import { type McpAuthValues, mcpFlowComplete } from "@openbot/contracts/mcp-connect-flows";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { usePreventRemove } from "expo-router/react-navigation";
import { Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import Lock from "lucide-react-native/icons/lock";
import { useEffect, useState } from "react";
import { Linking, View } from "react-native";
import { useMobileSession } from "@/features/auth/context/mobile-session-context";
import { McpRelaySignInSteps } from "@/features/servers/components/mcp-relay-sign-in-steps";
import { SettingsNote, SettingsRow, SettingsSection } from "@/features/settings/components/settings-content";
import { useMobileWorkspaceSelector } from "@/features/workspace/context/mobile-workspace-context";
import { SheetFormField } from "@/shared/components/sheet-form-field";
import { SheetSaveAction } from "@/shared/components/sheet-save-action";
import { SheetScrollView } from "@/shared/components/sheet-scroll-view";
import { useText } from "@/shared/lib/text";
import { ListingIcon } from "../components/marketplace-parts";
import { appListings } from "../model/marketplace-listings";
import { pluginConnectMethod } from "../model/plugin-connect";
import { usePluginConnect } from "../model/use-plugin-connect";

/**
 * The second page of an app's sheet: the key the app asks for, or its browser sign-in. The server
 * tests the key before it saves the app; a sign-in ends on the server, which keeps the grant.
 */
export function MarketplaceAppConnectScreen() {
  const { t } = useText();
  const [muted] = useThemeColor(["muted"]);
  const { serverId, slug } = useLocalSearchParams<{ serverId: string; slug: string }>();
  const { session } = useMobileSession();
  const listing = session?.apiUrl ? appListings(session.apiUrl).find((item) => item.id === slug) : undefined;
  const plugin = listing?.kind === "app" && listing.source === "plugin" ? listing.plugin : null;
  const app = plugin?.apps[0] ?? null;
  const canRelay = useMobileWorkspaceSelector((workspace) => workspace.canRelayMcpSignIn(serverId));
  const method = app ? pluginConnectMethod(app, canRelay) : null;
  const connect = usePluginConnect(serverId, app, method);
  const [values, setValues] = useState<McpAuthValues>({});
  const phase = connect.state.phase;
  const working = phase === "working" || phase === "waiting";
  usePreventRemove(phase === "working", () => undefined);
  // Back to the listing, which now shows the app as connected, after the guard is released.
  useEffect(() => {
    if (phase === "done") router.back();
  }, [phase]);

  if (!listing || !method || (method.kind !== "key" && method.kind !== "link"))
    return (
      <SheetScrollView
        className="bg-sheet"
        contentContainerClassName="px-4 pt-5"
        contentInsetAdjustmentBehavior="automatic"
      >
        <SettingsNote>{t("mobile.marketplace.listing.notFound")}</SettingsNote>
      </SheetScrollView>
    );

  const ready = method.kind === "link" || mcpFlowComplete(method.flow, values);

  return (
    <SheetScrollView
      className="bg-sheet"
      contentContainerClassName="gap-6 px-4 pb-safe-offset-5 pt-5"
      contentInsetAdjustmentBehavior="automatic"
      keyboardDismissMode="interactive"
      keyboardShouldPersistTaps="handled"
    >
      <Stack.Screen
        options={{
          title: t("mobile.marketplace.app.connectTitle", { name: listing.name }),
          headerBackButtonDisplayMode: "minimal",
        }}
      />
      {method.kind === "key" ? (
        <SheetSaveAction
          dirty
          canSave={ready}
          pending={phase === "working"}
          label={t("mobile.marketplace.app.connect")}
          pendingLabel={t("mobile.marketplace.app.connecting")}
          onSave={() => void connect.connect(values)}
        />
      ) : null}
      <View className="items-center gap-3 px-4 pt-2">
        <ListingIcon listing={listing} size={72} />
        <View className="items-center gap-1">
          <Typography.Heading type="h3" align="center">
            {listing.name}
          </Typography.Heading>
          <Typography.Paragraph type="body-sm" align="center" className="text-grouped-secondary">
            {method.kind === "key" ? t("mobile.marketplace.app.keyIntro") : method.flow.label}
          </Typography.Paragraph>
        </View>
      </View>
      {method.kind === "key" ? (
        <View className="gap-4">
          {method.flow.fields.map((field) => (
            <SheetFormField
              key={field.id}
              label={field.label}
              hint={field.hint}
              isRequired={!field.optional}
              placeholder={field.placeholder}
              value={values[field.id] ?? ""}
              editable={!working}
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry={!field.url}
              inputMode={field.url ? "url" : "text"}
              onChangeText={(value) => setValues((current) => ({ ...current, [field.id]: value }))}
            />
          ))}
          {method.flow.docsUrl ? (
            <SettingsSection>
              <SettingsRow onPress={() => void Linking.openURL(method.flow.docsUrl ?? "").catch(() => undefined)}>
                <Typography.Paragraph>{method.flow.docsLabel ?? t("mobile.marketplace.app.docs")}</Typography.Paragraph>
              </SettingsRow>
            </SettingsSection>
          ) : null}
        </View>
      ) : (
        <McpRelaySignInSteps
          name={listing.name}
          state={connect.state}
          working={working}
          onStart={() => void connect.connect(values)}
          onPaste={(address) => void connect.paste(address)}
          onReopen={connect.reopen}
        />
      )}
      {connect.error ? (
        <Typography.Paragraph accessibilityRole="alert" className="px-1 text-danger-text">
          {connect.error}
        </Typography.Paragraph>
      ) : null}
      <View className="flex-row items-start justify-center gap-2 px-4">
        <Lock color={String(muted)} size={14} strokeWidth={2} style={{ marginTop: 2 }} />
        <Typography.Paragraph type="body-xs" className="shrink text-grouped-secondary">
          {method.kind === "key" ? t("mobile.marketplace.app.keySecure") : t("mobile.marketplace.app.signInIntro")}
        </Typography.Paragraph>
      </View>
    </SheetScrollView>
  );
}
