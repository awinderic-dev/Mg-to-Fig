import test from "node:test";
import assert from "node:assert/strict";

import { exportFromMasterGo } from "../plugins/mastergo/src/exporter.js";
import { exportFromDslPayload } from "../plugins/mastergo/src/dsl-adapter.js";
import {
  buildFontPreflightReport,
  buildImportPreflightReport,
  buildParameterDiffReport,
  createImportSession,
  importToFigma
} from "../plugins/figma/src/importer.js";
import { postprocessMasterGoNodes } from "../plugins/figma/src/postprocess.js";

function createMockNode(type) {
  return {
    type,
    name: type,
    children: [],
    layoutMode: "NONE",
    layoutWrap: "NO_WRAP",
    primaryAxisSizingMode: "FIXED",
    counterAxisSizingMode: "FIXED",
    primaryAxisAlignItems: "MIN",
    counterAxisAlignItems: "MIN",
    counterAxisAlignContent: "AUTO",
    layoutSizingHorizontal: "FIXED",
    layoutSizingVertical: "FIXED",
    layoutGrow: 0,
    layoutAlign: "INHERIT",
    layoutPositioning: "AUTO",
    itemSpacing: 0,
    counterAxisSpacing: 0,
    paddingTop: 0,
    paddingRight: 0,
    paddingBottom: 0,
    paddingLeft: 0,
    fills: [],
    strokes: [],
    effects: [],
    opacity: 1,
    cornerRadius: 0,
    x: 0,
    y: 0,
    resize(width, height) {
      this.width = width;
      this.height = height;
    },
    appendChild(child) {
      this.children.push(child);
      child.parent = this;
    },
    insertChild(index, child) {
      const existing = this.children.indexOf(child);
      if (existing !== -1) this.children.splice(existing, 1);
      this.children.splice(index, 0, child);
      child.parent = this;
    },
    setPluginData(key, value) {
      this.pluginData = this.pluginData ?? {};
      this.pluginData[key] = value;
    },
    getPluginData(key) {
      return this.pluginData?.[key] ?? "";
    },
    findAll(predicate) {
      const found = [];
      const visit = (current) => {
        for (const child of current.children ?? []) {
          if (predicate(child)) found.push(child);
          visit(child);
        }
      };
      visit(this);
      return found;
    },
    remove() {
      this.removed = true;
    }
  };
}

function setupFigmaMock() {
  globalThis.figma = {
    currentPage: createMockNode("PAGE"),
    createFrame: () => createMockNode("FRAME"),
    createText: () => ({ ...createMockNode("TEXT"), characters: "" }),
    createRectangle: () => createMockNode("RECTANGLE"),
    createVector: () => createMockNode("VECTOR"),
    createImage: () => ({ hash: "inline-image-hash" }),
    createImageAsync: async () => ({ hash: "remote-image-hash" }),
    createComponent: () => ({
      ...createMockNode("COMPONENT"),
      createInstance() {
        return createMockNode("INSTANCE");
      }
    }),
    group: () => createMockNode("GROUP"),
    loadFontAsync: async () => undefined,
    listAvailableFontsAsync: async () => [
      { fontName: { family: "Inter", style: "Regular" } },
      { fontName: { family: "PingFang SC", style: "Regular" } }
    ]
  };
}

test("exportFromMasterGo should build document with components and tokens", () => {
  const roots = [
    {
      id: "root",
      type: "FRAME",
      name: "Root",
      children: [
        {
          id: "button_component",
          type: "COMPONENT",
          name: "Button",
          children: [],
          tokenRefs: [{ tokenId: "t1", path: "color.brand.primary", resolvedValue: "#3366FF", kind: "color" }]
        },
        {
          id: "button_instance",
          type: "INSTANCE",
          name: "Button/Default",
          mainComponentId: "button_component",
          children: [],
          tokenRefs: [{ tokenId: "t1", path: "color.brand.primary", resolvedValue: "#3366FF", kind: "color" }]
        }
      ]
    }
  ];

  const { document, validation } = exportFromMasterGo({
    roots,
    documentMeta: {
      sourceFileId: "file-1",
      sourcePageId: "page-1",
      sourcePageName: "Page 1"
    }
  });

  assert.equal(validation.valid, true);
  assert.equal(document.tokens.length, 1);
  assert.equal(document.nodes.some((n) => n.type === "COMPONENT"), true);
  assert.equal(document.nodes.some((n) => n.type === "INSTANCE"), true);
});

