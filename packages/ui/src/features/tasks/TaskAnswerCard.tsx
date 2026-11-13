import { Button } from "@openbot/ui";
import { UiBlockCard } from "@openbot/ui/features/conversation/ui-blocks/UiBlockCard";
import { useText } from "@openbot/ui/text";
import { Show } from "solid-js";

/**
 * The card of a task whose turn waits for a question or a browser takeover. The chat answers them,
 * so the card opens the task there.
 */
export function TaskAnswerCard(props: { agentName: string; onAnswer?: (() => void) | undefined }) {
  const { t } = useText();
  return (
    <UiBlockCard
      class="tasks-panel-answer"
      status="pending"
      title={t("conversation.tasks.panel.answerTitle", { name: props.agentName })}
      waiting
      waitingLabel={t("conversation.tasks.state.waitingAnswer")}
      actions={
        <Show when={props.onAnswer}>
          {(answer) => (
            <Button type="button" size="sm" onClick={() => answer()()}>
              {t("conversation.tasks.panel.answerInChat")}
            </Button>
          )}
        </Show>
      }
    />
  );
}
