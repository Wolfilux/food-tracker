import assert from "node:assert/strict";
import test from "node:test";
import {
  classifySwipeIntent,
  dayOffsetForSwipe,
  swipeDistance,
} from "../src/day-swipe.ts";

test("wartet auf eine klare Bewegungsrichtung", () => {
  assert.equal(classifySwipeIntent(5, 4), "pending");
  assert.equal(classifySwipeIntent(16, 14), "pending");
});

test("erkennt horizontale und vertikale Gesten getrennt", () => {
  assert.equal(classifySwipeIntent(18, 4), "horizontal");
  assert.equal(classifySwipeIntent(-18, 4), "horizontal");
  assert.equal(classifySwipeIntent(4, 18), "vertical");
});

test("behält eine einmal erkannte vertikale Geste bei", () => {
  assert.equal(classifySwipeIntent(80, 12, "vertical"), "vertical");
});

test("wechselt nur nach ausreichendem, klar horizontalem Swipe", () => {
  assert.equal(dayOffsetForSwipe(-swipeDistance, 8), 1);
  assert.equal(dayOffsetForSwipe(swipeDistance, 8), -1);
  assert.equal(dayOffsetForSwipe(swipeDistance - 1, 0), 0);
  assert.equal(dayOffsetForSwipe(90, 80), 0);
});
