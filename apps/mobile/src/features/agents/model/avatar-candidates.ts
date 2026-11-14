import type { ExpressionId } from "@norbert_bodziony/bloub";
import {
  AVATAR_EXPRESSIONS,
  type AvatarStyle,
  avatarCandidateSeeds,
  avatarSeedForFace,
  SUPPORTED_AVATAR_SILHOUETTES,
  type SupportedAvatarSilhouetteId,
} from "@openbot/brand/bloub-avatar";

interface AvatarCandidates {
  namespace: string;
  batch: number;
  seeds: string[];
}

export function createAvatarCandidates(seed: string, previous?: AvatarCandidates): AvatarCandidates {
  const namespace = previous?.namespace ?? seed;
  const batch = previous ? previous.batch + 1 : 0;
  return { namespace, batch, seeds: avatarCandidateSeeds(namespace, seed, batch) };
}

export type AvatarFace = { shape: SupportedAvatarSilhouetteId; expression: ExpressionId };

/**
 * The explicit seed that draws the chosen face, including when it matches the default geometry.
 */
export function avatarSeedForStyledFace(faceKey: string, face: AvatarFace, style: AvatarStyle): string {
  return avatarSeedForFace(faceKey, face, style);
}

/** Another shape and other eyes, never the ones the face has now, as the desktop Random face. */
export function randomAvatarFace(current: AvatarFace): AvatarFace {
  return {
    shape: randomOther(SUPPORTED_AVATAR_SILHOUETTES, current.shape),
    expression: randomOther(AVATAR_EXPRESSIONS, current.expression),
  };
}

function randomOther<T>(items: readonly T[], current: T): T {
  const others = items.filter((item) => item !== current);
  return others[Math.floor(Math.random() * others.length)] ?? current;
}
