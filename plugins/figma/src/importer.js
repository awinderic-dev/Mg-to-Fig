import { ERROR_CODES, createDiagnostic, validateDocument } from "../../../packages/schema/src/index.js";

function mapNodeType(type) {
  switch (type) {
    case "FRAME":
      return figma.createFrame();
    case "GROUP":
      return figma.group([], figma.currentPage);
    case "TEXT":
      return figma.createText();
    case "RECTANGLE":
    case "IMAGE":
      return figma.createRectangle();
    case "VECTOR":
      return figma.createVector();
    case "COMPONENT":
      return figma.createComponent();
    case "INSTANCE":
      return figma.createFrame();
    default:
      return null;
  }
}

export function resolveFont(font, ruleSet) {
  if (!font?.fontFamily) return { fontName: { family: "Inter", style: "Regular" }, strategy: "systemFallback" };

  const exact = ruleSet?.exact?.[`${font.fontFamily}:${font.fontStyle ?? "Regular"}`];
  if (exact) return { fontName: exact, strategy: "exact" };

  const familyMatch = ruleSet?.family?.[font.fontFamily];
  if (familyMatch) return { fontName: { family: familyMatch, style: font.fontStyle ?? "Regular" }, strategy: "family" };

  return { fontName: { family: "Inter", style: "Regular" }, strategy: "systemFallback" };
}

function nodeDepth(nodeById, nodeId, memo = new Map()) {
  if (memo.has(nodeId)) return memo.get(nodeId);
  const node = nodeById.get(nodeId);
  if (!node || !node.parentId) {
    memo.set(nodeId, 0);
    return 0;
  }
  const depth = nodeDepth(nodeById, node.parentId, memo) + 1;
  memo.set(nodeId, depth);
  return depth;
}

function sortNodesForImport(nodes) {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const depthMemo = new Map();
  return [...nodes].sort((a, b) => {
    const da = nodeDepth(nodeById, a.id, depthMemo);
    const db = nodeDepth(nodeById, b.id, depthMemo);
    if (da !== db) return da - db;
    return String(a.id).localeCompare(String(b.id));
  });
}

function pickBatch(sortedNodes, batch) {
  if (!batch) return sortedNodes;
  const offset = Math.max(0, Number(batch.offset ?? 0));
  const limitRaw = Number(batch.limit ?? sortedNodes.length);
  const limit = Number.isFinite(limitRaw) ? Math.max(0, limitRaw) : sortedNodes.length;
  return sortedNodes.slice(offset, offset + limit);
}

function applyGeometry(target, geometry) {
  target.x = geometry.x ?? 0;
  target.y = geometry.y ?? 0;
  target.resize(Math.max(1, geometry.width ?? 1), Math.max(1, geometry.height ?? 1));
  if (typeof geometry.rotation === "number") {
    target.rotation = geometry.rotation;
  }
}

function applyLayout(target, node) {
  if (!("layoutMode" in target)) return;
  if (node.layout?.mode === "autoLayout" && (target.type === "FRAME" || target.type === "COMPONENT")) {
    const direction = node.layout?.direction === "row" ? "HORIZONTAL" : "VERTICAL";
    target.layoutMode = direction;
    target.primaryAxisSizingMode = node.layout?.primaryAxisSizingMode ?? "FIXED";
    target.counterAxisSizingMode = node.layout?.counterAxisSizingMode ?? "FIXED";
    target.primaryAxisAlignItems = node.layout?.primaryAxisAlignItems ?? "MIN";
    target.counterAxisAlignItems = node.layout?.counterAxisAlignItems ?? "MIN";
    target.itemSpacing = Number(node.layout?.itemSpacing ?? 0);
    target.paddingTop = Number(node.layout?.padding?.top ?? 0);
    target.paddingRight = Number(node.layout?.padding?.right ?? 0);
    target.paddingBottom = Number(node.layout?.padding?.bottom ?? 0);
    target.paddingLeft = Number(node.layout?.padding?.left ?? 0);
  }
}

function applyLayoutChildSemantics(target, node) {
  const constraints = node.layout?.constraints ?? {};
  if ("layoutGrow" in target && typeof constraints.layoutGrow === "number") {
    target.layoutGrow = constraints.layoutGrow;
  } else if ("layoutGrow" in target && constraints.grow === true) {
    target.layoutGrow = 1;
  }
  if ("layoutAlign" in target && typeof constraints.layoutAlign === "string") {
    target.layoutAlign = constraints.layoutAlign;
  }
}