test("importToFigma should import nodes and keep token trace", async () => {
  setupFigmaMock();

  const { document } = exportFromMasterGo({
    roots: [
      {
        id: "root",
        type: "FRAME",
        name: "Root",
        children: [
          {
            id: "text1",
            type: "TEXT",
            name: "Title",
            characters: "Hello",
            fontFamily: "PingFang SC",
            fontStyle: "Regular",
            fontSize: 18,
            lineHeight: 24,
            children: [],
            tokenRefs: [{ tokenId: "t2", path: "typography.title", resolvedValue: 18, kind: "number" }]
          }
        ]
      }
    ]
  });

  const result = await importToFigma({
    document,
    fontRuleSet: {
      exact: {
        "PingFang SC:Regular": { family: "PingFang SC", style: "Regular" }
      },
      family: {}
    }
  });

  assert.ok(result.createdNodes.length >= 2);
  assert.equal(result.batch.imported, result.createdNodes.length);
  assert.ok(result.diffReport.comparedCount >= 1);
  const importedText = result.createdNodes.find((node) => node.name === "Title");
  assert.ok(importedText);
  assert.equal(importedText.pluginData.mgSourceNodeId, "text1");
  assert.ok(importedText.pluginData.mgTokenRefs.includes("typography.title"));
});

test("importToFigma should support batch import", async () => {
  setupFigmaMock();
  const { document } = exportFromMasterGo({
    roots: [
      {
        id: "root",
        type: "FRAME",
        name: "Root",
        children: [
          { id: "child1", type: "FRAME", name: "Child 1", children: [] },
          { id: "child2", type: "FRAME", name: "Child 2", children: [] }
        ]
      }
    ]
  });

  const result = await importToFigma({
    document,
    batch: { offset: 0, limit: 2 }
  });

  assert.equal(result.batch.total, 3);
  assert.equal(result.batch.imported, 2);
  assert.equal(result.createdNodes.length, 2);
});

test("exportFromMasterGo should collect image URL fills into assets", () => {
  const { document, validation } = exportFromMasterGo({
    roots: [
      {
        id: "image-card",
        type: "RECTANGLE",
        name: "Image Card",
        fills: [{ type: "IMAGE_URL", url: "https://image-resource.mastergo.com/card.png", scaleMode: "FILL" }],
        children: []
      }
    ]
  });

  assert.equal(validation.valid, true);
  assert.equal(document.assets.length, 1);
  assert.equal(document.assets[0].transport, "external");
  assert.equal(document.assets[0].uri, "https://image-resource.mastergo.com/card.png");
  assert.equal(document.nodes[0].style.fills[0].type, "IMAGE_REF");
  assert.equal(document.nodes[0].style.fills[0].assetId, document.assets[0].id);
});

test("exportFromMasterGo should normalize MasterGo image fills into assets", () => {
  const { document, validation } = exportFromMasterGo({
    roots: [
      {
        id: "image-fill",
        type: "RECTANGLE",
        name: "Image Fill",
        fills: [{
          type: "IMAGE",
          imageRef: "104581334761000/166632337784586/image.png",
          scaleMode: "FILL"
        }],
        children: []
      }
    ]
  });

  assert.equal(validation.valid, true);
  assert.equal(document.assets.length, 1);
  assert.equal(document.assets[0].uri, "https://image-resource.mastergo.com/104581334761000/166632337784586/image.png");
  assert.equal(document.nodes[0].style.fills[0].type, "IMAGE_REF");
});

test("exportFromMasterGo should prefer image fills when node raster export failed", () => {
  const { document, validation } = exportFromMasterGo({
    roots: [
      {
        id: "image-fill",
        type: "RECTANGLE",
        name: "Image Fill",
        image: { error: "export failed" },
        fills: [{
          type: "IMAGE",
          imageRef: "104581334761000/166632337784586/image.png",
          scaleMode: "FILL"
        }],
        children: []
      }
    ]
  });

  assert.equal(validation.valid, true);
  assert.equal(document.assets.length, 1);
  assert.equal(document.nodes[0].imageRef, null);
  assert.equal(document.nodes[0].style.fills[0].type, "IMAGE_REF");
  assert.equal(document.diagnostics.some((item) => item.code === "E_ASSET_MISSING"), false);
});

