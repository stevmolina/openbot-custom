// A Claude chat can ask for a claude.ai artifact on one message. The mark travels inside the
// message text, because the released message body cannot grow a field. The host removes the mark
// before it stores the chat. An older host has no capability, so a client does not send the mark.
export const CLAUDE_ARTIFACT_REQUEST_CAPABILITY = "claude-artifact-request-v1";
