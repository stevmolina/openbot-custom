import type { AgentComputerMachine, AgentComputerStatus } from "@openbot/contracts/ipc";
import { router, useLocalSearchParams } from "expo-router";
import { Typography } from "heroui-native";
import { useEffect, useRef, useState } from "react";
import { Linking } from "react-native";
import {
  SettingsContent,
  SettingsNote,
  SettingsRow,
  SettingsSection,
} from "@/features/settings/components/settings-content";
import { useMobileWorkspace, useMobileWorkspaceActions } from "@/features/workspace/context/mobile-workspace-context";
import { SheetFormField } from "@/shared/components/sheet-form-field";
import { useText } from "@/shared/lib/text";

export function CloudComputersSection({ serverId }: { serverId: string }) {
  const { t } = useText();
  const { canManageAgentComputer } = useMobileWorkspace();
  if (!canManageAgentComputer(serverId)) return null;
  return (
    <SettingsSection>
      <SettingsRow onPress={() => router.push({ pathname: "/server-settings/cloud-computers", params: { serverId } })}>
        <Typography.Paragraph>{t("mobile.server.cloudComputers.title")}</Typography.Paragraph>
      </SettingsRow>
    </SettingsSection>
  );
}

/** Human bearer links stay in mounted screen state. Offline or role loss unmounts the account. */
export function ServerCloudComputersScreen() {
  const { t } = useText();
  const { serverId } = useLocalSearchParams<{ serverId: string }>();
  const { canManageAgentComputer } = useMobileWorkspace();
  if (!canManageAgentComputer(serverId))
    return (
      <SettingsContent>
        <SettingsNote>{t("mobile.server.cloudComputers.unavailable")}</SettingsNote>
      </SettingsContent>
    );
  return <CloudComputerAccount key={serverId} serverId={serverId} />;
}

function CloudComputerAccount({ serverId }: { serverId: string }) {
  const { t, errorMessage } = useText();
  const { agentComputer: api } = useMobileWorkspaceActions();
  const [state, setState] = useState<{
    status: AgentComputerStatus | null;
    machines: AgentComputerMachine[];
    error: string | null;
    busy: boolean;
  }>({ status: null, machines: [], error: null, busy: false });
  const [key, setKey] = useState("");
  const generation = useRef(0);
  const locked = useRef(false);
  useEffect(() => {
    const current = ++generation.current;
    void api
      .status(serverId)
      .then(async (status) => {
        const machines = status.connected ? (await api.machines(serverId)).machines : [];
        if (current === generation.current) setState({ status, machines, error: null, busy: false });
      })
      .catch((error: unknown) => {
        if (current === generation.current)
          setState((value) => ({ ...value, error: errorMessage(error, t("mobile.server.cloudComputers.failed")) }));
      });
    return () => {
      generation.current++;
    };
  }, [api, serverId, errorMessage, t]);

  async function act(operation: () => Promise<AgentComputerStatus>) {
    if (locked.current) return;
    locked.current = true;
    const current = ++generation.current;
    setState((value) => ({ ...value, busy: true, error: null, machines: [] }));
    try {
      const status = await operation();
      if (current !== generation.current) return;
      setState({ status, machines: [], error: status.error, busy: true });
      const machines = status.connected ? (await api.machines(serverId)).machines : [];
      if (current === generation.current) setState({ status, machines, error: status.error, busy: false });
    } catch (error) {
      if (current === generation.current)
        setState((value) => ({
          ...value,
          busy: false,
          error: errorMessage(error, t("mobile.server.cloudComputers.failed")),
        }));
    } finally {
      locked.current = false;
    }
  }
  function open(url: string) {
    if (!/^https?:\/\//u.test(url)) return;
    void Linking.openURL(url).catch(() =>
      setState((value) => ({ ...value, error: t("mobile.server.cloudComputers.failed") })),
    );
  }
  return (
    <SettingsContent>
      <SettingsNote>{t("mobile.server.cloudComputers.description")}</SettingsNote>
      {state.error ? <SettingsNote>{state.error}</SettingsNote> : null}
      {!state.status ? (
        <SettingsSection>
          <SettingsRow disabled={state.busy} disclosure={false} onPress={() => void act(() => api.status(serverId))}>
            <Typography.Paragraph>{t("mobile.server.cloudComputers.refresh")}</Typography.Paragraph>
          </SettingsRow>
        </SettingsSection>
      ) : state.status.connected ? (
        <SettingsSection footer={state.status.error}>
          <SettingsRow disclosure={false}>
            <Typography.Paragraph>{t("mobile.server.cloudComputers.connected")}</Typography.Paragraph>
          </SettingsRow>
          <SettingsRow disabled={state.busy} disclosure={false} onPress={() => void act(() => api.test(serverId))}>
            <Typography.Paragraph>{t("mobile.server.cloudComputers.test")}</Typography.Paragraph>
          </SettingsRow>
          <SettingsRow
            disabled={state.busy}
            disclosure={false}
            onPress={() => void act(() => api.disconnect(serverId))}
          >
            <Typography.Paragraph>{t("mobile.server.cloudComputers.disconnect")}</Typography.Paragraph>
          </SettingsRow>
        </SettingsSection>
      ) : (
        <>
          <SheetFormField
            label={t("mobile.server.cloudComputers.apiKey")}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            maxLength={4096}
            value={key}
            editable={!state.busy}
            onChangeText={setKey}
          />
          <SettingsSection>
            <SettingsRow
              disabled={state.busy || !key.trim()}
              disclosure={false}
              onPress={() => {
                const input = key.trim();
                setKey("");
                void act(() => api.connect(input, serverId));
              }}
            >
              <Typography.Paragraph>{t("mobile.server.cloudComputers.connect")}</Typography.Paragraph>
            </SettingsRow>
            <SettingsRow onPress={() => open("https://computer.mcpbox.dev/keys")}>
              <Typography.Paragraph>{t("mobile.server.cloudComputers.getKey")}</Typography.Paragraph>
            </SettingsRow>
          </SettingsSection>
        </>
      )}
      {state.status?.connected ? (
        <SettingsSection title={t("mobile.server.cloudComputers.title")}>
          <SettingsRow disabled={state.busy} disclosure={false} onPress={() => void act(() => api.status(serverId))}>
            <Typography.Paragraph>{t("mobile.server.cloudComputers.refresh")}</Typography.Paragraph>
          </SettingsRow>
          {state.machines.length ? (
            state.machines.map((machine) => (
              <SettingsRow
                key={machine.id}
                disclosure={Boolean(machine.liveViewUrl)}
                onPress={machine.liveViewUrl ? () => open(machine.liveViewUrl ?? "") : undefined}
              >
                <Typography.Paragraph>{machine.context}</Typography.Paragraph>
                <Typography.Paragraph className="text-grouped-secondary">{machine.status}</Typography.Paragraph>
              </SettingsRow>
            ))
          ) : (
            <SettingsNote>{t("mobile.server.cloudComputers.empty")}</SettingsNote>
          )}
        </SettingsSection>
      ) : null}
    </SettingsContent>
  );
}
