import * as TooltipPrimitive from "@kobalte/core/tooltip";

// The tooltip parts that complex.tsx exports. They stay in this file, so `Button` (through
// tooltip.tsx) loads the tooltip without the menus, selects and dialogs of complex.tsx.

interface TooltipApi {
  Root: typeof TooltipPrimitive.Root;
  Portal: typeof TooltipPrimitive.Portal;
  Trigger: typeof TooltipPrimitive.Trigger;
  Content: typeof TooltipPrimitive.Content;
}

export const Tooltip: TooltipApi = {
  Root: (props) => <TooltipPrimitive.Root {...props} />,
  Portal: (props) => <TooltipPrimitive.Portal {...props} />,
  Trigger: (props) => <TooltipPrimitive.Trigger {...props} />,
  Content: (props) => <TooltipPrimitive.Content {...props} />,
};