test("exportFromMasterGo should drop node imageRef when raster export has no usable transport", () => {
  const { document, validation } = exportFromMasterGo({
    roots: [
      {
        id: "image-fill",
        type: "RECTANGLE",
        name: "Image Fill",
        image: {
          id: "image-fill-image",
          base64: "a".repeat(130 * 1024),
          sizeBytes: 130 * 1024,
          width: 446,
          height: 262
        },
        fills: [{
          type: "IMAGE",
          imageRef: "104581334761000/166632337784586/image.png",
          scaleMode: "FILL"
        }],
        children: []
      }
    ]
  });

  assert.equal(validation.valid, true);
  assert.equal(document.nodes[0].imageRef, null);
  assert.equal(document.nodes[0].style.fills[0].type, "IMAGE_REF");
  assert.deepEqual(document.assets.map((asset) => asset.id), ["image-fill-fill-0"]);
  assert.ok(document.diagnostics.some((item) => item.assetId === "image-fill-image"));
});


test("exportFromMasterGo should skip PAGE root and keep children top-level", () => {
  const { document, validation } = exportFromMasterGo({
    roots: [
      {
        id: "M",
        type: "PAGE",
        name: "Page",
        children: [
          { id: "frame1", type: "FRAME", name: "Frame", children: [] }
        ]
      }
    ],
    documentMeta: {
      sourceFileId: 192800492121887,
      sourcePageId: "M",
      sourcePageName: "页面 1"
    }
  });

  assert.equal(validation.valid, true);
  assert.equal(document.documentMeta.sourceFileId, "192800492121887");
  assert.equal(document.nodes.length, 1);
  assert.equal(document.nodes[0].id, "frame1");
  assert.equal(document.nodes[0].parentId, null);
  assert.equal(document.diagnostics.some((item) => item.nodeId === "M"), false);
});

test("exportFromMasterGo should downgrade PEN/POLYGON raster fallbacks to images", () => {
  const { document, validation } = exportFromMasterGo({
    roots: [
      {
        id: "pen1",
        type: "PEN",
        name: "Pen Icon",
        image: {
          id: "pen1-image",
          base64: "aGVsbG8=",
          sizeBytes: 5,
          width: 16,
          height: 16
        },
        children: []
      }
    ]
  });

  assert.equal(validation.valid, true);
  assert.equal(document.nodes[0].type, "IMAGE");
  assert.equal(document.nodes[0].imageRef, "pen1-image");
  assert.equal(document.assets.length, 1);
  assert.ok(document.diagnostics.some((item) => item.message.includes("downgraded to IMAGE")));
});

test("exportFromMasterGo should keep PEN path data when available", () => {
  const { document, validation } = exportFromMasterGo({
    roots: [
      {
        id: "pen1",
        type: "PEN",
        name: "Pen Icon",
        vectorPaths: [{ windingRule: "NONZERO", data: "M0 0 L10 10" }],
        children: []
      }
    ]
  });

  assert.equal(validation.valid, true);
  assert.equal(document.nodes[0].type, "VECTOR");
  assert.equal(document.nodes[0].vectorPaths.length, 1);
  assert.ok(document.diagnostics.some((item) => item.message.includes("downgraded to VECTOR")));
});

test("exportFromMasterGo should require raster fallback for empty PEN/POLYGON", () => {
  const { document } = exportFromMasterGo({
    roots: [
      { id: "pen1", type: "PEN", name: "Empty Pen", children: [] }
    ]
  });

  assert.equal(document.nodes[0].type, "IMAGE");
  assert.equal(document.nodes[0].imageRef, null);
  assert.equal(document.nodes[0].vectorPaths.length, 0);
  assert.ok(document.diagnostics.some((item) => item.code === "E_ASSET_MISSING"));
});

test("exportFromMasterGo should not crash when raster fallback reports an error", () => {
  const { document, validation } = exportFromMasterGo({
    roots: [
      {
        id: "pen1",
        type: "PEN",
        name: "Broken Pen",
        image: { error: "exportAsync(PNG): not supported" },
        children: []
      }
    ]
  });

  assert.equal(validation.valid, true);
  assert.equal(document.nodes[0].type, "IMAGE");
  assert.equal(document.nodes[0].imageRef, null);
  assert.equal(document.assets.length, 0);
  assert.ok(document.diagnostics.some((item) => item.details.exportError.includes("not supported")));
});

