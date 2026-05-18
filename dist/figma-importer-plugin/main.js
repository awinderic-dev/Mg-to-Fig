(function() {
  var __async = function(__this, __arguments, generator) {
    return new Promise(function(resolve, reject) {
      var fulfilled = function(value) {
        try {
          step(generator.next(value));
        } catch (e) {
          reject(e);
        }
      };
      var rejected = function(value) {
        try {
          step(generator.throw(value));
        } catch (e) {
          reject(e);
        }
      };
      var step = function(x) {
        return x.done ? resolve(x.value) : Promise.resolve(x.value).then(fulfilled, rejected);
      };
      step((generator = generator.apply(__this, __arguments)).next());
    });
  };

  // packages/schema/src/index.js
  var ERROR_CODES = {
    NODE_UNSUPPORTED: "E_NODE_UNSUPPORTED",
    STYLE_UNMAPPABLE: "E_STYLE_UNMAPPABLE",
    LAYOUT_CONFLICT: "E_LAYOUT_CONFLICT",
    COMPONENT_BIND_FAIL: "E_COMPONENT_BIND_FAIL",
    ASSET_MISSING: "E_ASSET_MISSING",
    ASSET_DEGRADED: "E_ASSET_DEGRADED",
    FONT_FALLBACK: "E_FONT_FALLBACK",
    TOKEN_BIND_PENDING: "E_TOKEN_BIND_PENDING"
  };
  function createDiagnostic(input) {
    var _a2, _b, _c, _d, _e;
    const source = input || {};
    const level = (_a2 = source.level) != null ? _a2 : "info";
    const code = source.code;
    const message = source.message;
    const nodeId = (_b = source.nodeId) != null ? _b : null;
    const assetId = (_c = source.assetId) != null ? _c : null;
    const fallbackApplied = (_d = source.fallbackApplied) != null ? _d : false;
    const details = (_e = source.details) != null ? _e : {};
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
    var _a2, _b, _c, _d, _e, _f, _g, _h;
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
      if (!isString(node.type)) errors.push(`nodes[${(_a2 = node.id) != null ? _a2 : "?"}].type must be a string.`);
      if (!isString(node.name)) errors.push(`nodes[${(_b = node.id) != null ? _b : "?"}].name must be a string.`);
      if (!Array.isArray(node.children)) errors.push(`nodes[${(_c = node.id) != null ? _c : "?"}].children must be an array.`);
      if (!isObject(node.geometry)) errors.push(`nodes[${(_d = node.id) != null ? _d : "?"}].geometry must be an object.`);
      if (!isObject(node.style)) errors.push(`nodes[${(_e = node.id) != null ? _e : "?"}].style must be an object.`);
    }
    const assets = ensureArray(document.assets);
    for (const asset of assets) {
      if (!isObject(asset)) {
        errors.push("Each asset must be an object.");
        continue;
      }
      if (!isString(asset.id)) errors.push("assets[].id must be a string.");
      if (!isString(asset.transport)) errors.push(`assets[${(_f = asset.id) != null ? _f : "?"}].transport must be a string.`);
      if (!isNumber(asset.sizeBytes)) errors.push(`assets[${(_g = asset.id) != null ? _g : "?"}].sizeBytes must be a number.`);
    }
    const tokens = ensureArray(document.tokens);
    for (const token of tokens) {
      if (!isObject(token)) {
        errors.push("Each token must be an object.");
        continue;
      }
      if (!isString(token.tokenId)) errors.push("tokens[].tokenId must be a string.");
      if (!isString(token.path)) errors.push(`tokens[${(_h = token.tokenId) != null ? _h : "?"}].path must be a string.`);
    }
    return {
      valid: errors.length === 0,
      errors
    };
  }

  // plugins/figma/src/importer.js
  var FALLBACK_FONT = { family: "Inter", style: "Regular" };
  var SUPPORTED_IMPORT_NODE_TYPES = /* @__PURE__ */ new Set([
    "FRAME",
    "GROUP",
    "TEXT",
    "RECTANGLE",
    "IMAGE",
    "VECTOR",
    "COMPONENT",
    "INSTANCE"
  ]);
  var FIGMA_IMAGE_MAX_DIMENSION = 4096;
  var MASTERGO_IMAGE_BASE_URL = "https://image-resource.mastergo.com";
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
    var _a2;
    const fonts = [];
    for (const item of availableFonts) {
      const fontName = (_a2 = item == null ? void 0 : item.fontName) != null ? _a2 : item;
      if ((fontName == null ? void 0 : fontName.family) && (fontName == null ? void 0 : fontName.style)) {
        fonts.push({ family: fontName.family, style: fontName.style });
      }
    }
    return fonts;
  }
  function isFontAvailable(fontName, availableFonts) {
    if (!availableFonts || availableFonts.length === 0) return true;
    return availableFonts.some(function(candidate) {
      return candidate.family === fontName.family && candidate.style === fontName.style;
    });
  }
  function findFamilyFont(family, preferredStyle, availableFonts) {
    var _a2, _b;
    if (!availableFonts || availableFonts.length === 0) return null;
    return (_b = (_a2 = availableFonts.find(function(font) {
      return font.family === family && font.style === preferredStyle;
    })) != null ? _a2 : availableFonts.find(function(font) {
      return font.family === family;
    })) != null ? _b : null;
  }
  function resolveFont(font, ruleSet, availableFonts = null) {
    var _a2, _b, _c, _d, _e, _f;
    const fontList = availableFonts ? normalizeAvailableFonts(availableFonts) : availableFonts;
    if (!(font == null ? void 0 : font.fontFamily)) return { fontName: FALLBACK_FONT, strategy: "systemFallback" };
    const exact = (_b = ruleSet == null ? void 0 : ruleSet.exact) == null ? void 0 : _b[`${font.fontFamily}:${(_a2 = font.fontStyle) != null ? _a2 : "Regular"}`];
    if (exact && isFontAvailable(exact, fontList)) return { fontName: exact, strategy: "exact" };
    const familyMatch = (_c = ruleSet == null ? void 0 : ruleSet.family) == null ? void 0 : _c[font.fontFamily];
    if (familyMatch) {
      const mapped = { family: familyMatch, style: (_d = font.fontStyle) != null ? _d : "Regular" };
      if (isFontAvailable(mapped, fontList)) return { fontName: mapped, strategy: "family" };
    }
    const sameFamily = findFamilyFont(font.fontFamily, (_e = font.fontStyle) != null ? _e : "Regular", fontList);
    if (sameFamily) return { fontName: sameFamily, strategy: "availableFamily" };
    const fallback = isFontAvailable(FALLBACK_FONT, fontList) ? FALLBACK_FONT : (_f = fontList == null ? void 0 : fontList[0]) != null ? _f : FALLBACK_FONT;
    return { fontName: fallback, strategy: "systemFallback" };
  }
  function collectAvailableFonts() {
    return __async(this, null, function* () {
      const figmaApi = globalThis.figma;
      if (typeof (figmaApi == null ? void 0 : figmaApi.listAvailableFontsAsync) !== "function") return [];
      return normalizeAvailableFonts(yield figmaApi.listAvailableFontsAsync());
    });
  }
  function buildFontPreflightReport(document, fontRuleSet = {}, availableFonts = []) {
    var _a2, _b, _c, _d, _e, _f;
    const fontList = normalizeAvailableFonts(availableFonts);
    const requested = /* @__PURE__ */ new Map();
    for (const node of (_a2 = document.nodes) != null ? _a2 : []) {
      if (node.type !== "TEXT" || !node.text) continue;
      const requestKey = `${(_b = node.text.fontFamily) != null ? _b : "Unknown"}:${(_c = node.text.fontStyle) != null ? _c : "Regular"}`;
      const resolved = resolveFont(node.text, fontRuleSet, fontList);
      const existing = (_f = requested.get(requestKey)) != null ? _f : {
        requested: {
          family: (_d = node.text.fontFamily) != null ? _d : "Unknown",
          style: (_e = node.text.fontStyle) != null ? _e : "Regular"
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
      fallbackCount: Array.from(requested.values()).filter(function(item) {
        return item.strategy !== "exact";
      }).length
    };
  }
  function collectImageRefsFromNode(node) {
    var _a2, _b;
    const refs = [];
    if (node.imageRef) refs.push({ nodeId: node.id, assetId: node.imageRef, field: "imageRef" });
    for (const fill of (_b = (_a2 = node.style) == null ? void 0 : _a2.fills) != null ? _b : []) {
      if ((fill == null ? void 0 : fill.type) === "IMAGE_REF" && fill.assetId) {
        refs.push({ nodeId: node.id, assetId: fill.assetId, field: "style.fills" });
      }
    }
    return refs;
  }
  function buildImportPreflightReport(document) {
    var _a2, _b, _c, _d, _e;
    const assets = (_a2 = document.assets) != null ? _a2 : [];
    const assetMap = new Map(assets.map(function(asset) {
      return [asset.id, asset];
    }));
    const imageRefs = ((_b = document.nodes) != null ? _b : []).flatMap(function(node) {
      return collectImageRefsFromNode(node);
    });
    const unsupportedNodeTypes = [];
    for (const node of (_c = document.nodes) != null ? _c : []) {
      if (!SUPPORTED_IMPORT_NODE_TYPES.has(node.type)) {
        unsupportedNodeTypes.push({ nodeId: node.id, type: node.type });
      }
    }
    return {
      nodeCount: (_e = (_d = document.nodes) == null ? void 0 : _d.length) != null ? _e : 0,
      assetCount: assets.length,
      imageAssetCount: assets.filter(function(asset) {
        return asset.type === "image";
      }).length,
      imageRefCount: imageRefs.length,
      missingAssetRefs: imageRefs.filter(function(ref) {
        return !assetMap.has(ref.assetId);
      }),
      oversizedImageAssets: assets.filter(function(asset) {
        return asset.type === "image";
      }).filter(function(asset) {
        var _a3, _b2;
        return Number((_a3 = asset.width) != null ? _a3 : 0) > FIGMA_IMAGE_MAX_DIMENSION || Number((_b2 = asset.height) != null ? _b2 : 0) > FIGMA_IMAGE_MAX_DIMENSION;
      }).map(function(asset) {
        var _a3, _b2;
        return {
          assetId: asset.id,
          width: (_a3 = asset.width) != null ? _a3 : null,
          height: (_b2 = asset.height) != null ? _b2 : null
        };
      }),
      unsupportedNodeTypes
    };
  }
  function nodeDepth(nodeById, nodeId, memo = /* @__PURE__ */ new Map()) {
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
    const nodeById = new Map(nodes.map(function(node) {
      return [node.id, node];
    }));
    const depthMemo = /* @__PURE__ */ new Map();
    return nodes.slice().sort(function(a, b) {
      const da = nodeDepth(nodeById, a.id, depthMemo);
      const db = nodeDepth(nodeById, b.id, depthMemo);
      if (da !== db) return da - db;
      return String(a.id).localeCompare(String(b.id));
    });
  }
  function pickBatch(sortedNodes, batch) {
    var _a2, _b;
    if (!batch) return sortedNodes;
    const offset = Math.max(0, Number((_a2 = batch.offset) != null ? _a2 : 0));
    const limitRaw = Number((_b = batch.limit) != null ? _b : sortedNodes.length);
    const limit = Number.isFinite(limitRaw) ? Math.max(0, limitRaw) : sortedNodes.length;
    return sortedNodes.slice(offset, offset + limit);
  }
  function applyGeometry(target, geometry) {
    var _a2, _b, _c, _d;
    target.x = (_a2 = geometry.x) != null ? _a2 : 0;
    target.y = (_b = geometry.y) != null ? _b : 0;
    target.resize(Math.max(1, (_c = geometry.width) != null ? _c : 1), Math.max(1, (_d = geometry.height) != null ? _d : 1));
    if (typeof geometry.rotation === "number") {
      target.rotation = geometry.rotation;
    }
  }
  function decodeBase64(base64) {
    const normalized = String(base64 != null ? base64 : "").replace(/^data:[^;]+;base64,/, "");
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
  function createImageFromAsset(asset, diagnostics, nodeId, imageCache) {
    return __async(this, null, function* () {
      var _a2;
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
          image = yield figma.createImageAsync(asset.uri);
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
            message: `Image asset load failed: ${String((_a2 = error == null ? void 0 : error.message) != null ? _a2 : error)}`,
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
    });
  }
  function applyLayout(target, node) {
    var _a2, _b, _c, _d, _e, _f, _g, _h, _i, _j, _k, _l, _m, _n, _o, _p, _q, _r, _s, _t, _u, _v, _w, _x;
    if (!("layoutMode" in target)) return;
    if (((_a2 = node.layout) == null ? void 0 : _a2.mode) === "autoLayout" && (target.type === "FRAME" || target.type === "COMPONENT")) {
      const direction = ((_b = node.layout) == null ? void 0 : _b.direction) === "row" ? "HORIZONTAL" : "VERTICAL";
      target.layoutMode = direction;
      target.primaryAxisSizingMode = (_d = (_c = node.layout) == null ? void 0 : _c.primaryAxisSizingMode) != null ? _d : "FIXED";
      target.counterAxisSizingMode = (_f = (_e = node.layout) == null ? void 0 : _e.counterAxisSizingMode) != null ? _f : "FIXED";
      target.primaryAxisAlignItems = (_h = (_g = node.layout) == null ? void 0 : _g.primaryAxisAlignItems) != null ? _h : "MIN";
      target.counterAxisAlignItems = (_j = (_i = node.layout) == null ? void 0 : _i.counterAxisAlignItems) != null ? _j : "MIN";
      target.itemSpacing = Number((_l = (_k = node.layout) == null ? void 0 : _k.itemSpacing) != null ? _l : 0);
      target.paddingTop = Number((_o = (_n = (_m = node.layout) == null ? void 0 : _m.padding) == null ? void 0 : _n.top) != null ? _o : 0);
      target.paddingRight = Number((_r = (_q = (_p = node.layout) == null ? void 0 : _p.padding) == null ? void 0 : _q.right) != null ? _r : 0);
      target.paddingBottom = Number((_u = (_t = (_s = node.layout) == null ? void 0 : _s.padding) == null ? void 0 : _t.bottom) != null ? _u : 0);
      target.paddingLeft = Number((_x = (_w = (_v = node.layout) == null ? void 0 : _v.padding) == null ? void 0 : _w.left) != null ? _x : 0);
    }
  }
  function applyLayoutChildSemantics(target, node) {
    var _a2, _b;
    const constraints = (_b = (_a2 = node.layout) == null ? void 0 : _a2.constraints) != null ? _b : {};
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
    return String(data != null ? data : "").replace(/,/g, " ").replace(/([MLCQZmlcqz])/g, " $1 ").replace(/\s+/g, " ").trim();
  }
  function resolveSolidFillColor(fill) {
    var _a2, _b, _c;
    if (!fill || fill.type !== "SOLID" || !fill.color) return "rgb(29,33,41)";
    const r = Math.round(((_a2 = fill.color.r) != null ? _a2 : 0) * 255);
    const g = Math.round(((_b = fill.color.g) != null ? _b : 0) * 255);
    const b = Math.round(((_c = fill.color.b) != null ? _c : 0) * 255);
    return `rgb(${r},${g},${b})`;
  }
  function buildSvgVectorNode(node, fillColor) {
    var _a2, _b, _c, _d, _e;
    const width = Math.max(1, Number((_b = (_a2 = node.geometry) == null ? void 0 : _a2.width) != null ? _b : 1));
    const height = Math.max(1, Number((_d = (_c = node.geometry) == null ? void 0 : _c.height) != null ? _d : 1));
    const paths = ((_e = node.vectorPaths) != null ? _e : []).map(function(segment) {
      const d = normalizeSvgPathData(segment.data);
      if (!d) return null;
      return `<path d="${d.replace(/"/g, "&quot;")}" fill="${fillColor}"/>`;
    }).filter(Boolean).join("");
    if (!paths) return null;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}">${paths}</svg>`;
    return figma.createNodeFromSvg(svg);
  }
  function resolveFills(styleFills, diagnostics, nodeId, assetMap, imageCache) {
    return __async(this, null, function* () {
      var _a2, _b, _c, _d, _e;
      if (!Array.isArray(styleFills)) return [];
      const result = [];
      for (const fill of styleFills) {
        if ((fill == null ? void 0 : fill.type) === "IMAGE_REF" && typeof fill.assetId === "string") {
          const image = yield createImageFromAsset(assetMap.get(fill.assetId), diagnostics, nodeId, imageCache);
          if (image == null ? void 0 : image.hash) {
            result.push({
              type: "IMAGE",
              imageHash: image.hash,
              scaleMode: (_a2 = fill.scaleMode) != null ? _a2 : "FILL",
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
        if ((fill == null ? void 0 : fill.type) === "IMAGE" && typeof fill.imageRef === "string") {
          try {
            const image = yield figma.createImageAsync(normalizeImageUri(fill.imageRef));
            result.push({
              type: "IMAGE",
              imageHash: image.hash,
              scaleMode: (_b = fill.scaleMode) != null ? _b : "FILL",
              opacity: typeof fill.alpha === "number" ? fill.alpha : 1
            });
          } catch (error) {
            diagnostics.push(
              createDiagnostic({
                level: "warn",
                code: ERROR_CODES.ASSET_MISSING,
                nodeId,
                message: `MasterGo imageRef load failed, fallback to solid: ${String((_c = error == null ? void 0 : error.message) != null ? _c : error)}`,
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
        if ((fill == null ? void 0 : fill.type) === "IMAGE_URL" && typeof fill.url === "string") {
          try {
            const image = yield figma.createImageAsync(fill.url);
            result.push({
              type: "IMAGE",
              imageHash: image.hash,
              scaleMode: (_d = fill.scaleMode) != null ? _d : "FILL"
            });
          } catch (error) {
            diagnostics.push(
              createDiagnostic({
                level: "warn",
                code: ERROR_CODES.ASSET_MISSING,
                nodeId,
                message: `Image fill load failed, fallback to solid: ${String((_e = error == null ? void 0 : error.message) != null ? _e : error)}`,
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
    });
  }
  function applyStyle(target, style, diagnostics, nodeId, assetMap, imageCache) {
    return __async(this, null, function* () {
      if (style.fills) target.fills = yield resolveFills(style.fills, diagnostics, nodeId, assetMap, imageCache);
      if (style.strokes) target.strokes = style.strokes;
      if (style.effects) target.effects = style.effects;
      if (typeof style.opacity === "number") target.opacity = style.opacity;
      if (typeof style.cornerRadius === "number" && "cornerRadius" in target) target.cornerRadius = style.cornerRadius;
      if (typeof style.strokeWeight === "number" && "strokeWeight" in target) target.strokeWeight = style.strokeWeight;
      if (style.strokeAlign && "strokeAlign" in target) target.strokeAlign = style.strokeAlign;
    });
  }
  function applyImageRef(target, node, assetMap, imageCache, diagnostics) {
    return __async(this, null, function* () {
      if (!node.imageRef || !("fills" in target)) return;
      const image = yield createImageFromAsset(assetMap.get(node.imageRef), diagnostics, node.id, imageCache);
      if (image == null ? void 0 : image.hash) {
        target.fills = [{
          type: "IMAGE",
          imageHash: image.hash,
          scaleMode: "FILL"
        }];
      }
    });
  }
  function applyVectorData(target, node, diagnostics) {
    var _a2;
    if (target.type !== "VECTOR") return true;
    if (Array.isArray(node.vectorPaths) && node.vectorPaths.length > 0) {
      try {
        target.vectorPaths = node.vectorPaths.map(function(segment) {
          var _a3;
          return {
            windingRule: (_a3 = segment.windingRule) != null ? _a3 : "NONZERO",
            data: normalizeSvgPathData(segment.data)
          };
        });
        return true;
      } catch (error) {
        diagnostics.push(
          createDiagnostic({
            level: "warn",
            code: ERROR_CODES.NODE_UNSUPPORTED,
            nodeId: node.id,
            message: `Vector path parse failed, fallback to empty vector: ${String((_a2 = error == null ? void 0 : error.message) != null ? _a2 : error)}`,
            fallbackApplied: true
          })
        );
        return false;
      }
    }
    return true;
  }
  function loadFont(fontName, fontLoadCache) {
    return __async(this, null, function* () {
      const key = fontKey(fontName);
      if (!fontLoadCache.has(key)) {
        fontLoadCache.set(key, figma.loadFontAsync(fontName));
      }
      yield fontLoadCache.get(key);
    });
  }
  function applyText(target, node, fontRuleSet, diagnostics, availableFonts, fontLoadCache) {
    return __async(this, null, function* () {
      var _a2, _b, _c, _d, _e;
      if (node.type !== "TEXT" || !node.text) return;
      let fontResolve = resolveFont(node.text, fontRuleSet, availableFonts);
      try {
        yield loadFont(fontResolve.fontName, fontLoadCache);
      } catch (error) {
        diagnostics.push(
          createDiagnostic({
            level: "warn",
            code: ERROR_CODES.FONT_FALLBACK,
            nodeId: node.id,
            message: `Font load failed, fallback applied: ${String((_a2 = error == null ? void 0 : error.message) != null ? _a2 : error)}`,
            fallbackApplied: true,
            details: {
              requestedFont: `${node.text.fontFamily}:${node.text.fontStyle}`,
              failedFont: `${fontResolve.fontName.family}:${fontResolve.fontName.style}`
            }
          })
        );
        fontResolve = { fontName: FALLBACK_FONT, strategy: "systemFallback" };
        yield loadFont(fontResolve.fontName, fontLoadCache);
      }
      target.fontName = fontResolve.fontName;
      target.fontSize = node.text.fontSize;
      target.fontName = { family: fontResolve.fontName.family, style: fontResolve.fontName.style };
      target.lineHeight = typeof node.text.lineHeight === "number" ? { unit: "PIXELS", value: node.text.lineHeight } : target.lineHeight;
      target.letterSpacing = { value: (_b = node.text.letterSpacing) != null ? _b : 0, unit: "PIXELS" };
      target.textAlignHorizontal = (_c = node.text.textAlignHorizontal) != null ? _c : "LEFT";
      target.textAlignVertical = (_d = node.text.textAlignVertical) != null ? _d : "TOP";
      if ("textAutoResize" in target && node.text.textMode === "single-line") {
        target.textAutoResize = "WIDTH_AND_HEIGHT";
      }
      target.characters = (_e = node.text.characters) != null ? _e : "";
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
    });
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
    var _a2;
    if (!Array.isArray(node.tokenRefs) || node.tokenRefs.length === 0) return;
    const tokenSummary = node.tokenRefs.map(function(ref) {
      var _a3, _b;
      return (_b = (_a3 = ref.path) != null ? _a3 : ref.name) != null ? _b : ref.tokenId;
    }).join(",");
    target.setPluginData("mgTokenRefs", tokenSummary);
    for (const ref of node.tokenRefs) {
      const token = tokenMap.get(ref.tokenId);
      if (!token || token.bindingStatus !== "bound") {
        diagnostics.push(
          createDiagnostic({
            level: "info",
            code: ERROR_CODES.TOKEN_BIND_PENDING,
            nodeId: node.id,
            message: `Token pending bind: ${(_a2 = ref.path) != null ? _a2 : ref.tokenId}`,
            fallbackApplied: true
          })
        );
      }
    }
  }
  function compareNumberish(actual, expected) {
    if (typeof actual !== "number" || typeof expected !== "number") return actual === expected;
    return Math.abs(actual - expected) < 1e-3;
  }
  function compareStyleParam(actualNode, sourceNode) {
    var _a2;
    const mismatches = [];
    const expected = (_a2 = sourceNode.style) != null ? _a2 : {};
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
  function buildParameterDiffReport(sourceNodes, createdBySourceId) {
    var _a2, _b, _c, _d, _e, _f;
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
      const g = (_a2 = sourceNode.geometry) != null ? _a2 : {};
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
      nodeMismatches.push.apply(nodeMismatches, compareStyleParam(targetNode, sourceNode));
      if (sourceNode.type === "TEXT" && sourceNode.text) {
        if (!compareNumberish(targetNode.fontSize, sourceNode.text.fontSize)) {
          nodeMismatches.push({
            field: "fontSize",
            expected: sourceNode.text.fontSize,
            actual: targetNode.fontSize
          });
        }
        if (sourceNode.text.lineHeight && ((_b = targetNode.lineHeight) == null ? void 0 : _b.value)) {
          if (!compareNumberish(targetNode.lineHeight.value, sourceNode.text.lineHeight)) {
            nodeMismatches.push({
              field: "lineHeight",
              expected: sourceNode.text.lineHeight,
              actual: targetNode.lineHeight.value
            });
          }
        }
        if (((_c = targetNode.characters) != null ? _c : "") !== ((_d = sourceNode.text.characters) != null ? _d : "")) {
          nodeMismatches.push({
            field: "characters",
            expected: (_e = sourceNode.text.characters) != null ? _e : "",
            actual: (_f = targetNode.characters) != null ? _f : ""
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
  function createImportSession() {
    return {
      createdById: /* @__PURE__ */ new Map(),
      imageCache: /* @__PURE__ */ new Map(),
      fontLoadCache: /* @__PURE__ */ new Map()
    };
  }
  function hydrateCreatedNodesFromPage(createdById) {
    var _a2;
    const figmaApi = globalThis.figma;
    if (typeof ((_a2 = figmaApi == null ? void 0 : figmaApi.currentPage) == null ? void 0 : _a2.findAll) !== "function") return;
    const importedNodes = figmaApi.currentPage.findAll(function(node) {
      return typeof node.getPluginData === "function" && node.getPluginData("mgSourceNodeId");
    });
    for (const node of importedNodes) {
      createdById.set(node.getPluginData("mgSourceNodeId"), node);
    }
  }
  function importToFigma(_0) {
    return __async(this, arguments, function* ({
      document,
      fontRuleSet = {},
      batch = null,
      session = null,
      availableFonts = null
    }) {
      var _a2, _b, _c, _d, _e, _f, _g;
      const validation = validateDocument(document);
      const diagnostics = ((_a2 = document.diagnostics) != null ? _a2 : []).slice();
      if (!validation.valid) {
        return {
          createdNodes: [],
          diagnostics: diagnostics.concat(
            validation.errors.map(
              function(message) {
                return createDiagnostic({
                  level: "error",
                  code: ERROR_CODES.STYLE_UNMAPPABLE,
                  message,
                  fallbackApplied: false
                });
              }
            )
          )
        };
      }
      const activeSession2 = session != null ? session : createImportSession();
      const createdById = activeSession2.createdById;
      hydrateCreatedNodesFromPage(createdById);
      const sortedNodes = sortNodesForImport(document.nodes);
      const batchedNodes = pickBatch(sortedNodes, batch);
      const tokenMap = new Map(((_b = document.tokens) != null ? _b : []).map(function(token) {
        return [token.tokenId, token];
      }));
      const assetMap = new Map(((_c = document.assets) != null ? _c : []).map(function(asset) {
        return [asset.id, asset];
      }));
      const preflight = buildImportPreflightReport(document);
      const resolvedAvailableFonts = normalizeAvailableFonts(availableFonts != null ? availableFonts : yield collectAvailableFonts());
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
        yield applyStyle(raw, node.style, diagnostics, node.id, assetMap, activeSession2.imageCache);
        yield applyImageRef(raw, node, assetMap, activeSession2.imageCache, diagnostics);
        const vectorApplied = applyVectorData(raw, node, diagnostics);
        if (!vectorApplied && node.type === "VECTOR") {
          const svgNode = buildSvgVectorNode(node, resolveSolidFillColor((_e = (_d = node.style) == null ? void 0 : _d.fills) == null ? void 0 : _e[0]));
          if (svgNode) {
            raw.remove();
            raw = svgNode;
            raw.name = node.name;
            applyGeometry(raw, node.geometry);
          }
        }
        yield applyText(raw, node, fontRuleSet, diagnostics, resolvedAvailableFonts, activeSession2.fontLoadCache);
        let target = applyComponentSemantics(raw, node, createdById, diagnostics);
        if (target !== raw) {
          raw.remove();
          applyGeometry(target, node.geometry);
          applyLayout(target, node);
          yield applyStyle(target, node.style, diagnostics, node.id, assetMap, activeSession2.imageCache);
          yield applyImageRef(target, node, assetMap, activeSession2.imageCache, diagnostics);
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
        session: activeSession2,
        batch: {
          total: sortedNodes.length,
          imported: batchedNodes.length,
          offset: (_f = batch == null ? void 0 : batch.offset) != null ? _f : 0,
          limit: (_g = batch == null ? void 0 : batch.limit) != null ? _g : batchedNodes.length
        }
      };
    });
  }

  // plugins/figma/src/postprocess.js
  var LAYOUT_ABBR_MAP = {
    layoutMode: {
      h: "HORIZONTAL",
      v: "VERTICAL",
      n: "NONE",
      g: "GRID"
    },
    layoutWrap: {
      n: "NO_WRAP",
      w: "WRAP"
    },
    primaryAxisAlignItems: {
      s: "MIN",
      e: "MAX",
      c: "CENTER",
      b: "SPACE_BETWEEN"
    },
    counterAxisAlignItems: {
      s: "MIN",
      e: "MAX",
      c: "CENTER",
      b: "SPACE_BETWEEN"
    },
    primaryAxisSizingMode: {
      f: "FIXED",
      a: "AUTO"
    },
    counterAxisSizingMode: {
      a: "AUTO",
      f: "FIXED"
    },
    layoutSizingHorizontal: {
      f: "FIXED",
      h: "HUG",
      l: "FILL"
    },
    layoutSizingVertical: {
      f: "FIXED",
      h: "HUG",
      l: "FILL"
    },
    counterAxisAlignContent: {
      a: "AUTO",
      b: "SPACE_BETWEEN"
    }
  };
  var AY_PROP_ORDER = [
    "layoutMode",
    "layoutWrap",
    "primaryAxisAlignItems",
    "counterAxisAlignItems",
    "primaryAxisSizingMode",
    "counterAxisSizingMode",
    "layoutSizingHorizontal",
    "layoutSizingVertical",
    "counterAxisAlignContent"
  ];
  var AY_NUM_ORDER = [
    "itemSpacing",
    "counterAxisSpacing",
    "paddingTop",
    "paddingRight",
    "paddingBottom",
    "paddingLeft"
  ];
  var STYLE_PROPS_TO_LIFT = [
    "fills",
    "strokes",
    "strokeWeight",
    "strokeAlign",
    "strokeCap",
    "strokeJoin",
    "effects",
    "opacity",
    "cornerRadius",
    "topLeftRadius",
    "topRightRadius",
    "bottomRightRadius",
    "bottomLeftRadius"
  ];
  var EFFECT_BLEND_MODE = {
    n: "NORMAL",
    d: "DARKEN",
    m: "MULTIPLY",
    cb: "COLOR_BURN",
    l: "LIGHTEN",
    s: "SCREEN",
    cd: "COLOR_DODGE",
    o: "OVERLAY",
    sl: "SOFT_LIGHT",
    hl: "HARD_LIGHT",
    df: "DIFFERENCE",
    ex: "EXCLUSION",
    h: "HUE",
    st: "SATURATION",
    c: "COLOR",
    lm: "LUMINOSITY",
    pd: "PLUS_DARKER",
    pl: "PLUS_LIGHTER",
    pt: "PASS_THROUGH"
  };
  function supportsChildren(node) {
    return Boolean(node && Array.isArray(node.children));
  }
  function extractSegment(name, prefix) {
    const marker = `[${prefix}`;
    const start = String(name == null ? "" : name).indexOf(marker);
    if (start === -1) return "";
    let index = start + marker.length;
    let depth = 0;
    let result = "";
    while (index < name.length) {
      const char = name[index];
      if (char === "[") {
        depth += 1;
        result += char;
      } else if (char === "]") {
        if (depth === 0) break;
        depth -= 1;
        result += char;
      } else {
        result += char;
      }
      index += 1;
    }
    return result;
  }
  function stripMgPostprocessMarkers(name) {
    let pureName = String(name == null ? "" : name).trim();
    pureName = pureName.replace(/\]+/g, "]");
    const bracketIndex = pureName.indexOf("[");
    if (bracketIndex !== -1) pureName = pureName.slice(0, bracketIndex).trim();
    return pureName || "Untitled";
  }
  function parseNumArray(value) {
    const result = [];
    const regex = /\[(-?\d+(?:\.\d+)?)\]/g;
    let match;
    while ((match = regex.exec(String(value == null ? "" : value))) !== null) {
      result.push(Number(match[1]));
    }
    return result;
  }
  function canSet(node, prop) {
    return node && prop in node;
  }
  function hasAutoLayoutParent(node) {
    return Boolean(node && node.parent && "layoutMode" in node.parent && node.parent.layoutMode !== "NONE");
  }
  function setIfSupported(node, prop, value) {
    if (value === void 0 || !canSet(node, prop)) return false;
    try {
      node[prop] = value;
      return true;
    } catch (error) {
      return false;
    }
  }
  function fixSingleChildSpaceBetween(frame) {
    if (!frame || frame.type !== "FRAME" || frame.layoutMode === "NONE") return false;
    if (frame.primaryAxisAlignItems !== "SPACE_BETWEEN") return false;
    const visibleFlowChildren = (frame.children || []).filter(function(child) {
      return child.visible !== false && child.layoutPositioning !== "ABSOLUTE";
    });
    if (visibleFlowChildren.length !== 1) return false;
    frame.primaryAxisAlignItems = "MIN";
    return true;
  }
  function getAyLayoutDirection(segment) {
    const first = segment ? segment.charAt(0) : "";
    if (first === "h") return "HORIZONTAL";
    if (first === "v") return "VERTICAL";
    return null;
  }
  function sortChildrenForAutoLayout(node, direction, diagnostics) {
    if (!node || !direction || !supportsChildren(node) || node.children.length < 2) return 0;
    const sortable = [];
    for (const child of node.children) {
      if (!child || child.visible === false || child.layoutPositioning === "ABSOLUTE") continue;
      sortable.push(child);
    }
    if (sortable.length < 2) return 0;
    const ordered = sortable.slice().sort(function(a, b) {
      const ax = Number(a.x || 0);
      const ay = Number(a.y || 0);
      const bx = Number(b.x || 0);
      const by = Number(b.y || 0);
      if (direction === "HORIZONTAL") {
        return ax === bx ? ay - by : ax - bx;
      }
      return ay === by ? ax - bx : ay - by;
    });
    let changed = 0;
    for (let index = 0; index < ordered.length; index += 1) {
      if (node.children[index] === ordered[index]) continue;
      try {
        node.insertChild(index, ordered[index]);
        changed += 1;
      } catch (error) {
        diagnostics.push({
          level: "warn",
          code: "POSTPROCESS_REORDER_FAILED",
          nodeId: node.id || null,
          message: "Could not reorder child before Auto Layout: " + String(error && error.message ? error.message : error),
          fallbackApplied: true
        });
        break;
      }
    }
    return changed;
  }
  function applyAySegment(node, segment, diagnostics) {
    if (!segment) return 0;
    const abbrPart = segment.split("[")[0] || "";
    const numPart = segment.slice(abbrPart.length);
    const numbers = parseNumArray(numPart);
    let count = 0;
    count += sortChildrenForAutoLayout(node, getAyLayoutDirection(abbrPart), diagnostics);
    for (let index = 0; index < AY_PROP_ORDER.length; index += 1) {
      const prop = AY_PROP_ORDER[index];
      const value = LAYOUT_ABBR_MAP[prop] && LAYOUT_ABBR_MAP[prop][abbrPart[index]];
      if (!value) continue;
      if ((prop === "layoutSizingHorizontal" || prop === "layoutSizingVertical") && value === "FILL") {
        if (!hasAutoLayoutParent(node)) continue;
      }
      if (setIfSupported(node, prop, value)) count += 1;
    }
    if (numbers.length >= AY_NUM_ORDER.length && "paddingTop" in node) {
      for (let index = 0; index < AY_NUM_ORDER.length; index += 1) {
        const prop = AY_NUM_ORDER[index];
        if ((prop === "itemSpacing" || prop === "counterAxisSpacing") && node.layoutMode === "NONE") {
          continue;
        }
        if (setIfSupported(node, prop, numbers[index] || 0)) count += 1;
      }
    }
    if (fixSingleChildSpaceBetween(node)) {
      count += 1;
      diagnostics.push({
        level: "info",
        code: "POSTPROCESS_LAYOUT_NORMALIZED",
        nodeId: node.id || null,
        message: "SPACE_BETWEEN with one flow child changed to MIN.",
        fallbackApplied: true
      });
    }
    return count;
  }
  function applyPositionSegment(node, segment) {
    if (!segment) return 0;
    const mode = segment[0];
    const numbers = parseNumArray(segment.slice(1));
    let count = 0;
    if (mode === "p" && hasAutoLayoutParent(node)) {
      if (setIfSupported(node, "layoutPositioning", "ABSOLUTE")) count += 1;
      if (numbers.length >= 2) {
        if (setIfSupported(node, "x", numbers[0])) count += 1;
        if (setIfSupported(node, "y", numbers[1])) count += 1;
      }
    } else if (mode === "a" && hasAutoLayoutParent(node)) {
      if (setIfSupported(node, "layoutPositioning", "AUTO")) count += 1;
    }
    return count;
  }
  function applyWhSegment(node, segment) {
    if (!segment || segment.length < 2 || !hasAutoLayoutParent(node)) return 0;
    let count = 0;
    const horizontal = LAYOUT_ABBR_MAP.layoutSizingHorizontal[segment[0]];
    const vertical = LAYOUT_ABBR_MAP.layoutSizingVertical[segment[1]];
    if (horizontal) count += setIfSupported(node, "layoutSizingHorizontal", horizontal) ? 1 : 0;
    if (vertical) count += setIfSupported(node, "layoutSizingVertical", vertical) ? 1 : 0;
    return count;
  }
  function applyClipSegment(node, segment) {
    if (!segment || node.type !== "FRAME") return 0;
    return setIfSupported(node, "clipsContent", true) ? 1 : 0;
  }
  function parseBracketValues(segment) {
    const matches = String(segment == null ? "" : segment).match(/\[([^\]]*)\]/g);
    return matches ? matches.map(function(item) {
      return item.slice(1, -1);
    }) : [];
  }
  function parseHex8Color(hex) {
    if (!/^[0-9A-Fa-f]{8}$/.test(String(hex == null ? "" : hex))) return null;
    const value = String(hex == null ? "" : hex).toUpperCase();
    return {
      r: parseInt(value.slice(0, 2), 16) / 255,
      g: parseInt(value.slice(2, 4), 16) / 255,
      b: parseInt(value.slice(4, 6), 16) / 255,
      a: parseInt(value.slice(6, 8), 16) / 255
    };
  }
  function parseShadowEffect(segment, diagnostics, node) {
    const [type, visible, color, x, y, spread, radius, blend] = parseBracketValues(segment);
    const parsedColor = parseHex8Color(color);
    if (!parsedColor) {
      diagnostics.push({
        level: "warn",
        code: "POSTPROCESS_EFFECT_UNMAPPABLE",
        nodeId: node.id || null,
        message: "Shadow effect color could not be parsed.",
        fallbackApplied: true
      });
      return null;
    }
    return {
      type: type === "is" ? "INNER_SHADOW" : "DROP_SHADOW",
      color: parsedColor,
      offset: {
        x: Number(x) || 0,
        y: Number(y) || 0
      },
      spread: Number(spread) || 0,
      radius: Math.max(0, Number(radius) || 0),
      blendMode: EFFECT_BLEND_MODE[blend] || "NORMAL",
      visible: visible === "v"
    };
  }
  function parseBlurEffect(segment) {
    const [type, visible, radius, , mode, startRadius, , startX, startY, endX, endY] = parseBracketValues(segment);
    if (mode && mode !== "e") {
      return {
        type: type === "bb" ? "BACKGROUND_BLUR" : "LAYER_BLUR",
        blurType: "PROGRESSIVE",
        radius: Math.max(0, Number(radius) || 0),
        startRadius: Math.max(0, Number(startRadius) || 0),
        startOffset: { x: Number(startX) || 0, y: Number(startY) || 0 },
        endOffset: { x: Number(endX) || 0, y: Number(endY) || 0 },
        visible: visible === "v"
      };
    }
    return {
      type: type === "bb" ? "BACKGROUND_BLUR" : "LAYER_BLUR",
      radius: Math.max(0, Number(radius) || 0),
      visible: visible === "v"
    };
  }
  function parseEffectSegment(segment, node, diagnostics) {
    if (!segment || !("effects" in node)) return 0;
    const effects = [];
    for (const part of segment.split("_")) {
      const values = parseBracketValues(part);
      const type = values[0];
      let effect = null;
      if (type === "ds" || type === "is") {
        effect = parseShadowEffect(part, diagnostics, node);
      } else if (type === "lb" || type === "bb") {
        effect = parseBlurEffect(part);
      } else if (type) {
        diagnostics.push({
          level: "info",
          code: "POSTPROCESS_EFFECT_UNSUPPORTED",
          nodeId: node.id || null,
          message: `Effect marker ${type} is not supported by the postprocessor yet.`,
          fallbackApplied: true
        });
      }
      if (effect) effects.push(effect);
    }
    if (!effects.length) return 0;
    try {
      node.effects = effects;
      return 1;
    } catch (error) {
      diagnostics.push({
        level: "warn",
        code: "POSTPROCESS_EFFECT_APPLY_FAILED",
        nodeId: node.id || null,
        message: `Could not apply effect markers: ${String(error && error.message ? error.message : error)}`,
        fallbackApplied: true
      });
      return 0;
    }
  }
  function canLiftMaskStyle(mask, parent) {
    if (!mask || !parent || !supportsChildren(parent)) return false;
    if (!(mask.type === "RECTANGLE" || mask.type === "ELLIPSE")) return false;
    const tolerance = 0.01;
    const sameX = Math.abs((mask.x || 0) - 0) <= tolerance || Math.abs((mask.absoluteBoundingBox && mask.absoluteBoundingBox.x || 0) - (parent.absoluteBoundingBox && parent.absoluteBoundingBox.x || 0)) <= tolerance;
    const sameY = Math.abs((mask.y || 0) - 0) <= tolerance || Math.abs((mask.absoluteBoundingBox && mask.absoluteBoundingBox.y || 0) - (parent.absoluteBoundingBox && parent.absoluteBoundingBox.y || 0)) <= tolerance;
    return sameX && sameY && Math.abs((mask.width || 0) - (parent.width || 0)) <= tolerance && Math.abs((mask.height || 0) - (parent.height || 0)) <= tolerance;
  }
  function liftMaskStyle(parent, diagnostics) {
    if (!(parent && parent.type === "FRAME" || parent && parent.type === "GROUP")) return 0;
    const firstChild = parent.children && parent.children[0] || null;
    if (!canLiftMaskStyle(firstChild, parent)) return 0;
    for (const prop of STYLE_PROPS_TO_LIFT) {
      if (prop in firstChild && prop in parent && firstChild[prop] !== void 0) {
        try {
          parent[prop] = firstChild[prop];
        } catch (error) {
          diagnostics.push({
            level: "warn",
            code: "POSTPROCESS_STYLE_PARTIAL",
            nodeId: parent.id || null,
            message: `Could not lift mask style property: ${prop}.`,
            fallbackApplied: true
          });
        }
      }
    }
    try {
      firstChild.remove();
      return 1;
    } catch (error) {
      diagnostics.push({
        level: "warn",
        code: "POSTPROCESS_MASK_REMOVE_FAILED",
        nodeId: firstChild.id || null,
        message: `Could not remove lifted mask layer: ${String(error && error.message ? error.message : error)}`,
        fallbackApplied: true
      });
      return 0;
    }
  }
  function applyTextSegment(node) {
    if (node.type !== "TEXT") return 0;
    let count = 0;
    if (node.name.indexOf("[tt") > -1 && setIfSupported(node, "textTruncation", "ENDING")) count += 1;
    if (node.name.indexOf("[wh-hh") > -1 && setIfSupported(node, "textAutoResize", "WIDTH_AND_HEIGHT")) count += 1;
    return count;
  }
  function postprocessNode(node, options, diagnostics) {
    let changed = 0;
    const name = String(node.name == null ? "" : node.name);
    changed += applyAySegment(node, extractSegment(name, "ay-"), diagnostics);
    changed += applyPositionSegment(node, extractSegment(name, "py-"));
    changed += applyPositionSegment(node, extractSegment(name, "ncf-"));
    changed += applyWhSegment(node, extractSegment(name, "wh-"));
    changed += applyClipSegment(node, extractSegment(name, "cc-"));
    changed += parseEffectSegment(extractSegment(name, "ef-"), node, diagnostics);
    changed += applyTextSegment(node);
    if (options.repairMasks) {
      changed += liftMaskStyle(node, diagnostics);
    }
    if (options.cleanNames && name.indexOf("[") > -1) {
      const nextName = stripMgPostprocessMarkers(name);
      if (nextName !== name) {
        try {
          node.name = nextName;
          changed += 1;
        } catch (error) {
          diagnostics.push({
            level: "warn",
            code: "POSTPROCESS_RENAME_FAILED",
            nodeId: node.id || null,
            message: "Could not clean node name: " + String(error && error.message ? error.message : error),
            fallbackApplied: true
          });
        }
      }
    }
    return changed;
  }
  function walk(nodes, visit) {
    let count = 0;
    const snapshot = Array.prototype.slice.call(nodes || []);
    for (const node of snapshot) {
      try {
        count += visit(node);
      } catch (error) {
        const diagnostics = visit.diagnostics;
        if (diagnostics) {
          diagnostics.push({
            level: "warn",
            code: "POSTPROCESS_NODE_FAILED",
            nodeId: node && node.id ? node.id : null,
            message: "Node skipped: " + String(error && error.message ? error.message : error),
            fallbackApplied: true
          });
        }
      }
      if (node && !node.removed && supportsChildren(node)) {
        count += walk(node.children, visit);
      }
    }
    return count;
  }
  function postprocessMasterGoNodes(nodes, options = {}) {
    const resolvedOptions = {
      cleanNames: options.cleanNames !== false,
      repairMasks: options.repairMasks !== false
    };
    const diagnostics = [];
    const rootNodes = Array.isArray(nodes) ? nodes : [];
    const visit = function(node) {
      return postprocessNode(node, resolvedOptions, diagnostics);
    };
    visit.diagnostics = diagnostics;
    const changed = walk(rootNodes, visit);
    return {
      changed,
      diagnostics,
      processed: rootNodes.length
    };
  }

  // plugins/figma/src/main.js
  var activeSession = createImportSession();
  var _a;
  if ((_a = figma.command) == null ? void 0 : _a.startsWith("postprocess:")) {
    const result = postprocessMasterGoNodes(figma.currentPage.selection, {
      cleanNames: figma.command !== "postprocess:keep-names",
      repairMasks: true
    });
    const errorCount = result.diagnostics.filter(function(item) {
      return item.level === "error";
    }).length;
    const warnCount = result.diagnostics.filter(function(item) {
      return item.level === "warn";
    }).length;
    figma.notify(`\u4FEE\u590D\u5B8C\u6210: \u53D8\u66F4 ${result.changed} \u5904\uFF0C\u8B66\u544A ${warnCount}\uFF0C\u9519\u8BEF ${errorCount}`);
    figma.commitUndo();
    figma.closePlugin();
  } else {
    figma.showUI(__html__, { width: 380, height: 380 });
    figma.ui.onmessage = function(msg) {
      return __async(null, null, function* () {
        var _a2, _b, _c;
        if (msg.type === "import:reset-session") {
          activeSession = createImportSession();
          figma.ui.postMessage({
            type: "import:session-reset"
          });
        }
        if (msg.type === "import:start") {
          try {
            const result = yield importToFigma({
              document: msg.payload.document,
              fontRuleSet: (_a2 = msg.payload.fontRuleSet) != null ? _a2 : {},
              batch: (_b = msg.payload.batch) != null ? _b : null,
              session: activeSession
            });
            figma.ui.postMessage({
              type: "import:result",
              payload: {
                createdCount: result.createdNodes.length,
                diagnostics: result.diagnostics,
                diffReport: result.diffReport,
                preflight: result.preflight,
                fontPreflight: result.fontPreflight,
                batch: result.batch
              }
            });
          } catch (error) {
            figma.ui.postMessage({
              type: "import:error",
              payload: {
                message: String((_c = error == null ? void 0 : error.message) != null ? _c : error)
              }
            });
          }
        }
        if (msg.type === "close") {
          figma.closePlugin();
        }
      });
    };
  }
})();
