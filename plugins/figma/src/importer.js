import { ERROR_CODES, createDiagnostic, validateDocument } from "../../../packages/schema/src/index.js";

const FALLBACK_FONT = { family: "Inter", style: "Regular" };
const SUPPORTED_IMPORT_NODE_TYPES = new Set([
  "FRAME",
  "GROUP",
  "TEXT",
  "RECTANGLE",
  "IMAGE",
  "VECTOR",
  "COMPONENT",
  "INSTANCE"
]);
const FIGMA_IMAGE_MAX_DIMENSION = 4096;
const MASTERGO_IMAGE_BASE_URL = "https://image-resource.mastergo.com";

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

function fontKey(fontName) {
  return `${fontName.family}:${fontName.style}`;
}

function normalizeAvailableFonts(availableFonts = []) {
  const fonts = [];
  for (const item of availableFonts) {
    const fontName = item?.fontName ?? item;
    if (fontName?.family && fontName?.style) {
      fonts.push({ family: fontName.family, style: fontName.style });
    }
  }
  return fonts;
}

function isFontAvailable(fontName, availableFonts) {
  if (!availableFonts || availableFonts.length === 0) return true;
  return availableFonts.some((candidate) => (
    candidate.family === fontName.family && candidate.style === fontName.style
  ));
}

function findFamilyFont(family, preferredStyle, availableFonts) {
  if (!availableFonts || availableFonts.length === 0) return null;
  return availableFonts.find((font) => font.family === family && font.style === preferredStyle)
    ?? availableFonts.find((font) => font.family === family)
    ?? null;
}

export function resolveFont(font, ruleSet, availableFonts = null) {
  const fontList = availableFonts ? normalizeAvailableFonts(availableFonts) : availableFonts;
  if (!font?.fontFamily) return { fontName: FALLBACK_FONT, strategy: "systemFallback" };

  const exact = ruleSet?.exact?.[`${font.fontFamily}:${font.fontStyle ?? "Regular"}`];
  if (exact && isFontAvailable(exact, fontList)) return { fontName: exact, strategy: "exact" };

  const familyMatch = ruleSet?.family?.[font.fontFamily];
  if (familyMatch) {
    const mapped = { family: familyMatch, style: font.fontStyle ?? "Regular" };
    if (isFontAvailable(mapped, fontList)) return { fontName: mapped, strategy: "family" };
  }

  const sameFamily = findFamilyFont(font.fontFamily, font.fontStyle ?? "Regular", fontList);
  if (sameFamily) return { fontName: sameFamily, strategy: "availableFamily" };

  const fallback = isFontAvailable(FALLBACK_FONT, fontList)
    ? FALLBACK_FONT
    : fontList?.[0] ?? FALLBACK_FONT;

  return { fontName: fallback, strategy: "systemFallback" };
}

export async function collectAvailableFonts() {
  const figmaApi = globalThis.figma;
  if (typeof figmaApi?.listAvailableFontsAsync !== "function") return [];
  return normalizeAvailableFonts(await figmaApi.listAvailableFontsAsync());
}

export function buildFontPreflightReport(document, fontRuleSet = {}, availableFonts = []) {
  const fontList = normalizeAvailableFonts(availableFonts);
  const requested = new Map();
  for (const node of document.nodes ?? []) {
    if (node.type !== "TEXT" || !node.text) continue;
    const requestKey = `${node.text.fontFamily ?? "Unknown"}:${node.text.fontStyle ?? "Regular"}`;
    const resolved = resolveFont(node.text, fontRuleSet, fontList);
    const existing = requested.get(requestKey) ?? {
      requested: {
        family: node.text.fontFamily ?? "Unknown",
        style: node.text.fontStyle ?? "Regular"
      },
      resolved: resolved.fontName,
      strategy: resolved.strategy,
      nodeIds: []
    };
    existing.nodeIds.push(node.id);
    requested.set(requestKey, existing);
  }

  return {
    availableCount: fontList.length,
    requestedFonts: Array.from(requested.values()),
    fallbackCount: Array.from(requested.values()).filter((item) => item.strategy !== "exact").length
  };
}

function collectImageRefsFromNode(node) {
  const refs = [];
  if (node.imageRef) refs.push({ nodeId: node.id, assetId: node.imageRef, field: "imageRef" });
  for (const fill of node.style?.fills ?? []) {
    if (fill?.type === "IMAGE_REF" && fill.assetId) {
      refs.push({ nodeId: node.id, assetId: fill.assetId, field: "style.fills" });
    }
  }
  return refs;
}

