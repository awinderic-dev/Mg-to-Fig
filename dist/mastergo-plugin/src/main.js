const SCHEMA_VERSION = "0.1.0";

const ERROR_CODES = {
  NODE_UNSUPPORTED: "E_NODE_UNSUPPORTED",
  STYLE_UNMAPPABLE: "E_STYLE_UNMAPPABLE",
  LAYOUT_CONFLICT: "E_LAYOUT_CONFLICT",
  COMPONENT_BIND_FAIL: "E_COMPONENT_BIND_FAIL",
  ASSET_MISSING: "E_ASSET_MISSING",
  FONT_FALLBACK: "E_FONT_FALLBACK",
  TOKEN_BIND_PENDING: "E_TOKEN_BIND_PENDING"
};

function createEmptyDocumentMeta(overrides = {}) {
  return {
    sourceTool: "mastergo",
    exportMode: "currentPage",
    exportedAt: new Date().toISOString(),
    sourceFileId: "unknown-file",
    sourcePageId: "unknown-page",
    sourcePageName: "unknown-page",
    ...overrides
  };
}

function createDiagnostic({
  level = "info",
  code,
  message,
  nodeId = null,
  assetId = null,
  fallbackApplied = false,
  details = {}
}) {
  return {
    level,
    code,
    nodeId,
    assetId,
    message,
    fallbackApplied,
    details
  };
}

function createDocument({
  schemaVersion = SCHEMA_VERSION,
  documentMeta = createEmptyDocumentMeta(),
  nodes = [],
  assets = [],
  tokens = [],
  diagnostics = []
} = {}) {
  return {
    schemaVersion,
    documentMeta,
    nodes,
    assets,
    tokens,
    diagnostics
  };
}

function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isString(value) {
  return typeof value === "string";
}

function isNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function ensureArray(value) {
  return Array.isArray(value) ? value : [];
}

function validateDocument(document) {
  const errors = [];

  if (!isObject(document)) {
    return {
      valid: false,
      errors: ["Document must be an object."]
    };
  }

  if (!isString(document.schemaVersion)) {
    errors.push("schemaVersion must be a string.");
  }

  if (!isObject(document.documentMeta)) {
    errors.push("documentMeta must be an object.");
  } else {
    const meta = document.documentMeta;
    if (!isString(meta.sourceTool)) errors.push("documentMeta.sourceTool must be a string.");
    if (!isString(meta.exportMode)) errors.push("documentMeta.exportMode must be a string.");
    if (!isString(meta.exportedAt)) errors.push("documentMeta.exportedAt must be a string.");
    if (!isString(meta.sourceFileId)) errors.push("documentMeta.sourceFileId must be a string.");
    if (!isString(meta.sourcePageId)) errors.push("documentMeta.sourcePageId must be a string.");
    if (!isString(meta.sourcePageName)) errors.push("documentMeta.sourcePageName must be a string.");
  }

  const nodes = ensureArray(document.nodes);
  for (const node of nodes) {
    if (!isObject(node)) {
      errors.push("Each node must be an object.");
      continue;
    }
    if (!isString(node.id)) errors.push("nodes[].id must be a string.");
    if (!isString(node.type)) errors.push(`nodes[${node.id ?? "?"}].type must be a string.`);
    if (!isString(node.name)) errors.push(`nodes[${node.id ?? "?"}].name must be a string.`);
    if (!Array.isArray(node.children)) errors.push(`nodes[${node.id ?? "?"}].children must be an array.`);
    if (!isObject(node.geometry)) errors.push(`nodes[${node.id ?? "?"}].geometry must be an object.`);
    if (!isObject(node.style)) errors.push(`nodes[${node.id ?? "?"}].style must be an object.`);
  }

  const assets = ensureArray(document.assets);
  for (const asset of assets) {
    if (!isObject(asset)) {
      errors.push("Each asset must be an object.");
      continue;
    }
    if (!isString(asset.id)) errors.push("assets[].id must be a string.");
    if (!isString(asset.transport)) errors.push(`assets[${asset.id ?? "?"}].transport must be a string.`);
    if (!isNumber(asset.sizeBytes)) errors.push(`assets[${asset.id ?? "?"}].sizeBytes must be a number.`);
  }

  const tokens = ensureArray(document.tokens);
  for (const token of tokens) {
    if (!isObject(token)) {
      errors.push("Each token must be an object.");
      continue;
    }
    if (!isString(token.tokenId)) errors.push("tokens[].tokenId must be a string.");
    if (!isString(token.path)) errors.push(`tokens[${token.tokenId ?? "?"}].path must be a string.`);
  }

  return {
    valid: errors.length === 0,
    errors
  };
}


