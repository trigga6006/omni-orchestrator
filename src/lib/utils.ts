import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import {
  Hexagon,
  Orbit,
  Diamond,
  Pentagon,
  Octagon,
  Gem,
  Compass,
  Aperture,
  Fingerprint,
  Radar,
  Shield,
  Waypoints,
  type LucideIcon,
} from "lucide-react";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/* ------------------------------------------------------------------ */
/* Icon pools for nodes and agents                                      */
/* ------------------------------------------------------------------ */

/** Abstract icons assigned to nodes (deterministic by index). */
const NODE_ICONS: LucideIcon[] = [
  Hexagon,
  Diamond,
  Pentagon,
  Octagon,
  Compass,
  Aperture,
  Gem,
  Shield,
  Fingerprint,
  Radar,
  Orbit,
  Waypoints,
];

/** Get the abstract icon for a node by its index (stable across renders). */
export function getNodeIcon(index: number): LucideIcon {
  return NODE_ICONS[index % NODE_ICONS.length];
}

/** Claude logo used as the agent icon everywhere. */
export { default as AgentIcon } from "../components/ClaudeIcon";

export function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function formatRelative(iso: string): string {
  const now = Date.now();
  const then = new Date(iso).getTime();
  const diff = now - then;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return new Date(iso).toLocaleDateString();
}

export function truncatePath(p: string, maxLen = 40): string {
  if (p.length <= maxLen) return p;
  const parts = p.replace(/\\/g, "/").split("/");
  if (parts.length <= 2) return "..." + p.slice(-maxLen);
  return parts[0] + "/.../" + parts.slice(-2).join("/");
}
