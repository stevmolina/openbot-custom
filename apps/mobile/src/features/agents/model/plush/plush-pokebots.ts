import { avatarHeadColor } from "@openbot/brand/bloub-avatar";
import { type PokebotsAccessoryPart, pokebotsAccessory, pokebotsAccessoryParts } from "@openbot/brand/pokebots-avatar";
import type { AvatarColor, AvatarHue } from "@openbot/contracts/ipc";
import { PaintStyle, type SkCanvas, Skia, StrokeCap, StrokeJoin } from "@shopify/react-native-skia";
import { plushGeometry } from "./plush-frames";

/*
 * Pokebots: the brand look of the plush, as the desktop draws it (`PokebotsAccessory` and
 * `pokebots-avatar.css` in `@openbot/ui`). The accessory comes from the seed, so the phone shows the
 * one that the desktop shows.
 */

/** The accessory layers of a plush face, in the frame of `drawPlush`. */
export function plushAccessoryParts(
  seed: string,
  hue: AvatarHue | null,
  color: AvatarColor | null,
): readonly PokebotsAccessoryPart[] {
  const { shape } = plushGeometry(seed);
  return pokebotsAccessoryParts(pokebotsAccessory(seed), shape, avatarHeadColor(seed, hue, color));
}

/** The name segment of a face's accessory, so a saved picture changes with it. */
export function plushAccessoryKey(seed: string): string {
  return pokebotsAccessory(seed);
}

/** Darkens the felt eye pads, as the desktop does, so the eyes are dark like the mascots' eyes. */
export const POKEBOTS_EYE_DARKEN = 0.14;

/** Draws the accessory in the frame of `drawPlush`: the plush view box, centred. */
export function drawPokebotsAccessory(canvas: SkCanvas, parts: readonly PokebotsAccessoryPart[]) {
  "worklet";
  for (const part of parts) {
    const path = Skia.Path.MakeFromSVGString(part.d);
    if (!path) continue;
    const paint = Skia.Paint();
    paint.setAntiAlias(true);
    if (part.fill) {
      paint.setStyle(PaintStyle.Fill);
      paint.setColor(Skia.Color(part.fill));
      paint.setAlphaf(part.opacity ?? 1);
      canvas.drawPath(path, paint);
    }
    if (part.stroke) {
      const stroke = Skia.Paint();
      stroke.setAntiAlias(true);
      stroke.setStyle(PaintStyle.Stroke);
      stroke.setStrokeCap(StrokeCap.Round);
      stroke.setStrokeJoin(StrokeJoin.Round);
      stroke.setStrokeWidth(part.strokeWidth ?? 1);
      stroke.setColor(Skia.Color(part.stroke));
      stroke.setAlphaf(part.opacity ?? 1);
      if (part.dash) {
        const intervals = part.dash.split(" ").map(Number);
        const effect = Skia.PathEffect.MakeDash(intervals, 0);
        if (effect) stroke.setPathEffect(effect);
      }
      canvas.drawPath(path, stroke);
    }
  }
}
