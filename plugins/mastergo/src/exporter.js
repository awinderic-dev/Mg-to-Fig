import {
  SCHEMA_VERSION,
  ERROR_CODES,
  createDiagnostic,
  createDocument,
  createEmptyDocumentMeta,
  validateDocument
} from "../../../packages/schema/src/index.js";

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

  if (asset?.transport === "external" && !asset.uri) return null;

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

export function exportFromMasterGo({
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