const SUPPORTED_NODE_TYPES = new Set([
  "FRAME",
  "GROUP",
  "TEXT",
  "RECTANGLE",
  "VECTOR",
  "IMAGE",
  "COMPONENT",
  "INSTANCE"
]);

const NON_EMITTED_NODE_TYPES = new Set(["PAGE"]);
const VECTOR_FALLBACK_TYPES = new Set(["PEN", "POLYGON"]);
const MASTERGO_IMAGE_BASE_URL = "https://image-resource.mastergo.com";

function normalizeNodeType(node) {
  if (NON_EMITTED_NODE_TYPES.has(node.type)) return null;
  if (VECTOR_FALLBACK_TYPES.has(node.type)) {
    if (Array.isArray(node.vectorPaths) && node.vectorPaths.length > 0) return "VECTOR";
    return "IMAGE";
  }
  return node.type;
}

function normalizeDocumentMeta(meta) {
  return {
    ...meta,
    sourceFileId: String(meta.sourceFileId ?? "unknown-file"),
    sourcePageId: String(meta.sourcePageId ?? "unknown-page"),
    sourcePageName: String(meta.sourcePageName ?? "unknown-page")
  };
}

function normalizeGeometry(node) {
  return {
    x: Number(node.x ?? 0),
    y: Number(node.y ?? 0),
    width: Number(node.width ?? 0),
    height: Number(node.height ?? 0),
    rotation: Number(node.rotation ?? 0)
  };
}

function normalizeLayout(node) {
  return {
    mode: node.layoutMode === "AUTO" ? "autoLayout" : "none",
    constraints: node.constraints ?? {},
    primaryAxisSizingMode: node.primaryAxisSizingMode ?? "FIXED",
    counterAxisSizingMode: node.counterAxisSizingMode ?? "FIXED",
    primaryAxisAlignItems: node.primaryAxisAlignItems ?? "MIN",
    counterAxisAlignItems: node.counterAxisAlignItems ?? "MIN",
    padding: {
      top: Number(node.paddingTop ?? 0),
      right: Number(node.paddingRight ?? 0),
      bottom: Number(node.paddingBottom ?? 0),
      left: Number(node.paddingLeft ?? 0)
    },
    itemSpacing: Number(node.itemSpacing ?? 0)
  };
}

function normalizeStyle(node) {
  return {
    fills: Array.isArray(node.fills) ? node.fills : [],
    strokes: Array.isArray(node.strokes) ? node.strokes : [],
    effects: Array.isArray(node.effects) ? node.effects : [],
    opacity: Number(node.opacity ?? 1),
    cornerRadius: node.cornerRadius ?? 0,
    strokeWeight: Number(node.strokeWeight ?? 0),
    strokeAlign: node.strokeAlign ?? "INSIDE"
  };
}

function normalizeAssetId(raw, fallback) {
  return String(raw ?? fallback).replace(/[^a-zA-Z0-9:_-]/g, "_");
}

