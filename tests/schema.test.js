import test from "node:test";
import assert from "node:assert/strict";

import { createDocument, validateDocument } from "../packages/schema/src/index.js";

test("validateDocument should pass with minimal valid document", () => {
  const document = createDocument({
    nodes: [
      {
        id: "n1",
        type: "FRAME",
        name: "Page",
        children: [],
        geometry: { x: 0, y: 0, width: 100, height: 100, rotation: 0 },
        style: { fills: [], strokes: [], effects: [], opacity: 1, cornerRadius: 0 }
      }
    ],
    assets: [],
    tokens: [],
    diagnostics: []
  });

  const result = validateDocument(document);
  assert.equal(result.valid, true);
  assert.equal(result.errors.length, 0);
});

test("validateDocument should fail when shape is invalid", () => {
  const result = validateDocument({
    schemaVersion: "0.1.0",
    documentMeta: {},
    nodes: [{ id: 1 }]
  });

  assert.equal(result.valid, false);
  assert.ok(result.errors.length > 0);
});
