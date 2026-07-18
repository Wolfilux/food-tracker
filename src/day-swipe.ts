export type SwipeIntent = "pending" | "horizontal" | "vertical";

export const swipeIntentDistance = 10;
export const swipeDistance = 64;
export const swipeIntentRatio = 1.25;
export const swipeCompletionRatio = 1.35;

export function classifySwipeIntent(
  deltaX: number,
  deltaY: number,
  currentIntent: SwipeIntent = "pending",
): SwipeIntent {
  if (currentIntent !== "pending") return currentIntent;

  const horizontalDistance = Math.abs(deltaX);
  const verticalDistance = Math.abs(deltaY);

  if (horizontalDistance < swipeIntentDistance && verticalDistance < swipeIntentDistance) {
    return "pending";
  }

  if (horizontalDistance > verticalDistance * swipeIntentRatio) return "horizontal";
  if (verticalDistance > horizontalDistance * swipeIntentRatio) return "vertical";
  return "pending";
}

export function dayOffsetForSwipe(deltaX: number, deltaY: number): -1 | 0 | 1 {
  const horizontalDistance = Math.abs(deltaX);
  const verticalDistance = Math.abs(deltaY);

  if (
    horizontalDistance < swipeDistance
    || horizontalDistance <= verticalDistance * swipeCompletionRatio
  ) {
    return 0;
  }

  return deltaX < 0 ? 1 : -1;
}
