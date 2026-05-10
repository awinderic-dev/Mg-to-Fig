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

function collectAsset(node, options, assets, diagnostics) {
  if (node.type !== "IMAGE" || !node.image) return null;

  const image = node.image;
  const sizeBytes = Number(image.sizeBytes ?? 0);
  const useInline = sizeBytes <= options.assetInlineLimitBytes;
  const asset = {
    id: image.id ?? `${node.id}-image`,
    type: "image",
    mimeType: image.mimeType ?? "image/png",
    sizeBytes,
    transport: useInline ? "inline" : "external",
    uri: useInline ? null : image.uri ?? null,
    data: useInline ? image.base64 ?? null : null,
    checksum: image.checksum ?? null
  };

  if (!useInline && !asset.uri) {
    diagnostics.push(
      createDiagnostic({
        level: "error",
        code: ERROR_CODES.ASSET_MISSING,
        nodeId: node.id,
        assetId: asset.id,
        message: "Large image asset has no URI.",
        fallbackApplied: false
      })
    );
  }

  assets.push(asset);
  return asset.id;
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
  output.push({ node, parentId });
  const children = Array.isArray(node.children) ? node.children : [];
  for (const child of children) {
    flattenNodeTree(child, node.id, output);
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
  const nodes = [];
  const diagnostics = [];
  const tokenRegistry = new Map();

  for (const { node, parentId } of flattened) {
    if (!SUPPORTED_NODE_TYPES.has(node.type)) {
      diagnostics.push(
        createDiagnostic({
          level: "warn",
          code: ERROR_CODES.NODE_UNSUPPORTED,
          nodeId: node.id ?? null,
          message: `Unsupported node type: ${node.type ?? "UNKNOWN"}.`,
          fallbackApplied: true
        })
      );
      continue;
    }

    const imageRef = collectAsset(node, { assetInlineLimitBytes }, assets, diagnostics);
    collectTokenRegistry(node, tokenRegistry);

    nodes.push({
      id: node.id,
      type: node.type,
      name: node.name ?? node.id,
      visible: node.visible !== false,
      locked: node.locked === true,
      parentId,
      children: (node.children ?? []).map((child) => child.id),
      geometry: normalizeGeometry(node),
      layout: normalizeLayout(node),
      style: normalizeStyle(node),
      text: normalizeText(node),
      vectorPaths: Array.isArray(node.vectorPaths) ? node.vectorPaths : [],
      imageRef,
      componentRef: normalizeComponentRef(node),
      tokenRefs: normalizeTokenRefs(node)
    });
  }

  const document = createDocument({
    schemaVersion: SCHEMA_VERSION,
    documentMeta: createEmptyDocumentMeta({
      exportMode,
      ...documentMeta
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
