import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../src/time.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
});
const time = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);

test("formats current entry time in Europe/Berlin during daylight saving time", () => {
  assert.equal(time.toBerlinDateTimeInputValue(new Date("2026-06-23T13:06:00Z")), "2026-06-23T15:06");
});

test("formats current entry time in Europe/Berlin during standard time", () => {
  assert.equal(time.toBerlinDateTimeInputValue(new Date("2026-12-23T13:06:00Z")), "2026-12-23T14:06");
});

test("displays stored datetime-local entries without reparsing them as UTC", () => {
  assert.equal(time.formatTime("2026-06-23T15:06"), "15:06");
  assert.equal(time.formatDateTime("2026-06-23T15:06"), "23.06., 15:06");
});
