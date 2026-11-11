import { SheetPageStack } from "@/shared/components/sheet-page-stack";

export const unstable_settings = { anchor: "index" };

/** The page sets its title, the server's name. Empty until then, so the route name never shows. */
export default function McpSignInLayout() {
  return <SheetPageStack title="" />;
}
