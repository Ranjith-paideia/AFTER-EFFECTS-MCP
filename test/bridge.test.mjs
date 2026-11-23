import test from "node:test";
import assert from "node:assert/strict";
import { buildScript } from "../dist/aeBridge.js";

test("buildScript creates an ES3-only undo-grouped result-file payload", () => {
  const userScript = 'var value = "hello";\nvalue;';
  const script = buildScript(userScript, "C:\\temp\\ae result.json", "req-1");

  assert.match(script, /app\.beginUndoGroup/);
  assert.match(script, /app\.endUndoGroup/);
  assert.match(script, /C:\\\\temp\\\\ae result\.json/);
  assert.doesNotMatch(script, /\blet\b|\bconst\b|=>|\b\.map\(|\b\.filter\(|\b\.forEach\(|\bObject\.(keys|entries)\(/);
});

test("buildScript serializes quotes, Unicode, and Windows paths safely", () => {
  const script = buildScript('throw new Error("test");', "C:\\Users\\A & B\\result.json", "quote-\"-id");
  assert.doesNotMatch(script, /C:\\Users\\A & B\\result\.json/);
  assert.match(script, /C:\\\\Users\\\\A & B\\\\result\.json/);
  assert.match(script, /quote-\\"-id/);
});