test("importToFigma should resolve IMAGE_REF fills from assets", async () => {
  setupFigmaMock();
  const { document } = exportFromMasterGo({
    roots: [
      {
        id: "image-card",
        type: "RECTANGLE",
        name: "Image Card",
        fills: [{ type: "IMAGE_URL", url: "https://image-resource.mastergo.com/card.png", scaleMode: "FIT" }],
        children: []
      }
    ]
  });

  const result = await importToFigma({ document });
  const imported = result.createdNodes.find((node) => node.name === "Image Card");
  assert.ok(imported);
  assert.equal(imported.fills[0].type, "IMAGE");
  assert.equal(imported.fills[0].imageHash, "remote-image-hash");
  assert.equal(imported.fills[0].scaleMode, "FIT");
});

test("importToFigma should keep parent mapping across batch calls", async () => {
  setupFigmaMock();
  const session = createImportSession();
  const { document } = exportFromMasterGo({
    roots: [
      {
        id: "root",
        type: "FRAME",
        name: "Root",
        children: [
          { id: "child1", type: "FRAME", name: "Child 1", children: [] },
          { id: "child2", type: "FRAME", name: "Child 2", children: [] }
        ]
      }
    ]
  });

  await importToFigma({ document, batch: { offset: 0, limit: 1 }, session });
  const second = await importToFigma({ document, batch: { offset: 1, limit: 1 }, session });
  const child = second.createdNodes[0];

  assert.equal(child.name, "Child 1");
  assert.equal(child.parent.name, "Root");
});

test("buildFontPreflightReport should report fallback fonts", () => {
  const { document } = exportFromMasterGo({
    roots: [
      {
        id: "text1",
        type: "TEXT",
        name: "Title",
        characters: "Hello",
        fontFamily: "Missing Font",
        fontStyle: "Bold",
        children: []
      }
    ]
  });

  const report = buildFontPreflightReport(document, {}, [{ family: "Inter", style: "Regular" }]);

  assert.equal(report.requestedFonts.length, 1);
  assert.equal(report.fallbackCount, 1);
  assert.equal(report.requestedFonts[0].resolved.family, "Inter");
});

test("buildImportPreflightReport should flag risky assets", () => {
  const document = {
    schemaVersion: "0.1.0",
    documentMeta: {
      sourceTool: "mastergo",
      exportMode: "selection",
      exportedAt: "2026-01-01T00:00:00.000Z",
      sourceFileId: "file",
      sourcePageId: "page",
      sourcePageName: "page"
    },
    nodes: [
      {
        id: "n1",
        type: "RECTANGLE",
        name: "Image",
        children: [],
        geometry: { x: 0, y: 0, width: 10, height: 10, rotation: 0 },
        style: { fills: [{ type: "IMAGE_REF", assetId: "missing" }], strokes: [], effects: [], opacity: 1 }
      }
    ],
    assets: [
      {
        id: "large",
        type: "image",
        mimeType: "image/png",
        sizeBytes: 10,
        transport: "external",
        uri: "https://image-resource.mastergo.com/large.png",
        data: null,
        width: 5000,
        height: 100
      }
    ],
    tokens: [],
    diagnostics: []
  };

  const report = buildImportPreflightReport(document);

  assert.equal(report.nodeCount, 1);
  assert.equal(report.missingAssetRefs.length, 1);
  assert.equal(report.oversizedImageAssets.length, 1);
});

