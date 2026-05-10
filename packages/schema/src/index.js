export const SCHEMA_VERSION = "0.1.0";

export const ERROR_CODES = {
  NODE_UNSUPPORTED: "E_NODE_UNSUPPORTED",
  STYLE_UNMAPPABLE: "E_STYLE_UNMAPPABLE",
  LAYOUT_CONFLICT: "E_LAYOUT_CONFLICT",
  COMPONENT_BIND_FAIL: "E_COMPONENT_BIND_FAIL",
  ASSET_MISSING: "E_ASSET_MISSING",
  FONT_FALLBACK: "E_FONT_FALLBACK",
  TOKEN_BIND_PENDING: "E_TOKEN_BIND_PENDING"
};

export function createEmptyDocumentMeta(overrides = {}) {
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

export function createDiagnostic({
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

export function createDocument({
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

export function validateDocument(document) {
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
