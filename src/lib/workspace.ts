/**
 * Workspace persistence — save/load node graphs + agent configs to JSON files.
 * Agent sessions can be resumed via Claude Code's --resume <sessionId> flag.
 */

import { invoke } from "@tauri-apps/api/core";
import { useAppStore } from "../stores/appStore";
import { killAllAgents } from "./agentManager";
import type { AgentConfig, AgentRole, CrossSpeakLink, SwarmNode } from "../types";

// ---------------------------------------------------------------------------
// Workspace file schema
// ---------------------------------------------------------------------------

interface WorkspaceFile {
  version: 1;
  name: string;
  savedAt: string;
  currentView: "welcome" | "orchestrator" | "settings";
  nodes: SavedNode[];
  agents: SavedAgent[];
  crossSpeakLinks: SavedCrossSpeakLink[];
  settings: { autoSendMessages: boolean };
}

interface SavedNode {
  id: string;
  name: string;
  directory: string;
  color: string;
  position: [number, number, number];
  agents: string[];
}

interface SavedAgent {
  id: string;
  nodeId: string;
  name: string;
  role: AgentRole;
  cwd: string;
  sessionId: string | null;
  config: AgentConfig;
  summary: string;
  /** Display label for chat-mode agents (e.g. "Agent 1") */
  label?: string;
  /** Display color for chat-mode agents */
  color?: string;
}

interface SavedCrossSpeakLink {
  id: string;
  nodeA: string;
  nodeB: string;
}

export interface WorkspaceInfo {
  name: string;
  path: string;
  modifiedAt: string;
}

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------

function serializeWorkspace(name: string): WorkspaceFile {
  const state = useAppStore.getState();
  return {
    version: 1,
    name,
    savedAt: new Date().toISOString(),
    currentView: state.currentView,
    nodes: state.nodes.map((n) => ({
      id: n.id,
      name: n.name,
      directory: n.directory,
      color: n.color,
      position: n.position,
      agents: n.agents,
    })),
    agents: state.agents.map((a) => ({
      id: a.id,
      nodeId: a.nodeId,
      name: a.name,
      role: a.role,
      cwd: a.cwd,
      sessionId: a.sessionId,
      config: a.config,
      summary: a.summary,
    })),
    crossSpeakLinks: state.crossSpeakLinks.map((l) => ({
      id: l.id,
      nodeA: l.nodeA,
      nodeB: l.nodeB,
    })),
    settings: { autoSendMessages: state.settings.autoSendMessages },
  };
}

function deserializeWorkspace(json: string) {
  const file: WorkspaceFile = JSON.parse(json);
  if (file.version !== 1) {
    throw new Error(`Unsupported workspace version: ${file.version}`);
  }

  const nodes: SwarmNode[] = file.nodes.map((n) => ({
    ...n,
    createdAt: new Date().toISOString(),
  }));

  const agents = file.agents.map((a) => ({
    id: a.id,
    peerId: null,
    nodeId: a.nodeId,
    name: a.name,
    role: a.role,
    status: "suspended" as const,
    summary: a.summary,
    cwd: a.cwd,
    pid: null,
    messages: [],
    diff: null,
    diffs: [],
    config: a.config,
    sessionId: a.sessionId,
    createdAt: new Date().toISOString(),
    lastSeen: new Date().toISOString(),
  }));

  const crossSpeakLinks: CrossSpeakLink[] = file.crossSpeakLinks.map((l) => ({
    ...l,
    createdAt: new Date().toISOString(),
  }));

  return {
    nodes,
    agents,
    crossSpeakLinks,
    settings: { nickname: "", ...file.settings },
    workspaceName: file.name,
    currentView: file.currentView ?? "orchestrator",
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Save the current workspace to a named JSON file. */
export async function saveWorkspace(name: string): Promise<string> {
  const dir = await invoke<string>("get_workspaces_dir");
  const safeName = name.replace(/[^a-zA-Z0-9_-]/g, "_");
  const path = `${dir}/${safeName}.json`;

  const data = serializeWorkspace(name);
  await invoke("save_workspace", { path, data: JSON.stringify(data, null, 2) });

  useAppStore.getState().setWorkspaceInfo(name, path);
  useAppStore.getState().markWorkspaceClean();

  return path;
}

/** Load a workspace from a file path. Kills all running agents first. */
export async function loadWorkspace(path: string): Promise<void> {
  // Safety: kill all running agents before hydrating
  await killAllAgents();

  const json = await invoke<string>("load_workspace", { path });
  const data = deserializeWorkspace(json);

  useAppStore.getState().hydrateFromWorkspace({
    ...data,
    workspacePath: path,
  });

  // Re-register nodes with the broker
  for (const node of data.nodes) {
    fetch("http://127.0.0.1:7899/create-node", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: node.id, name: node.name, color: node.color }),
    }).catch(() => {});
  }
}

/** List all saved workspaces. */
export async function listWorkspaces(): Promise<WorkspaceInfo[]> {
  const results = await invoke<{ name: string; path: string; modified_at: string }[]>(
    "list_workspaces"
  );
  return results.map((r) => ({
    name: r.name,
    path: r.path,
    modifiedAt: r.modified_at,
  }));
}

/** Delete a workspace file. */
export async function deleteWorkspace(path: string): Promise<void> {
  await invoke("delete_workspace", { path });
}

// ---------------------------------------------------------------------------
// App settings persistence (nickname, preferences — survives across sessions)
// ---------------------------------------------------------------------------

/** Save the current app settings to disk. */
export async function saveAppSettings(): Promise<void> {
  const { settings } = useAppStore.getState();
  await invoke("save_app_settings", { data: JSON.stringify(settings) });
}

/** Load app settings from disk and merge into the store. */
export async function loadAppSettings(): Promise<void> {
  try {
    const json = await invoke<string>("load_app_settings");
    const saved = JSON.parse(json);
    if (saved && typeof saved === "object") {
      useAppStore.getState().updateSettings(saved);
    }
  } catch {
    // No saved settings yet — that's fine
  }
}
