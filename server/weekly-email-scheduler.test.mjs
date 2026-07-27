import test from "node:test";
import assert from "node:assert/strict";
import { isSmtpDeliveryAccepted, isWeeklyEmailDue } from "./food-db.js";

test("weekly email becomes due Monday at 01:00 Berlin", () => {
  assert.equal(isWeeklyEmailDue({ weekday: "Mon", hour: 0, minute: 59 }), false);
  assert.equal(isWeeklyEmailDue({ weekday: "Mon", hour: 1, minute: 0 }), true);
});

test("mail is only marked sent when the configured recipient was accepted", () => {
  assert.equal(isSmtpDeliveryAccepted({ accepted: ["target@example.com"], rejected: [] }, "target@example.com"), true);
  assert.equal(isSmtpDeliveryAccepted({ accepted: [], rejected: ["target@example.com"] }, "target@example.com"), false);
  assert.equal(isSmtpDeliveryAccepted({ accepted: ["other@example.com"], rejected: [] }, "target@example.com"), false);
});

test("weekly email remains due after the narrow schedule window for retry and restart recovery", () => {
  assert.equal(isWeeklyEmailDue({ weekday: "Mon", hour: 14, minute: 42 }), true);
  assert.equal(isWeeklyEmailDue({ weekday: "Tue", hour: 0, minute: 1 }), true);
  assert.equal(isWeeklyEmailDue({ weekday: "Sun", hour: 23, minute: 59 }), true);
});
