export interface Rectangle { left: number; top: number; width: number; height: number }
const overlap = (a: Rectangle, b: Rectangle) => Math.max(0, Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top));
/** Prefer a side that leaves the indicated button/field completely usable. */
export function placeTourCard(target: Rectangle | null, viewport: { width: number; height: number }, card: { width: number; height: number }, avoid?: Rectangle | null) {
  const margin = 12, gap = 18, width = Math.min(card.width, viewport.width - margin * 2), height = Math.min(card.height, viewport.height - margin * 2);
  const clamp = (left: number, top: number): Rectangle => ({ left: Math.max(margin, Math.min(left, viewport.width - width - margin)), top: Math.max(margin, Math.min(top, viewport.height - height - margin)), width, height });
  if (!target) return clamp(viewport.width - width - margin, viewport.height - height - margin);
  const cx = target.left + target.width / 2, cy = target.top + target.height / 2;
  const candidates = [clamp(target.left + target.width + gap, cy - height / 2), clamp(target.left - width - gap, cy - height / 2), clamp(cx - width / 2, target.top + target.height + gap), clamp(cx - width / 2, target.top - height - gap), clamp(margin, margin), clamp(viewport.width - width - margin, margin), clamp(margin, viewport.height - height - margin), clamp(viewport.width - width - margin, viewport.height - height - margin)];
  const padded = { left: target.left - 8, top: target.top - 8, width: target.width + 16, height: target.height + 16 };
  const score = (r: Rectangle) => overlap(r, padded) * 10000 + (avoid ? overlap(r, avoid) * 100 : 0) + Math.hypot(r.left + width / 2 - cx, r.top + height / 2 - cy);
  return candidates.sort((a, b) => score(a) - score(b))[0];
}
