import { exportFromMasterGo } from "./exporter.js";

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
