import test from "node:test";
import assert from "node:assert/strict";
import { parseCommand } from "../src/guidance/commands";

test("recognizes useful physical-task commands and synonyms", () => {
  for (const text of ["done", "I moved it", "next step please", "finished"])
    assert.equal(parseCommand(text), "next");
  assert.equal(parseCommand("that spot is taken"), "blocked");
  assert.equal(parseCommand("I can’t lift this"), "immovable");
  assert.equal(parseCommand("please re-measure"), "remeasure");
  assert.equal(parseCommand("check the photo"), "check");
  assert.equal(parseCommand("go back"), "back");
});
test("pause and help take precedence over progression", () => {
  assert.equal(parseCommand("pause before the next step"), "pause");
  assert.equal(parseCommand("I need help with the next step"), "help");
  assert.equal(parseCommand("I'm overwhelmed"), "pause");
  assert.equal(parseCommand("unrelated conversation"), "unknown");
});
