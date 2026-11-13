/**
 * The mark of a server that has no logo: a plush machine of the Pokebots family on a dark tile, like
 * the plush on this computer's mark. The server id picks the machine, so a server keeps the same one
 * on every screen and after a restart.
 *
 * The tile uses the paper ink, which does not change with the theme, so a server looks the same in
 * light and dark. The picture fills the tile at every size, from the 14px mark at the end of a chat
 * row to the 40px rail button.
 */

import allMachines from "./assets/machines/all-machines.webp";
import serverMint from "./assets/machines/server-mint.webp";
import serverOrange from "./assets/machines/server-orange.webp";
import serverPink from "./assets/machines/server-pink.webp";
import serverPurple from "./assets/machines/server-purple.webp";

/** No blue machine: blue is the plush of this computer. */
const MACHINE_MASCOTS = [serverMint, serverOrange, serverPurple, serverPink] as const;

/** The plush machine of a server: the same id always gives the same picture. */
export function serverMascotUrl(serverId: string): string {
  let hash = 0;
  for (let index = 0; index < serverId.length; index += 1) {
    hash = (Math.imul(hash, 31) + serverId.charCodeAt(index)) >>> 0;
  }
  return MACHINE_MASCOTS[hash % MACHINE_MASCOTS.length] ?? serverMint;
}

function MascotTile(props: { src: string }) {
  return (
    <span class="ui-server-gradient-logo ui-server-mascot" aria-hidden="true">
      <img class="ui-server-mascot-art" src={props.src} alt="" draggable={false} />
    </span>
  );
}

export function ServerMascot(props: { serverId: string }) {
  return <MascotTile src={serverMascotUrl(props.serverId)} />;
}

/** The mark of the "All machines" view: three plush machines together, as a sign for "every server". */
export function AllMachinesMark() {
  return <MascotTile src={allMachines} />;
}