function normalizeImageUri(uri) {
  if (!uri || typeof uri !== "string") return null;
  if (/^https?:\/\//.test(uri)) return uri;
  return `${MASTERGO_IMAGE_BASE_URL}/${uri.replace(/^\/+/, "")}`;
}

function normalizeImageAsset(image, { nodeId, fallbackId, assetInlineLimitBytes }, diagnostics) {
  if (!image || typeof image !== "object") return null;
  if (image.error) return null;

  const data = image.data ?? image.base64 ?? null;
  const uri = normalizeImageUri(image.uri ?? image.url ?? image.imageRef ?? null);
  const sizeBytes = Number(image.sizeBytes ?? (typeof data === "string" ? data.length : 0));
  const canInline = typeof data === "string" && data.length > 0 && sizeBytes <= assetInlineLimitBytes;
  const asset = {
    id: normalizeAssetId(image.id ?? image.assetId, fallbackId),
    type: "image",
    mimeType: image.mimeType ?? "image/png",
    sizeBytes,
    transport: canInline ? "inline" : "external",
    uri: canInline ? null : uri,
    data: canInline ? data : null,
    checksum: image.checksum ?? null,
    width: Number.isFinite(Number(image.width)) ? Number(image.width) : null,
    height: Number.isFinite(Number(image.height)) ? Number(image.height) : null
  };

  if (asset.transport === "external" && !asset.uri) {
    diagnostics.push(
      createDiagnostic({
        level: "error",
        code: ERROR_CODES.ASSET_MISSING,
        nodeId,
        assetId: asset.id,
        message: "Image asset has no inline data or URI.",
        fallbackApplied: false
      })
    );
  }

  return asset;
}

function addAsset(asset, assets, assetIds) {
  if (!asset || assetIds.has(asset.id)) return;
  assets.push(asset);
  assetIds.add(asset.id);
}

function normalizeText(node) {
  if (node.type !== "TEXT") return null;
  return {
    characters: node.characters ?? "",
    textMode: node.textMode ?? "single-line",
    fontFamily: node.fontFamily ?? "Unknown",
    fontStyle: node.fontStyle ?? "Regular",
    fontWeight: Number(node.fontWeight ?? 400),
    fontSize: Number(node.fontSize ?? 14),
    lineHeight: node.lineHeight ?? "AUTO",
    letterSpacing: Number(node.letterSpacing ?? 0),
    textAlignHorizontal: node.textAlignHorizontal ?? "LEFT",
    textAlignVertical: node.textAlignVertical ?? "TOP"
  };
}

function normalizeComponentRef(node) {
  if (node.type !== "COMPONENT" && node.type !== "INSTANCE") return null;
  return {
    componentKey: node.componentKey ?? node.id,
    instanceOf: node.type === "INSTANCE" ? node.mainComponentId ?? null : null,
    overrides: node.overrides ?? {}
  };
}

function normalizeTokenRefs(node) {
  return Array.isArray(node.tokenRefs) ? node.tokenRefs : [];
}

function normalizeVectorPaths(node) {
  return Array.isArray(node.vectorPaths)
    ? node.vectorPaths.filter((segment) => typeof segment?.data === "string" && segment.data.length > 0)
    : [];
}

function collectNodeAsset(node, options, assets, assetIds, diagnostics) {
  if (!node.image || node.image.error) return null;

  const asset = normalizeImageAsset(node.image, {
    nodeId: node.id,
    fallbackId: `${node.id}-image`,
    assetInlineLimitBytes: options.assetInlineLimitBytes
  }, diagnostics);

  addAsset(asset, assets, assetIds);
  return asset?.id ?? null;
}

function collectFillAssets(node, fills, options, assets, assetIds, diagnostics) {
  return fills.map((fill, index) => {
    if (!fill || typeof fill !== "object") return fill;

    if (fill.type === "IMAGE_REF" && typeof fill.assetId === "string") {
      return fill;
    }

    if (fill.type !== "IMAGE_URL" && fill.type !== "IMAGE") {
      return fill;
    }

    const fallbackId = `${node.id}-fill-${index}`;
    const asset = normalizeImageAsset({
      id: fill.assetId,
      url: fill.url,
      imageRef: fill.imageRef,
      mimeType: fill.mimeType,
      sizeBytes: fill.sizeBytes,
      checksum: fill.checksum,
      width: fill.width,
      height: fill.height
    }, {
      nodeId: node.id,
      fallbackId,
      assetInlineLimitBytes: options.assetInlineLimitBytes
    }, diagnostics);

    addAsset(asset, assets, assetIds);
    return {
      type: "IMAGE_REF",
      assetId: asset?.id ?? normalizeAssetId(fill.assetId, fallbackId),
      scaleMode: fill.scaleMode ?? "FILL",
      opacity: typeof fill.opacity === "number" ? fill.opacity : 1
    };
  });
}

function collectTokenRegistry(node, tokenRegistry) {
  for (const tokenRef of normalizeTokenRefs(node)) {
    const tokenId = tokenRef.tokenId ?? `${tokenRef.path ?? "unknown"}:${tokenRef.name ?? "unknown"}`;
    if (!tokenRegistry.has(tokenId)) {
      tokenRegistry.set(tokenId, {
        tokenId,
        path: tokenRef.path ?? tokenId,
        name: tokenRef.name ?? tokenRef.path ?? tokenId,
        kind: tokenRef.kind ?? "unknown",
        resolvedValue: tokenRef.resolvedValue ?? null,
        usageNodeIds: [node.id],
        bindingStatus: "tracked"
      });
    } else {
      const token = tokenRegistry.get(tokenId);
      if (!token.usageNodeIds.includes(node.id)) {
        token.usageNodeIds.push(node.id);
      }
    }
  }
}

function flattenNodeTree(node, parentId, output) {
  const normalizedType = normalizeNodeType(node);
  const emit = normalizedType !== null && SUPPORTED_NODE_TYPES.has(normalizedType);
  output.push({ node, parentId, normalizedType, emit });
  const children = Array.isArray(node.children) ? node.children : [];
  for (const child of children) {
    flattenNodeTree(child, emit ? node.id : parentId, output);
  }
}

function exportFromMasterGo({
  roots,
  exportMode = "currentPage",
  documentMeta = {},
  assetInlineLimitBytes = 120 * 1024
}) {
  const flattened = [];
  for (const root of roots) {
    flattenNodeTree(root, null, flattened);
  }

  const assets = [];
  const assetIds = new Set();
  const nodes = [];
  const diagnostics = [];
  const tokenRegistry = new Map();

  const emittedIds = new Set(flattened.filter((entry) => entry.emit).map((entry) => entry.node.id));

  for (const { node, parentId, normalizedType, emit } of flattened) {
    if (!emit) {
      if (!NON_EMITTED_NODE_TYPES.has(node.type)) {
        diagnostics.push(
          createDiagnostic({
            level: "warn",
            code: ERROR_CODES.NODE_UNSUPPORTED,
            nodeId: node.id ?? null,
            message: `Unsupported node type: ${node.type ?? "UNKNOWN"}.`,
            fallbackApplied: true
          })
        );
      }
      continue;
    }

    const vectorPaths = normalizeVectorPaths(node);

    if (normalizedType === "VECTOR" && vectorPaths.length === 0) {
      diagnostics.push(
        createDiagnostic({
          level: "warn",
          code: ERROR_CODES.NODE_UNSUPPORTED,
          nodeId: node.id ?? null,
          message: `Vector node ${node.type ?? "UNKNOWN"} has no path data; it may import as an empty vector.`,
          fallbackApplied: true
        })
      );
    }

    if (normalizedType === "IMAGE" && VECTOR_FALLBACK_TYPES.has(node.type) && (!node.image || node.image.error)) {
      diagnostics.push(
        createDiagnostic({
          level: "error",
          code: ERROR_CODES.ASSET_MISSING,
          nodeId: node.id ?? null,
          message: `Vector node ${node.type ?? "UNKNOWN"} has no path data and raster fallback export failed.`,
          fallbackApplied: false,
          details: {
            exportError: node.image?.error ?? "No raster fallback payload."
          }
        })
      );
    }

    if (node.type !== normalizedType) {
      diagnostics.push(
        createDiagnostic({
          level: vectorPaths.length > 0 || normalizedType === "IMAGE" ? "info" : "warn",
          code: ERROR_CODES.NODE_UNSUPPORTED,
          nodeId: node.id ?? null,
          message: `Node type ${node.type ?? "UNKNOWN"} downgraded to ${normalizedType}.`,
          fallbackApplied: true
        })
      );
    }

    const style = normalizeStyle(node);
    const imageRef = collectNodeAsset(node, { assetInlineLimitBytes }, assets, assetIds, diagnostics);
    style.fills = collectFillAssets(node, style.fills, { assetInlineLimitBytes }, assets, assetIds, diagnostics);
    collectTokenRegistry(node, tokenRegistry);

    nodes.push({
      id: node.id,
      type: normalizedType,
      name: node.name ?? node.id,
      visible: node.visible !== false,
      locked: node.locked === true,
      parentId,
      children: (node.children ?? []).filter((child) => emittedIds.has(child.id)).map((child) => child.id),
      geometry: normalizeGeometry(node),
      layout: normalizeLayout(node),
      style,
      text: normalizeText(node),
      vectorPaths,
      imageRef,
      componentRef: normalizeComponentRef(node),
      tokenRefs: normalizeTokenRefs(node)
    });
  }

  const document = createDocument({
    schemaVersion: SCHEMA_VERSION,
    documentMeta: createEmptyDocumentMeta({
      exportMode,
      ...normalizeDocumentMeta(documentMeta)
    }),
    nodes,
    assets,
    tokens: Array.from(tokenRegistry.values()),
    diagnostics
  });

  const validation = validateDocument(document);
  if (!validation.valid) {
    for (const error of validation.errors) {
      diagnostics.push(
        createDiagnostic({
          level: "error",
          code: ERROR_CODES.STYLE_UNMAPPABLE,
          message: error,
          fallbackApplied: false
        })
      );
    }
  }

  return {
    document,
    validation
  };
}


function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function bytesToBase64(bytes) {
  if (!bytes) return null;
  const array = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (array.length === 0) return null;
  if (typeof btoa === "function") {
    let binary = "";
    const chunkSize = 0x8000;
    for (let index = 0; index < array.length; index += chunkSize) {
      const chunk = array.subarray(index, index + chunkSize);
      binary += String.fromCharCode(...chunk);
    }
    return btoa(binary);
  }

  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let output = "";
  for (let index = 0; index < array.length; index += 3) {
    const byte1 = array[index];
    const byte2 = array[index + 1];
    const byte3 = array[index + 2];
    output += alphabet[byte1 >> 2];
    output += alphabet[((byte1 & 3) << 4) | ((byte2 ?? 0) >> 4)];
    output += index + 1 < array.length
      ? alphabet[((byte2 & 15) << 2) | ((byte3 ?? 0) >> 6)]
      : "=";
    output += index + 2 < array.length
      ? alphabet[byte3 & 63]
      : "=";
  }
  return output;
}

function normalizeExportResult(result) {
  if (!result) return { base64: null, bytes: null, error: "empty result" };

  if (typeof result === "string") {
    const base64 = result.replace(/^data:[^;]+;base64,/, "");
    return base64 ? { base64, bytes: null, error: null } : { base64: null, bytes: null, error: "empty string result" };
  }

  if (result instanceof Uint8Array) {
    return result.length > 0
      ? { base64: bytesToBase64(result), bytes: result, error: null }
      : { base64: null, bytes: null, error: "empty Uint8Array" };
  }

  if (result instanceof ArrayBuffer) {
    const bytes = new Uint8Array(result);
    return bytes.length > 0
      ? { base64: bytesToBase64(bytes), bytes, error: null }
      : { base64: null, bytes: null, error: "empty ArrayBuffer" };
  }

  if (Array.isArray(result)) {
    const bytes = new Uint8Array(result);
    return bytes.length > 0
      ? { base64: bytesToBase64(bytes), bytes, error: null }
      : { base64: null, bytes: null, error: "empty number array" };
  }

  if (typeof result === "object") {
    if (typeof result.base64 === "string") {
      return result.base64
        ? { base64: result.base64.replace(/^data:[^;]+;base64,/, ""), bytes: null, error: null }
        : { base64: null, bytes: null, error: "empty result.base64" };
    }
    const nested = result.bytes ?? result.data ?? result.buffer ?? result.contents;
    if (nested && nested !== result) {
      return normalizeExportResult(nested);
    }
    return { base64: null, bytes: null, error: `unsupported result object keys: ${Object.keys(result).join(",")}` };
  }

  return { base64: null, bytes: null, error: `unsupported result type: ${typeof result}` };
}

function hasImageFill(node) {
  const fills = Array.isArray(node.fills) ? node.fills : [];
  return fills.some((fill) => fill?.type === "IMAGE" || fill?.type === "IMAGE_URL");
}

function needsRasterFallback(node) {
  return node.type === "PEN" || node.type === "POLYGON";
}

function normalizeVectorPaths(node) {
  const rawPaths = node.vectorPaths ?? node.path ?? node.paths ?? [];
  if (!Array.isArray(rawPaths)) return [];
  return rawPaths
    .map((segment) => {
      if (typeof segment === "string") {
        return { windingRule: "NONZERO", data: segment };
      }
      if (segment?.data) {
        return {
          windingRule: segment.windingRule ?? "NONZERO",
          data: segment.data
        };
      }
      if (segment?.path) {
        return {
          windingRule: segment.windingRule ?? "NONZERO",
          data: segment.path
        };
      }
      return null;
    })
    .filter((segment) => typeof segment?.data === "string" && segment.data.length > 0);
}

async function exportImagePayload(node) {
  if (node.type !== "IMAGE" && !hasImageFill(node) && !needsRasterFallback(node)) return null;

  const settingsList = [
    {
      format: "PNG",
      constraint: { type: "SCALE", value: 2 },
      useAbsoluteBounds: true,
      useRenderBounds: true
    },
    {
      format: "PNG",
      constraint: { type: "SCALE", value: 1 },
      useAbsoluteBounds: true,
      useRenderBounds: true
    },
    { format: "PNG" }
  ];
  const errors = [];

  async function tryExport(methodName, settings) {
    if (typeof node[methodName] !== "function") return null;
    try {
      const result = await node[methodName](settings);
      const normalized = normalizeExportResult(result);
      if (normalized.base64) {
        return normalized;
      }
      errors.push(`${methodName}(${settings.format}): ${normalized.error}`);
      return null;
    } catch (error) {
      errors.push(`${methodName}(${settings.format}): ${String(error?.message ?? error)}`);
      return null;
    }
  }

  try {
    let exported = null;
    for (const settings of settingsList) {
      exported = await tryExport("exportAsync", settings);
      if (exported) break;
    }
    for (const settings of settingsList) {
      if (exported) break;
      exported = await tryExport("export", settings);
    }

    if (!exported) {
      return {
        error: errors.length ? errors.join("; ") : "No export/exportAsync method available."
      };
    }

    return {
      id: `${node.id}-image`,
      mimeType: "image/png",
      sizeBytes: exported.bytes?.length ?? exported.base64.length,
      base64: exported.base64,
      width: node.width,
      height: node.height
    };
  } catch (error) {
    return {
      error: String(error?.message ?? error)
    };
  }
}

function postToUI(type, payload = {}) {
  mg.ui.postMessage({
    type,
    payload,
    at: new Date().toISOString()
  }, "*");
}

async function serializeMgNode(node) {
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
    cornerRadius: node.cornerRadius,
    vectorPaths: normalizeVectorPaths(node)
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
    base.image = await exportImagePayload(node);
  }
  if (needsRasterFallback(node)) {
    base.image = await exportImagePayload(node);
  }

  base.tokenRefs = clone(node.tokenRefs ?? []);
  base.children = [];
  if ("children" in node && Array.isArray(node.children)) {
    base.children = await Promise.all(node.children.map((child) => serializeMgNode(child)));
  }
  return base;
}

