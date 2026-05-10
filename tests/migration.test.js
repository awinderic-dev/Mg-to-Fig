import test from "node:test";
import assert from "node:assert/strict";

import { exportFromMasterGo } from "../plugins/mastergo/src/exporter.js";
import { exportFromDslPayload } from "../plugins/mastergo/src/dsl-adapter.js";
import { buildParameterDiffReport, importToFigma } from "../plugins/figma/src/importer.js";

function createMockNode(type) {
  return {
    type,
    name: type,
    children: [],
    layoutMode: "NONE",
    primaryAxisSizingMode: "FIXED",
    counterAxisSizingMode: "FIXED",
    primaryAxisAlignItems: "MIN",
    counterAxisAlignItems: "MIN",
    layoutGrow: 0,
    layoutAlign: "INHERIT",
    x: 0,
    y: 0,
    resize(width, height) {
      this.width = width;
      this.height = height;
    },
    appendChild(child) {
      this.children.push(child);
    },
    setPluginData(key, value) {
      this.pluginData = this.pluginData ?? {};
      this.pluginData[key] = value;
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
    createComponent: () => ({
      ...createMockNode("COMPONENT"),
      createInstance() {
        return createMockNode("INSTANCE");
      }
    }),
    group: () => createMockNode("GROUP"),
    loadFontAsync: async () => undefined
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