function normalizeSvgPathData(data) {
  return String(data ?? "")
    .replace(/,/g, " ")
    .replace(/([MLCQZmlcqz])/g, " $1 ")
    .replace(/\s+/g, " ")
    .trim();
}

function resolveSolidFillColor(fill) {
  if (!fill || fill.type !== "SOLID" || !fill.color) return "rgb(29,33,41)";
  const r = Math.round((fill.color.r ?? 0) * 255);
  const g = Math.round((fill.color.g ?? 0) * 255);
  const b = Math.round((fill.color.b ?? 0) * 255);
  return `rgb(${r},${g},${b})`;
}

function buildSvgVectorNode(node, fillColor) {
  const width = Math.max(1, Number(node.geometry?.width ?? 1));
  const height = Math.max(1, Number(node.geometry?.height ?? 1));
  const paths = (node.vectorPaths ?? [])
    .map((segment) => {
      const d = normalizeSvgPathData(segment.data);
      if (!d) return null;
      return `<path d="${d.replace(/"/g, "&quot;")}" fill="${fillColor}"/>`;
    })
    .filter(Boolean)
    .join("");
  if (!paths) return null;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}">${paths}</svg>`;
  return figma.createNodeFromSvg(svg);
}

async function resolveFills(styleFills, diagnostics, nodeId) {
  if (!Array.isArray(styleFills)) return [];
  const result = [];
  for (const fill of styleFills) {
    if (fill?.type === "IMAGE_URL" && typeof fill.url === "string") {
      try {
        const image = await figma.createImageAsync(fill.url);
        result.push({
          type: "IMAGE",
          imageHash: image.hash,
          scaleMode: fill.scaleMode ?? "FILL"
        });
      } catch (error) {
        diagnostics.push(
          createDiagnostic({
            level: "warn",
            code: ERROR_CODES.ASSET_MISSING,
            nodeId,
            message: `Image fill load failed, fallback to solid: ${String(error?.message ?? error)}`,
            fallbackApplied: true
          })
        );
        result.push({
          type: "SOLID",
          color: { r: 0.85, g: 0.85, b: 0.85 },
          opacity: 1
        });
      }
      continue;
    }
    result.push(fill);
  }
  return result;
}

async function applyStyle(target, style, diagnostics, nodeId) {
  if (style.fills) target.fills = await resolveFills(style.fills, diagnostics, nodeId);
  if (style.strokes) target.strokes = style.strokes;
  if (style.effects) target.effects = style.effects;
  if (typeof style.opacity === "number") target.opacity = style.opacity;
  if (typeof style.cornerRadius === "number" && "cornerRadius" in target) target.cornerRadius = style.cornerRadius;
  if (typeof style.strokeWeight === "number" && "strokeWeight" in target) target.strokeWeight = style.strokeWeight;
  if (style.strokeAlign && "strokeAlign" in target) target.strokeAlign = style.strokeAlign;
}

function applyVectorData(target, node, diagnostics) {
  if (target.type !== "VECTOR") return true;
  if (Array.isArray(node.vectorPaths) && node.vectorPaths.length > 0) {
    try {
      target.vectorPaths = node.vectorPaths.map((segment) => ({
        windingRule: segment.windingRule ?? "NONZERO",
        data: normalizeSvgPathData(segment.data)
      }));
      return true;
    } catch (error) {
      diagnostics.push(
        createDiagnostic({
          level: "warn",
          code: ERROR_CODES.NODE_UNSUPPORTED,
          nodeId: node.id,
          message: `Vector path parse failed, fallback to empty vector: ${String(error?.message ?? error)}`,
          fallbackApplied: true
        })
      );
      return false;
    }
  }
  return true;
}