test("importToFigma should apply auto layout sizing and child grow", async () => {
  setupFigmaMock();
  const { document } = exportFromMasterGo({
    roots: [
      {
        id: "auto-root",
        type: "FRAME",
        name: "Auto Root",
        layoutMode: "AUTO",
        primaryAxisSizingMode: "FIXED",
        counterAxisSizingMode: "AUTO",
        primaryAxisAlignItems: "CENTER",
        counterAxisAlignItems: "STRETCH",
        itemSpacing: 8,
        children: [
          {
            id: "auto-child",
            type: "FRAME",
            name: "Auto Child",
            constraints: { layoutGrow: 1, layoutAlign: "STRETCH" },
            children: []
          }
        ]
      }
    ]
  });

  const result = await importToFigma({ document });
  const autoRoot = result.createdNodes.find((node) => node.name === "Auto Root");
  const autoChild = result.createdNodes.find((node) => node.name === "Auto Child");
  assert.ok(autoRoot);
  assert.ok(autoChild);
  assert.equal(autoRoot.layoutMode, "VERTICAL");
  assert.equal(autoRoot.primaryAxisAlignItems, "CENTER");
  assert.equal(autoRoot.counterAxisAlignItems, "STRETCH");
  assert.equal(autoRoot.counterAxisSizingMode, "AUTO");
  assert.equal(autoChild.layoutGrow, 1);
  assert.equal(autoChild.layoutAlign, "STRETCH");
});

test("buildParameterDiffReport should report mismatches", () => {
  const sourceNodes = [
    {
      id: "n1",
      type: "FRAME",
      geometry: { x: 0, y: 0, width: 100, height: 100 },
      style: { opacity: 1, cornerRadius: 4 }
    },
    {
      id: "n2",
      type: "TEXT",
      geometry: { x: 10, y: 10, width: 40, height: 20 },
      style: { opacity: 1 },
      text: { characters: "Hello", fontSize: 14, lineHeight: 22 }
    }
  ];

  const createdBySourceId = new Map([
    [
      "n1",
      { x: 0, y: 1, width: 100, height: 100, opacity: 0.9, cornerRadius: 8 }
    ],
    [
      "n2",
      {
        x: 10,
        y: 10,
        width: 40,
        height: 20,
        opacity: 1,
        characters: "Hell0",
        fontSize: 13,
        lineHeight: { value: 21 }
      }
    ]
  ]);

  const report = buildParameterDiffReport(sourceNodes, createdBySourceId);
  assert.equal(report.comparedCount, 2);
  assert.equal(report.mismatchCount, 2);
  assert.equal(report.missingInTarget.length, 0);
  assert.ok(report.mismatches.some((m) => m.nodeId === "n1"));
  assert.ok(report.mismatches.some((m) => m.nodeId === "n2"));
});

test("postprocessMasterGoNodes should restore layout from name markers", () => {
  const root = createMockNode("FRAME");
  root.id = "root";
  root.name = "容器[ay-vnssffffa[24][0][36][16][36][16]][cc-1]";
  root.width = 290;
  root.height = 844;
  root.layoutMode = "NONE";
  root.clipsContent = false;

  const child = createMockNode("TEXT");
  child.id = "child";
  child.name = "Title[wh-lh][tt-te]";
  child.parent = root;
  child.layoutSizingHorizontal = "FIXED";
  child.layoutSizingVertical = "FIXED";
  child.textTruncation = "DISABLED";
  root.children.push(child);

  const result = postprocessMasterGoNodes([root]);

  assert.equal(root.name, "容器");
  assert.equal(root.layoutMode, "VERTICAL");
  assert.equal(root.layoutWrap, "NO_WRAP");
  assert.equal(root.primaryAxisAlignItems, "MIN");
  assert.equal(root.counterAxisAlignItems, "MIN");
  assert.equal(root.primaryAxisSizingMode, "FIXED");
  assert.equal(root.counterAxisSizingMode, "FIXED");
  assert.equal(root.paddingTop, 36);
  assert.equal(root.paddingRight, 16);
  assert.equal(root.paddingBottom, 36);
  assert.equal(root.paddingLeft, 16);
  assert.equal(root.itemSpacing, 24);
  assert.equal(root.clipsContent, true);
  assert.equal(child.name, "Title");
  assert.equal(child.layoutSizingHorizontal, "FILL");
  assert.equal(child.layoutSizingVertical, "HUG");
  assert.equal(child.textTruncation, "ENDING");
  assert.ok(result.changed > 0);
});

test("postprocessMasterGoNodes should sort children by visual position before auto layout", () => {
  const root = createMockNode("FRAME");
  root.id = "root";
  root.name = "Stack[ay-vnssffffa[8][0][0][0][0][0]]";
  root.layoutMode = "NONE";

  const lower = createMockNode("FRAME");
  lower.id = "lower";
  lower.name = "Lower";
  lower.y = 120;
  const upper = createMockNode("FRAME");
  upper.id = "upper";
  upper.name = "Upper";
  upper.y = 20;

  root.children.push(lower, upper);
  lower.parent = root;
  upper.parent = root;

  postprocessMasterGoNodes([root], { cleanNames: false });

  assert.deepEqual(root.children.map((node) => node.id), ["upper", "lower"]);
  assert.equal(root.layoutMode, "VERTICAL");
});

