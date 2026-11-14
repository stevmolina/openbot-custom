import { isConnectorId } from "@openbot/ui/features/connectors/connectors";
import { MARKETPLACE_PLUGIN_SLUGS } from "../settings/marketplace-plugin-slugs";

/**
 * True when this client can draw a card for the app: a catalog plugin, or a connector. It is apart from
 * the card, which loads with the connector panels only when a chat shows one.
 */
export function marketplaceSuggestionKnown(appId: string): boolean {
  return isConnectorId(appId) || MARKETPLACE_PLUGIN_SLUGS.includes(appId);
}