async function applyText(target, node, fontRuleSet, diagnostics) {
  if (node.type !== "TEXT" || !node.text) return;

  const fontResolve = resolveFont(node.text, fontRuleSet);
  await figma.loadFontAsync(fontResolve.fontName);
  target.fontName = fontResolve.fontName;
  target.fontSize = node.text.fontSize;
  target.fontName = { family: fontResolve.fontName.family, style: fontResolve.fontName.style };
  target.lineHeight = typeof node.text.lineHeight === "number"
    ? { unit: "PIXELS", value: node.text.lineHeight }
    : target.lineHeight;
  target.letterSpacing = { value: node.text.letterSpacing ?? 0, unit: "PIXELS" };
  target.textAlignHorizontal = node.text.textAlignHorizontal ?? "LEFT";
  target.textAlignVertical = node.text.textAlignVertical ?? "TOP";
  if ("textAutoResize" in target && node.text.textMode === "single-line") {
    target.textAutoResize = "WIDTH_AND_HEIGHT";
  }
  target.characters = node.text.characters ?? "";

  if (fontResolve.strategy !== "exact") {
    diagnostics.push(
      createDiagnostic({
        level: "warn",
        code: ERROR_CODES.FONT_FALLBACK,
        nodeId: node.id,
        message: `Font fallback applied with strategy: ${fontResolve.strategy}.`,
        fallbackApplied: true,
        details: {
          requestedFont: `${node.text.fontFamily}:${node.text.fontStyle}`,
          resolvedFont: `${fontResolve.fontName.family}:${fontResolve.fontName.style}`
        }
      })
    );
  }
}

function applyComponentSemantics(target, node, createdById, diagnostics) {
  if (!node.componentRef) return target;

  if (node.type === "INSTANCE") {
    const master = createdById.get(node.componentRef.instanceOf);
    if (master && master.type === "COMPONENT") {
      const instance = master.createInstance();
      instance.name = node.name;
      return instance;
    }

    diagnostics.push(
      createDiagnostic({
        level: "warn",
        code: ERROR_CODES.COMPONENT_BIND_FAIL,
        nodeId: node.id,
        message: "Main component not found. Instance downgraded to frame.",
        fallbackApplied: true
      })
    );
  }

  return target;
}

function applyTokenTracking(target, node, tokenMap, diagnostics) {
  if (!Array.isArray(node.tokenRefs) || node.tokenRefs.length === 0) return;
  const tokenSummary = node.tokenRefs.map((ref) => ref.path ?? ref.name ?? ref.tokenId).join(",");
  target.setPluginData("mgTokenRefs", tokenSummary);

  for (const ref of node.tokenRefs) {
    const token = tokenMap.get(ref.tokenId);
    if (!token || token.bindingStatus !== "bound") {
      diagnostics.push(
        createDiagnostic({
          level: "info",
          code: ERROR_CODES.TOKEN_BIND_PENDING,
          nodeId: node.id,
          message: `Token pending bind: ${ref.path ?? ref.tokenId}`,
          fallbackApplied: true
        })
      );
    }
  }
}

function compareNumberish(actual, expected) {
  if (typeof actual !== "number" || typeof expected !== "number") return actual === expected;
  return Math.abs(actual - expected) < 0.001;
}

function compareStyleParam(actualNode, sourceNode) {
  const mismatches = [];
  const expected = sourceNode.style ?? {};

  if (typeof expected.opacity === "number" && !compareNumberish(actualNode.opacity, expected.opacity)) {
    mismatches.push({ field: "opacity", expected: expected.opacity, actual: actualNode.opacity });
  }
  if (typeof expected.cornerRadius === "number" && "cornerRadius" in actualNode) {
    if (!compareNumberish(actualNode.cornerRadius, expected.cornerRadius)) {
      mismatches.push({ field: "cornerRadius", expected: expected.cornerRadius, actual: actualNode.cornerRadius });
    }
  }
  if (typeof expected.strokeWeight === "number" && "strokeWeight" in actualNode) {
    if (!compareNumberish(actualNode.strokeWeight, expected.strokeWeight)) {
      mismatches.push({ field: "strokeWeight", expected: expected.strokeWeight, actual: actualNode.strokeWeight });
    }
  }
  return mismatches;
}