function getRootsFromMode(mode) {
  if (mode === "selection") {
    return mg.document.currentPage.selection;
  }
  return [mg.document.currentPage];
}

async function runExport(mode = "currentPage") {
  try {
    postToUI("export:status", {
      phase: "collecting",
      message: mode === "selection" ? "正在读取当前选区..." : "正在读取当前页面..."
    });

    const sourceRoots = getRootsFromMode(mode);
    if (!Array.isArray(sourceRoots) || sourceRoots.length === 0) {
      throw new Error("当前没有可导出的节点，请先选择画板或切换为导出当前页面。");
    }

    postToUI("export:status", {
      phase: "serializing",
      message: `已找到 ${sourceRoots.length} 个根节点，正在序列化节点树...`
    });

    const roots = await Promise.all(sourceRoots.map((node) => serializeMgNode(node)));
    postToUI("export:status", {
      phase: "building",
      message: "正在生成 Mg-to-Fig JSON..."
    });

    const result = exportFromMasterGo({
      roots,
      exportMode: mode,
      documentMeta: {
        sourceFileId: mg.document.id ?? "unknown-file",
        sourcePageId: mg.document.currentPage?.id ?? "unknown-page",
        sourcePageName: mg.document.currentPage?.name ?? "unknown-page"
      }
    });

    postToUI("export:result", {
      ...result,
      summary: {
        mode,
        nodes: result.document.nodes.length,
        assets: result.document.assets.length,
        tokens: result.document.tokens.length,
        diagnostics: result.document.diagnostics.length,
        valid: result.validation.valid
      }
    });
  } catch (error) {
    postToUI("export:error", {
      message: String(error?.message ?? error),
      stack: String(error?.stack ?? ""),
      context: {
        mode,
        documentId: mg.documentId ?? mg.document?.id ?? "unknown",
        pageId: mg.document.currentPage?.id ?? "unknown-page",
        pageName: mg.document.currentPage?.name ?? "unknown-page",
        apiVersion: mg.apiVersion ?? "unknown"
      }
    });
  }
}

mg.showUI(__html__, { width: 420, height: 560 });
mg.ui.onmessage = (msg) => {
  const message = msg?.pluginMessage ?? msg;
  if (message.type === "ui:ready") {
    postToUI("plugin:ready", {
      message: "插件已就绪，可以开始导出。",
      apiVersion: mg.apiVersion ?? "unknown",
      pageName: mg.document.currentPage?.name ?? "unknown-page"
    });
  }
  if (message.type === "export:selection") {
    runExport("selection");
  }
  if (message.type === "export:page") {
    runExport("currentPage");
  }
  if (message.type === "report:log") {
    console.log("[Mg-to-Fig report]", message.payload);
  }
};

