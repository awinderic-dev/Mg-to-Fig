import { exportFromMasterGo } from "./exporter.js";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function serializeMgNode(node) {
  const base = {
    id: node.id,
    type: node.type,
    name: node.name,
    visible: node.visible,
    locked: node.locked,
    x: node.x,
    y: node.y,
    width: node.width,
    height: node.height,
    rotation: node.rotation,
    layoutMode: node.layoutMode,
    constraints: clone(node.constraints ?? {}),
    paddingTop: node.paddingTop,
    paddingRight: node.paddingRight,
    paddingBottom: node.paddingBottom,
    paddingLeft: node.paddingLeft,
    itemSpacing: node.itemSpacing,
    fills: clone(node.fills ?? []),
    strokes: clone(node.strokes ?? []),
    effects: clone(node.effects ?? []),
    opacity: node.opacity,
    cornerRadius: node.cornerRadius
  };

  if (node.type === "TEXT") {
    base.characters = node.characters ?? "";
    base.fontFamily = node.fontName?.family ?? "Unknown";
    base.fontStyle = node.fontName?.style ?? "Regular";
    base.fontWeight = node.fontWeight ?? 400;
    base.fontSize = node.fontSize ?? 14;
    base.lineHeight = node.lineHeight?.value ?? "AUTO";
    base.letterSpacing = node.letterSpacing?.value ?? 0;
    base.textAlignHorizontal = node.textAlignHorizontal ?? "LEFT";
    base.textAlignVertical = node.textAlignVertical ?? "TOP";
  }

  if (node.type === "COMPONENT") {
    base.componentKey = node.key ?? node.id;
  }

  if (node.type === "INSTANCE") {
    base.componentKey = node.mainComponent?.key ?? node.mainComponent?.id ?? node.id;
    base.mainComponentId = node.mainComponent?.id ?? null;
    base.overrides = clone(node.componentProperties ?? {});
  }

  if (node.type === "RECTANGLE" || node.type === "FRAME" || node.type === "IMAGE") {
    if (node.type === "RECTANGLE" && typeof node.exportAsync === "function") {
      // For MVP we keep this empty. Asset pipeline can fill this during batch export.
      base.image = null;
    }
  }

  base.tokenRefs = clone(node.tokenRefs ?? []);
  base.children = [];
  if ("children" in node && Array.isArray(node.children)) {
    base.children = node.children.map((child) => serializeMgNode(child));
  }
  return base;
}

function getRootsFromMode(mode) {
  if (mode === "selection") {
    return mg.document.currentPage.selection;
  }
  return [mg.document.currentPage];
}

function runExport(mode = "currentPage") {
  const roots = getRootsFromMode(mode).map((node) => serializeMgNode(node));
  const result = exportFromMasterGo({
    roots,
    exportMode: mode,
    documentMeta: {
      sourceFileId: mg.document.id ?? "unknown-file",
      sourcePageId: mg.document.currentPage?.id ?? "unknown-page",
      sourcePageName: mg.document.currentPage?.name ?? "unknown-page"
    }
  });

  mg.ui.postMessage({
    type: "export:result",
    payload: result
  });
}

mg.showUI(__html__, { width: 360, height: 240 });
mg.ui.onmessage = (msg) => {
  if (msg.type === "export:selection") {
    runExport("selection");
  }
  if (msg.type === "export:page") {
    runExport("currentPage");
  }
  if (msg.type === "close") {
    mg.closePlugin();
  }
};