test("postprocessMasterGoNodes should lift full-size mask style without touching components", () => {
  const frame = createMockNode("FRAME");
  frame.id = "frame";
  frame.name = "Card";
  frame.width = 100;
  frame.height = 80;
  frame.fills = [];
  frame.strokes = [];

  const mask = createMockNode("RECTANGLE");
  mask.id = "mask";
  mask.x = 0;
  mask.y = 0;
  mask.width = 100;
  mask.height = 80;
  mask.fills = [{ type: "SOLID", color: { r: 1, g: 0, b: 0 } }];
  mask.strokes = [{ type: "SOLID", color: { r: 0, g: 0, b: 0 } }];
  mask.cornerRadius = 8;
  mask.remove = () => {
    mask.removed = true;
  };
  frame.children.push(mask);
  mask.parent = frame;

  const component = createMockNode("INSTANCE");
  component.id = "instance";
  component.name = "Button";
  component.width = 100;
  component.height = 80;

  const componentFrame = createMockNode("FRAME");
  componentFrame.id = "component-frame";
  componentFrame.width = 100;
  componentFrame.height = 80;
  componentFrame.children.push(component);
  component.parent = componentFrame;

  const result = postprocessMasterGoNodes([frame, componentFrame]);

  assert.equal(frame.fills[0].color.r, 1);
  assert.equal(frame.strokes.length, 1);
  assert.equal(frame.cornerRadius, 8);
  assert.equal(mask.removed, true);
  assert.equal(component.removed, undefined);
  assert.ok(result.changed >= 1);
});

test("postprocessMasterGoNodes should restore effects from name markers", () => {
  const node = createMockNode("FRAME");
  node.id = "effect-frame";
  node.name = "Panel[ef-[ds][v][00000080][0][4][0][12][m]_[lb][v][8][n][e]]";
  node.effects = [];

  const result = postprocessMasterGoNodes([node], { cleanNames: false });

  assert.equal(node.effects.length, 2);
  assert.equal(node.effects[0].type, "DROP_SHADOW");
  assert.equal(node.effects[0].visible, true);
  assert.equal(node.effects[0].blendMode, "MULTIPLY");
  assert.equal(node.effects[0].offset.y, 4);
  assert.equal(node.effects[0].radius, 12);
  assert.equal(Math.round(node.effects[0].color.a * 100) / 100, 0.5);
  assert.equal(node.effects[1].type, "LAYER_BLUR");
  assert.equal(node.effects[1].radius, 8);
  assert.ok(result.changed >= 1);
});

