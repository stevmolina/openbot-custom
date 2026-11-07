// What main answers for Computer Use: its state, its permissions, and where to draw the highlight.
//
// Each decoder checks every field the contract type requires and keeps each optional field it
// carries, so a value the renderer reads always has the shape its type says.

import {
  COMPUTER_USE_STATUSES,
  type ComputerUseAgentCursorPlacement,
  type ComputerUseCoveredArea,
  type ComputerUseHighlightPlacement,
  type ComputerUsePermission,
  type ComputerUsePermissionApp,
  type ComputerUseState,
} from "@openbot/contracts/ipc";
import { isDynamicRecord, isOneOf, isString } from "@openbot/contracts/runtime-values";

export function decodeComputerUseState(value: unknown): ComputerUseState {
  if (
    !isDynamicRecord(value) ||
    !isOneOf(COMPUTER_USE_STATUSES, value.status) ||
    !Array.isArray(value.permissions) ||
    (value.message !== null && !isString(value.message))
  ) {
    throw new Error("Invalid Computer Use state.");
  }
  return {
    status: value.status,
    permissions: value.permissions.map(decodeComputerUsePermission),
    message: value.message,
  };
}

/** The longest agent name a cursor shows. A longer one is cut, so a label cannot cover the screen. */
const MAX_CURSOR_LABEL_LENGTH = 80;
/** A colour the overlay can put in a style unchanged: `#` and three, six or eight hex digits. */
const CURSOR_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

function decodeComputerUseAgentCursor(value: unknown): ComputerUseAgentCursorPlacement {
  if (
    !isDynamicRecord(value) ||
    typeof value.x !== "number" ||
    typeof value.y !== "number" ||
    !isString(value.id) ||
    !isString(value.label) ||
    (value.color !== null && !(isString(value.color) && CURSOR_COLOR.test(value.color)))
  ) {
    throw new Error("Invalid Computer Use highlight placement.");
  }
  return {
    id: value.id,
    x: value.x,
    y: value.y,
    label: value.label.slice(0, MAX_CURSOR_LABEL_LENGTH),
    color: value.color,
  };
}

export function decodeComputerUseHighlightPlacement(value: unknown): ComputerUseHighlightPlacement {
  if (
    !isDynamicRecord(value) ||
    typeof value.x !== "number" ||
    typeof value.y !== "number" ||
    typeof value.width !== "number" ||
    typeof value.height !== "number" ||
    typeof value.cornerRadius !== "number" ||
    typeof value.windowTitle !== "string" ||
    !Array.isArray(value.cursors) ||
    !Array.isArray(value.covered)
  ) {
    throw new Error("Invalid Computer Use highlight placement.");
  }
  return {
    x: value.x,
    y: value.y,
    width: value.width,
    height: value.height,
    cornerRadius: value.cornerRadius,
    windowTitle: value.windowTitle,
    cursors: value.cursors.map(decodeComputerUseAgentCursor),
    covered: value.covered.map(decodeComputerUseCoveredArea),
  };
}

function decodeComputerUseCoveredArea(value: unknown): ComputerUseCoveredArea {
  if (
    !isDynamicRecord(value) ||
    typeof value.x !== "number" ||
    typeof value.y !== "number" ||
    typeof value.width !== "number" ||
    typeof value.height !== "number"
  ) {
    throw new Error("Invalid Computer Use highlight placement.");
  }
  return { x: value.x, y: value.y, width: value.width, height: value.height };
}

export function decodeComputerUsePermissionApp(value: unknown): ComputerUsePermissionApp | null {
  if (value === null) return null;
  if (
    !isDynamicRecord(value) ||
    !isString(value.name) ||
    (value.iconDataUrl !== null && !isString(value.iconDataUrl))
  ) {
    throw new Error("Invalid Computer Use application.");
  }
  return { name: value.name, iconDataUrl: value.iconDataUrl };
}

function decodeComputerUsePermission(value: unknown): ComputerUsePermission {
  if (
    !isDynamicRecord(value) ||
    !isOneOf(["screen-recording", "accessibility"] as const, value.id) ||
    typeof value.granted !== "boolean"
  ) {
    throw new Error("Invalid Computer Use permission.");
  }
  return { id: value.id, granted: value.granted };
}