export function buildParameterDiffReport(sourceNodes, createdBySourceId) {
  const report = {
    comparedCount: 0,
    mismatchCount: 0,
    missingInTarget: [],
    mismatches: []
  };

  for (const sourceNode of sourceNodes) {
    const targetNode = createdBySourceId.get(sourceNode.id);
    if (!targetNode) {
      report.missingInTarget.push(sourceNode.id);
      continue;
    }

    const nodeMismatches = [];
    const g = sourceNode.geometry ?? {};
    if (typeof g.x === "number" && !compareNumberish(targetNode.x, g.x)) {
      nodeMismatches.push({ field: "x", expected: g.x, actual: targetNode.x });
    }
    if (typeof g.y === "number" && !compareNumberish(targetNode.y, g.y)) {
      nodeMismatches.push({ field: "y", expected: g.y, actual: targetNode.y });
    }
    if (typeof g.width === "number" && !compareNumberish(targetNode.width, g.width)) {
      nodeMismatches.push({ field: "width", expected: g.width, actual: targetNode.width });
    }
    if (typeof g.height === "number" && !compareNumberish(targetNode.height, g.height)) {
      nodeMismatches.push({ field: "height", expected: g.height, actual: targetNode.height });
    }
    nodeMismatches.push(...compareStyleParam(targetNode, sourceNode));

    if (sourceNode.type === "TEXT" && sourceNode.text) {
      if (!compareNumberish(targetNode.fontSize, sourceNode.text.fontSize)) {
        nodeMismatches.push({
          field: "fontSize",
          expected: sourceNode.text.fontSize,
          actual: targetNode.fontSize
        });
      }
      if (sourceNode.text.lineHeight && targetNode.lineHeight?.value) {
        if (!compareNumberish(targetNode.lineHeight.value, sourceNode.text.lineHeight)) {
          nodeMismatches.push({
            field: "lineHeight",
            expected: sourceNode.text.lineHeight,
            actual: targetNode.lineHeight.value
          });
        }
      }
      // characters can differ in wrapping but should keep same raw content.
      if ((targetNode.characters ?? "") !== (sourceNode.text.characters ?? "")) {
        nodeMismatches.push({
          field: "characters",
          expected: sourceNode.text.characters ?? "",
          actual: targetNode.characters ?? ""
        });
      }
    }

    report.comparedCount += 1;
    if (nodeMismatches.length > 0) {
      report.mismatchCount += 1;
      report.mismatches.push({ nodeId: sourceNode.id, fields: nodeMismatches });
    }
  }

  return report;
}

export async function importToFigma({
  document,
  fontRuleSet = {},
  batch = null
}) {
  const validation = validateDocument(document);
  const diagnostics = [...(document.diagnostics ?? [])];
  if (!validation.valid) {
    return {
      createdNodes: [],
      diagnostics: diagnostics.concat(
        validation.errors.map((message) =>
          createDiagnostic({
            level: "error",
            code: ERROR_CODES.STYLE_UNMAPPABLE,
            message,
            fallbackApplied: false
          })
        )
      )
    };
  }

  const createdById = new Map();
  const sortedNodes = sortNodesForImport(document.nodes);
  const batchedNodes = pickBatch(sortedNodes, batch);
  const tokenMap = new Map((document.tokens ?? []).map((token) => [token.tokenId, token]));
  const createdNodes = [];

  for (const node of batchedNodes) {
    let raw = mapNodeType(node.type);
    if (!raw) {
      diagnostics.push(
        createDiagnostic({
          level: "warn",
          code: ERROR_CODES.NODE_UNSUPPORTED,
          nodeId: node.id,
          message: `Node ${node.type} is unsupported in importer.`,
          fallbackApplied: true
        })
      );
      continue;
    }

    raw.name = node.name;
    applyGeometry(raw, node.geometry);
    applyLayout(raw, node);
    await applyStyle(raw, node.style, diagnostics, node.id);
    const vectorApplied = applyVectorData(raw, node, diagnostics);
    if (!vectorApplied && node.type === "VECTOR") {
      const svgNode = buildSvgVectorNode(node, resolveSolidFillColor(node.style?.fills?.[0]));
      if (svgNode) {
        raw.remove();
        raw = svgNode;
        raw.name = node.name;
        applyGeometry(raw, node.geometry);
      }
    }
    await applyText(raw, node, fontRuleSet, diagnostics);

    let target = applyComponentSemantics(raw, node, createdById, diagnostics);
    if (target !== raw) {
      raw.remove();
      applyGeometry(target, node.geometry);
      applyLayout(target, node);
      await applyStyle(target, node.style, diagnostics, node.id);
      applyVectorData(target, node, diagnostics);
    }

    const parent = node.parentId ? createdById.get(node.parentId) : figma.currentPage;
    if (parent && "appendChild" in parent) {
      parent.appendChild(target);
    } else {
      figma.currentPage.appendChild(target);
    }
    applyLayoutChildSemantics(target, node);

    applyTokenTracking(target, node, tokenMap, diagnostics);
    target.setPluginData("mgSourceNodeId", node.id);
    createdById.set(node.id, target);
    createdNodes.push(target);
  }

  const diffReport = buildParameterDiffReport(batchedNodes, createdById);

  return {
    createdNodes,
    diagnostics,
    diffReport,
    batch: {
      total: sortedNodes.length,
      imported: batchedNodes.length,
      offset: batch?.offset ?? 0,
      limit: batch?.limit ?? batchedNodes.length
    }
  };
}