test("exportFromDslPayload should transform MasterGo DSL format", () => {
  const dslPayload = {
    dsl: {
      styles: {
        "paint_1": { value: ["#3366FF"], token: "color.brand.primary" },
        "paint_stroke": { value: ["#E5E6EB"], token: "color.border.default" },
        "font_1": {
          value: {
            family: "Geist",
            size: 16,
            style: "{\"fontStyle\":\"Medium\"}",
            lineHeight: "24",
            letterSpacing: "auto"
          },
          token: "body-md"
        }
      },
      nodes: [
        {
          type: "FRAME",
          id: "2:1",
          name: "Artboard",
          flexContainerInfo: { flexDirection: "column", gap: "8px", padding: "16px 12px" },
          layoutStyle: { width: 390, height: 844, relativeX: 0, relativeY: 0 },
          fill: "paint_1",
          children: [
            {
              type: "TEXT",
              id: "2:2",
              name: "Title",
              layoutStyle: { width: 120, height: 24, relativeX: 16, relativeY: 20 },
              text: [{ text: "Hello", font: "font_1" }],
              textColor: [{ start: 0, end: 5, color: "paint_1" }],
              textAlign: "left",
              textMode: "single-line",
              children: []
            },
            {
              type: "PATH",
              id: "2:3",
              name: "Icon",
              layoutStyle: { width: 16, height: 16, relativeX: 20, relativeY: 60 },
              strokeColor: "paint_stroke",
              strokeWidth: "1px",
              path: [{ fill: "paint_1", data: "M0,0L10,0L10,10L0,10Z" }],
              children: []
            }
          ]
        }
      ]
    }
  };

  const { document, validation } = exportFromDslPayload({
    dslPayload,
    documentMeta: {
      sourceFileId: "file-real",
      sourcePageId: "2:1",
      sourcePageName: "Artboard"
    }
  });

  assert.equal(validation.valid, true);
  assert.equal(document.nodes.length, 3);
  assert.ok(document.tokens.find((token) => token.path === "color.brand.primary"));
  const frameNode = document.nodes.find((node) => node.id === "2:1");
  const textNode = document.nodes.find((node) => node.id === "2:2" && node.type === "TEXT");
  const vectorNode = document.nodes.find((node) => node.id === "2:3" && node.type === "VECTOR");
  assert.ok(frameNode);
  assert.ok(textNode);
  assert.ok(vectorNode);
  assert.equal(frameNode.layout.mode, "autoLayout");
  assert.equal(frameNode.layout.itemSpacing, 8);
  assert.equal(frameNode.layout.padding.top, 16);
  assert.equal(frameNode.layout.padding.left, 12);
  assert.equal(frameNode.layout.primaryAxisSizingMode, "FIXED");
  assert.equal(frameNode.layout.counterAxisSizingMode, "FIXED");
  assert.equal(vectorNode.style.strokeWeight, 1);
  assert.equal(vectorNode.vectorPaths.length, 1);
});

test("exportFromDslPayload should preserve fixed outer frame with nested auto layout container", () => {
  const dslPayload = {
    dsl: {
      styles: {
        "paint_bg": { value: ["#F2F2F2"] },
        "paint_overlay": { value: ["rgba(0, 0, 0, 0.5)"] },
        "paint_panel": { value: ["#FFFFFF"] }
      },
      nodes: [
        {
          type: "FRAME",
          id: "6:1074",
          name: "Outer",
          layoutStyle: { width: 390, height: 844, relativeX: 0, relativeY: 0 },
          fill: "paint_bg",
          children: [
            {
              type: "LAYER",
              id: "6:1937",
              name: "Overlay",
              layoutStyle: { width: 390, height: 844, relativeX: 0, relativeY: 0 },
              fill: "paint_overlay",
              children: []
            },
            {
              type: "FRAME",
              id: "6:1077",
              name: "Container",
              layoutStyle: { width: 290, height: 844, relativeX: 0, relativeY: 0 },
              fill: "paint_panel",
              flexContainerInfo: {
                flexDirection: "column",
                mainSizing: "fixed",
                crossSizing: "fixed",
                gap: "24px",
                padding: "36px 16px"
              },
              children: []
            }
          ]
        }
      ]
    }
  };

  const { document, validation } = exportFromDslPayload({ dslPayload });
  assert.equal(validation.valid, true);

  const outer = document.nodes.find((node) => node.id === "6:1074");
  const overlay = document.nodes.find((node) => node.id === "6:1937");
  const container = document.nodes.find((node) => node.id === "6:1077");

  assert.ok(outer);
  assert.ok(overlay);
  assert.ok(container);

  assert.equal(outer.type, "FRAME");
  assert.equal(outer.layout.mode, "none");
  assert.equal(outer.geometry.width, 390);
  assert.equal(outer.geometry.height, 844);
  assert.deepEqual(outer.children, ["6:1937", "6:1077"]);

  assert.equal(overlay.type, "RECTANGLE");
  assert.equal(overlay.parentId, "6:1074");
  assert.equal(overlay.geometry.width, 390);
  assert.equal(overlay.geometry.height, 844);
  assert.equal(overlay.style.fills[0].type, "SOLID");
  assert.equal(overlay.style.fills[0].opacity, 0.5);

  assert.equal(container.type, "FRAME");
  assert.equal(container.parentId, "6:1074");
  assert.equal(container.layout.mode, "autoLayout");
  assert.equal(container.layout.primaryAxisSizingMode, "FIXED");
  assert.equal(container.layout.counterAxisSizingMode, "FIXED");
  assert.equal(container.layout.itemSpacing, 24);
  assert.deepEqual(container.layout.padding, { top: 36, right: 16, bottom: 36, left: 16 });
});
