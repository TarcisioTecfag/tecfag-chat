import type { TourTargetRect } from "@/hooks/useTourTarget";

/** DOM rects inside an iframe need its rendered scale before viewport clipping. */
export function mapTrainingRect(rect: TourTargetRect, frame: TourTargetRect, clientWidth: number, clientHeight: number): TourTargetRect | null {
  if (clientWidth <= 0 || clientHeight <= 0) return null;
  const sx = frame.width / clientWidth, sy = frame.height / clientHeight;
  const left = Math.max(frame.left, frame.left + rect.left * sx), top = Math.max(frame.top, frame.top + rect.top * sy);
  const right = Math.min(frame.right, frame.left + rect.right * sx), bottom = Math.min(frame.bottom, frame.top + rect.bottom * sy);
  return right > left && bottom > top ? { left, top, right, bottom, width: right - left, height: bottom - top } : null;
}
