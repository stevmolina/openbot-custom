import { avatarHeadColor } from "@openbot/brand/bloub-avatar";
import { type PokebotsAccessoryPart, pokebotsAccessory, pokebotsAccessoryParts } from "@openbot/brand/pokebots-avatar";
import type { AvatarColor, AvatarHue } from "@openbot/contracts/ipc";
import {
  PaintStyle,
  type SkCanvas,
  Skia,
  type SkPaint,
  type SkPath,
  StrokeCap,
  StrokeJoin,
} from "@shopify/react-native-skia";
import { plushGeometry } from "./plush-frames";

/*
 * Pokebots: the brand look of the plush, as the desktop draws it (`PokebotsAccessory` and
 * `pokebots-avatar.css` in `@openbot/ui`). The accessory comes from the seed, so the phone shows the
 * one that the desktop shows.
 */

/** One layer of an accessory, ready to draw: its path and paint are built once, not on each frame. */
export interface PlushAccessoryLayer {
  path: SkPath;
  paint: SkPaint;
}

/** The accessory of a plush face, in the frame of `drawPlush`. It runs on the JS thread. */
export function plushAccessoryLayers(
  seed: string,
  hue: AvatarHue | null,
  color: AvatarColor | null,
): readonly PlushAccessoryLayer[] {
  const { shape } = plushGeometry(seed);
  const parts = pokebotsAccessoryParts(pokebotsAccessory(seed), shape, avatarHeadColor(seed, hue, color));
  return parts.flatMap(accessoryLayers);
}

/** The name segment of a face's accessory, so a saved picture changes with it. */
export function plushAccessoryKey(seed: string): string {
  return pokebotsAccessory(seed);
}

/** Darkens the felt eye pads, as the desktop does, so the eyes are dark like the mascots' eyes. */
export const POKEBOTS_EYE_DARKEN = 0.14;

/** Draws the accessory in the frame of `drawPlush`: the plush view box, centred. */
export function drawPokebotsAccessory(canvas: SkCanvas, layers: readonly PlushAccessoryLayer[]) {
  "worklet";
  for (const layer of layers) canvas.drawPath(layer.path, layer.paint);
}

function accessoryLayers(part: PokebotsAccessoryPart): PlushAccessoryLayer[] {
  const path = Skia.Path.MakeFromSVGString(part.d);
  if (!path) return [];
  const layers: PlushAccessoryLayer[] = [];
  if (part.fill) {
    const paint = Skia.Paint();
    paint.setAntiAlias(true);
    paint.setStyle(PaintStyle.Fill);
    paint.setColor(Skia.Color(part.fill));
    paint.setAlphaf(part.opacity ?? 1);
    layers.push({ path, paint });
  }
  if (part.stroke) {
    const paint = Skia.Paint();
    paint.setAntiAlias(true);
    paint.setStyle(PaintStyle.Stroke);
    paint.setStrokeCap(StrokeCap.Round);
    paint.setStrokeJoin(StrokeJoin.Round);
    paint.setStrokeWidth(part.strokeWidth ?? 1);
    paint.setColor(Skia.Color(part.stroke));
    paint.setAlphaf(part.opacity ?? 1);
    if (part.dash) paint.setPathEffect(Skia.PathEffect.MakeDash(part.dash.split(" ").map(Number), 0));
    layers.push({ path, paint });
  }
  return layers;
}
