/**
 * Copies of one agent. Several agents can have the same name and face, such as one coder per
 * project. Nothing records which agent is a copy of which, so the name and the face decide. The
 * first agent of the list is the main one; the others are its copies. The role title of each agent
 * tells the copies apart, so it is the copy word of a row or a tab.
 */

import type { AgentProfile } from "../../data";

export interface SidebarAgentFamily {
  /** The agent that the "Agents" list shows. */
  main: AgentProfile;
  /** The main agent and its copies, in list order. */
  members: AgentProfile[];
}

function familyKey(agent: Pick<AgentProfile, "name" | "avatarSeed" | "avatarHue" | "avatarUrl">): string {
  const face = agent.avatarUrl ?? `${agent.avatarSeed}:${agent.avatarHue ?? ""}`;
  return `${agent.name.trim().toLocaleLowerCase()}\n${face}`;
}

/** The agents grouped by name and face, in the order of their first agent. */
export function sidebarAgentFamilies(agents: readonly AgentProfile[]): SidebarAgentFamily[] {
  const families = new Map<string, SidebarAgentFamily>();
  for (const agent of agents) {
    const key = familyKey(agent);
    const family = families.get(key);
    if (family) family.members.push(agent);
    else families.set(key, { main: agent, members: [agent] });
  }
  return [...families.values()];
}

/**
 * The copy word of each agent that has copies: its role title. An agent without copies, or without a
 * title, has none.
 */
export function sidebarCopyWords(agents: readonly AgentProfile[]): Map<string, string> {
  const words = new Map<string, string>();
  for (const family of sidebarAgentFamilies(agents)) {
    if (family.members.length < 2) continue;
    for (const agent of family.members) {
      const title = agent.title.trim();
      if (title) words.set(agent.id, title);
    }
  }
  return words;
}