export function buildImportPreflightReport(document) {
  const assets = document.assets ?? [];
  const assetMap = new Map(assets.map((asset) => [asset.id, asset]));
  const imageRefs = (document.nodes ?? []).flatMap((node) => collectImageRefsFromNode(node));
  const unsupportedNodeTypes = [];

  for (const node of document.nodes ?? []) {
    if (!SUPPORTED_IMPORT_NODE_TYPES.has(node.type)) {
      unsupportedNodeTypes.push({ nodeId: node.id, type: node.type });
    }
  }

  return {
    nodeCount: document.nodes?.length ?? 0,
    assetCount: assets.length,
    imageAssetCount: assets.filter((asset) => asset.type === "image").length,
    imageRefCount: imageRefs.length,
    missingAssetRefs: imageRefs.filter((ref) => !assetMap.has(ref.assetId)),
    oversizedImageAssets: assets
      .filter((asset) => asset.type === "image")
      .filter((asset) => (
        Number(asset.width ?? 0) > FIGMA_IMAGE_MAX_DIMENSION
        || Number(asset.height ?? 0) > FIGMA_IMAGE_MAX_DIMENSION
      ))
      .map((asset) => ({
        assetId: asset.id,
        width: asset.width ?? null,
        height: asset.height ?? null
      })),
    unsupportedNodeTypes
  };
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

function decodeBase64(base64) {
  const normalized = String(base64 ?? "").replace(/^data:[^;]+;base64,/, "");
  if (!normalized) return null;
  if (typeof Uint8Array.fromBase64 === "function") {
    return Uint8Array.fromBase64(normalized);
  }
  if (typeof atob === "function") {
    const binary = atob(normalized);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  }
  if (typeof Buffer !== "undefined") {
    return Uint8Array.from(Buffer.from(normalized, "base64"));
  }
  return null;
}

function normalizeImageUri(uri) {
  if (!uri || typeof uri !== "string") return null;
  if (/^https?:\/\//.test(uri)) return uri;
  return `${MASTERGO_IMAGE_BASE_URL}/${uri.replace(/^\/+/, "")}`;
}

async function createImageFromAsset(asset, diagnostics, nodeId, imageCache) {
  if (!asset) {
    diagnostics.push(
      createDiagnostic({
        level: "warn",
        code: ERROR_CODES.ASSET_MISSING,
        nodeId,
        message: "Image asset reference is missing from assets[].",
        fallbackApplied: true
      })
    );
    return null;
  }
  if (imageCache.has(asset.id)) return imageCache.get(asset.id);

  try {
    let image = null;
    if (asset.transport === "inline" && asset.data && typeof figma.createImage === "function") {
      const bytes = decodeBase64(asset.data);
      if (bytes) image = figma.createImage(bytes);
    }
    if (!image && asset.uri && typeof figma.createImageAsync === "function") {
      image = await figma.createImageAsync(asset.uri);
    }

    if (image) {
      imageCache.set(asset.id, image);
      return image;
    }
  } catch (error) {
    diagnostics.push(
      createDiagnostic({
        level: "warn",
        code: ERROR_CODES.ASSET_MISSING,
        nodeId,
        assetId: asset.id,
        message: `Image asset load failed: ${String(error?.message ?? error)}`,
        fallbackApplied: true
      })
    );
    return null;
  }

  diagnostics.push(
    createDiagnostic({
      level: "warn",
      code: ERROR_CODES.ASSET_MISSING,
      nodeId,
      assetId: asset.id,
      message: "Image asset has no supported transport for Figma import.",
      fallbackApplied: true
    })
  );
  return null;
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

async function resolveFills(styleFills, diagnostics, nodeId, assetMap, imageCache) {
  if (!Array.isArray(styleFills)) return [];
  const result = [];
  for (const fill of styleFills) {
    if (fill?.type === "IMAGE_REF" && typeof fill.assetId === "string") {
      const image = await createImageFromAsset(assetMap.get(fill.assetId), diagnostics, nodeId, imageCache);
      if (image?.hash) {
        result.push({
          type: "IMAGE",
          imageHash: image.hash,
          scaleMode: fill.scaleMode ?? "FILL",
          opacity: typeof fill.opacity === "number" ? fill.opacity : 1
        });
      } else {
        result.push({
          type: "SOLID",
          color: { r: 0.85, g: 0.85, b: 0.85 },
          opacity: 1
        });
      }
      continue;
    }
    if (fill?.type === "IMAGE" && typeof fill.imageRef === "string") {
      try {
        const image = await figma.createImageAsync(normalizeImageUri(fill.imageRef));
        result.push({
          type: "IMAGE",
          imageHash: image.hash,
          scaleMode: fill.scaleMode ?? "FILL",
          opacity: typeof fill.alpha === "number" ? fill.alpha : 1
        });
      } catch (error) {
        diagnostics.push(
          createDiagnostic({
            level: "warn",
            code: ERROR_CODES.ASSET_MISSING,
            nodeId,
            message: `MasterGo imageRef load failed, fallback to solid: ${String(error?.message ?? error)}`,
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

async function applyStyle(target, style, diagnostics, nodeId, assetMap, imageCache) {
  if (style.fills) target.fills = await resolveFills(style.fills, diagnostics, nodeId, assetMap, imageCache);
  if (style.strokes) target.strokes = style.strokes;
  if (style.effects) target.effects = style.effects;
  if (typeof style.opacity === "number") target.opacity = style.opacity;
  if (typeof style.cornerRadius === "number" && "cornerRadius" in target) target.cornerRadius = style.cornerRadius;
  if (typeof style.strokeWeight === "number" && "strokeWeight" in target) target.strokeWeight = style.strokeWeight;
  if (style.strokeAlign && "strokeAlign" in target) target.strokeAlign = style.strokeAlign;
}

async function applyImageRef(target, node, assetMap, imageCache, diagnostics) {
  if (!node.imageRef || !("fills" in target)) return;
  const image = await createImageFromAsset(assetMap.get(node.imageRef), diagnostics, node.id, imageCache);
  if (image?.hash) {
    target.fills = [{
      type: "IMAGE",
      imageHash: image.hash,
      scaleMode: "FILL"
    }];
  }
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

async function loadFont(fontName, fontLoadCache) {
  const key = fontKey(fontName);
  if (!fontLoadCache.has(key)) {
    fontLoadCache.set(key, figma.loadFontAsync(fontName));
  }
  await fontLoadCache.get(key);
}

async function applyText(target, node, fontRuleSet, diagnostics, availableFonts, fontLoadCache) {
  if (node.type !== "TEXT" || !node.text) return;

  let fontResolve = resolveFont(node.text, fontRuleSet, availableFonts);
  try {
    await loadFont(fontResolve.fontName, fontLoadCache);
  } catch (error) {
    diagnostics.push(
      createDiagnostic({
        level: "warn",
        code: ERROR_CODES.FONT_FALLBACK,
        nodeId: node.id,
        message: `Font load failed, fallback applied: ${String(error?.message ?? error)}`,
        fallbackApplied: true,
        details: {
          requestedFont: `${node.text.fontFamily}:${node.text.fontStyle}`,
          failedFont: `${fontResolve.fontName.family}:${fontResolve.fontName.style}`
        }
      })
    );
    fontResolve = { fontName: FALLBACK_FONT, strategy: "systemFallback" };
    await loadFont(fontResolve.fontName, fontLoadCache);
  }
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

export function createImportSession() {
  return {
    createdById: new Map(),
    imageCache: new Map(),
    fontLoadCache: new Map()
  };
}

function hydrateCreatedNodesFromPage(createdById) {
  const figmaApi = globalThis.figma;
  if (typeof figmaApi?.currentPage?.findAll !== "function") return;
  const importedNodes = figmaApi.currentPage.findAll((node) => (
    typeof node.getPluginData === "function" && node.getPluginData("mgSourceNodeId")
  ));
  for (const node of importedNodes) {
    createdById.set(node.getPluginData("mgSourceNodeId"), node);
  }
}

export async function importToFigma({
  document,
  fontRuleSet = {},
  batch = null,
  session = null,
  availableFonts = null
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

  const activeSession = session ?? createImportSession();
  const createdById = activeSession.createdById;
  hydrateCreatedNodesFromPage(createdById);
  const sortedNodes = sortNodesForImport(document.nodes);
  const batchedNodes = pickBatch(sortedNodes, batch);
  const tokenMap = new Map((document.tokens ?? []).map((token) => [token.tokenId, token]));
  const assetMap = new Map((document.assets ?? []).map((asset) => [asset.id, asset]));
  const preflight = buildImportPreflightReport(document);
  const resolvedAvailableFonts = normalizeAvailableFonts(availableFonts ?? await collectAvailableFonts());
  const fontPreflight = buildFontPreflightReport(document, fontRuleSet, resolvedAvailableFonts);
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
    await applyStyle(raw, node.style, diagnostics, node.id, assetMap, activeSession.imageCache);
    await applyImageRef(raw, node, assetMap, activeSession.imageCache, diagnostics);
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
    await applyText(raw, node, fontRuleSet, diagnostics, resolvedAvailableFonts, activeSession.fontLoadCache);

    let target = applyComponentSemantics(raw, node, createdById, diagnostics);
    if (target !== raw) {
      raw.remove();
      applyGeometry(target, node.geometry);
      applyLayout(target, node);
      await applyStyle(target, node.style, diagnostics, node.id, assetMap, activeSession.imageCache);
      await applyImageRef(target, node, assetMap, activeSession.imageCache, diagnostics);
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
    preflight,
    fontPreflight,
    session: activeSession,
    batch: {
      total: sortedNodes.length,
      imported: batchedNodes.length,
      offset: batch?.offset ?? 0,
      limit: batch?.limit ?? batchedNodes.length
    }
  };
}
