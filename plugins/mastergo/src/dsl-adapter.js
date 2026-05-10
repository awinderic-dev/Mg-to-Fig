import { exportFromMasterGo } from "./exporter.js";

const TYPE_MAP = {
  FRAME: "FRAME",
  GROUP: "GROUP",
  TEXT: "TEXT",
  INSTANCE: "INSTANCE",
  PATH: "VECTOR",
  SVG_ELLIPSE: "VECTOR",
  LAYER: "RECTANGLE"
};

function safeNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function parsePx(value, fallback = 0) {
  if (typeof value === "number") return value;
  if (typeof value !== "string") return fallback;
  const num = Number(value.replace("px", "").trim());
  return Number.isFinite(num) ? num : fallback;
}

function parseOpacity(value) {
  if (typeof value === "number") return value;
  if (typeof value !== "string") return 1;
  const num = Number(value);
  return Number.isFinite(num) ? Math.max(0, Math.min(1, num)) : 1;
}

function parseRgbaColor(raw) {
  if (typeof raw !== "string") return null;
  const match = /rgba?\(([^)]+)\)/.exec(raw);
  if (!match) return null;
  const parts = match[1].split(",").map((part) => part.trim());
  if (parts.length < 3) return null;
  const r = Number(parts[0]) / 255;
  const g = Number(parts[1]) / 255;
  const b = Number(parts[2]) / 255;
  const a = parts.length >= 4 ? Number(parts[3]) : 1;
  if (![r, g, b, a].every((v) => Number.isFinite(v))) return null;
  return { color: { r, g, b }, opacity: Math.max(0, Math.min(1, a)) };
}

function parseLinearGradient(raw) {
  if (typeof raw !== "string" || !raw.startsWith("linear-gradient(")) return null;
  const inside = raw.slice("linear-gradient(".length, -1);
  const pieces = inside.split(",").map((piece) => piece.trim()).filter(Boolean);
  if (pieces.length < 3) return null;

  const angleRaw = pieces.shift() ?? "180deg";
  const angle = Number(angleRaw.replace("deg", "").trim());
  const vertical = !Number.isFinite(angle) || angle === 180;
  const gradientTransform = vertical
    ? [[1, 0, 0], [0, 1, 0]]
    : [[0, 1, 0], [-1, 0, 1]];

  const gradientStops = [];
  for (const piece of pieces) {
    const stopMatch = /(#[0-9a-fA-F]{3,8}|rgba?\([^)]+\))\s+([0-9.]+)%/.exec(piece);
    if (!stopMatch) continue;
    const colorRaw = stopMatch[1];
    const pos = Number(stopMatch[2]) / 100;
    let color = null;
    let opacity = 1;
    if (colorRaw.startsWith("#")) {
      color = hexToColor(colorRaw);
    } else {
      const rgba = parseRgbaColor(colorRaw);
      if (rgba) {
        color = rgba.color;
        opacity = rgba.opacity;
      }
    }
    if (!color) continue;
    gradientStops.push({
      position: Math.max(0, Math.min(1, pos)),
      color: { ...color, a: opacity }
    });
  }

  if (gradientStops.length < 2) return null;
  return {
    type: "GRADIENT_LINEAR",
    gradientTransform,
    gradientStops
  };
}

function hexToColor(hex) {
  if (typeof hex !== "string" || !hex.startsWith("#")) return null;
  const normalized = hex.slice(1);
  const chunk = normalized.length === 3
    ? normalized.split("").map((part) => part + part).join("")
    : normalized;
  if (chunk.length !== 6) return null;
  const r = parseInt(chunk.slice(0, 2), 16) / 255;
  const g = parseInt(chunk.slice(2, 4), 16) / 255;
  const b = parseInt(chunk.slice(4, 6), 16) / 255;
  return { r, g, b };
}

function parseFontWeight(styleRaw) {
  if (!styleRaw || typeof styleRaw !== "string") return 400;
  const style = styleRaw.toLowerCase();
  if (style.includes("thin")) return 100;
  if (style.includes("extralight") || style.includes("ultralight")) return 200;
  if (style.includes("light")) return 300;
  if (style.includes("regular") || style.includes("normal")) return 400;
  if (style.includes("medium")) return 500;
  if (style.includes("semibold") || style.includes("demibold")) return 600;
  if (style.includes("bold")) return 700;
  if (style.includes("extrabold") || style.includes("ultrabold")) return 800;
  if (style.includes("black") || style.includes("heavy")) return 900;
  return 400;
}

function buildTokenRef(styleId, styles) {
  if (!styleId || typeof styleId !== "string") return null;
  const style = styles[styleId] ?? {};
  return {
    tokenId: styleId,
    path: style.token ?? styleId,
    name: style.token ?? styleId,
    kind: styleId.startsWith("paint_")
      ? "color"
      : styleId.startsWith("font_")
        ? "typography"
        : styleId.startsWith("effect_")
          ? "effect"
          : "unknown",
    resolvedValue: style.value ?? null
  };
}

function buildFills(fillRef, styles) {
  if (!fillRef || typeof fillRef !== "string") return [];
  const styleValue = styles[fillRef]?.value;
  if (!Array.isArray(styleValue) || styleValue.length === 0) return [];
  const first = styleValue[0];
  if (typeof first === "string") {
    const color = hexToColor(first);
    if (color) return [{ type: "SOLID", color, opacity: 1 }];

    const rgba = parseRgbaColor(first);
    if (rgba) return [{ type: "SOLID", color: rgba.color, opacity: rgba.opacity }];

    const gradient = parseLinearGradient(first);
    if (gradient) return [gradient];
  }
  if (isObject(first) && typeof first.url === "string" && first.url.length > 0) {
    return [{
      type: "IMAGE_URL",
      url: first.url,
      scaleMode: "FILL"
    }];
  }
  return [];
}

function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function buildEffects(effectRef, styles) {
  if (!effectRef || typeof effectRef !== "string") return [];
  const styleValue = styles[effectRef]?.value;
  if (!Array.isArray(styleValue)) return [];
  return styleValue
    .map((effect) => {
      if (!effect || typeof effect !== "object") return null;
      if (effect.type) return effect;
      if (effect.shadowColor || effect.shadowOffsetX || effect.shadowOffsetY || effect.shadowBlur) {
        const shadowColor = typeof effect.shadowColor === "string" ? parseRgbaColor(effect.shadowColor) : null;
        return {
          type: "DROP_SHADOW",
          visible: true,
          blendMode: "NORMAL",
          color: shadowColor
            ? { ...shadowColor.color, a: shadowColor.opacity }
            : { r: 0, g: 0, b: 0, a: 0.12 },
          offset: {
            x: parsePx(effect.shadowOffsetX, 0),
            y: parsePx(effect.shadowOffsetY, 1)
          },
          radius: parsePx(effect.shadowBlur, 2),
          spread: parsePx(effect.shadowSpread, 0)
        };
      }
      return null;
    })
    .filter(Boolean);
}

function buildStrokes(node, styles) {
  const strokeRef = node.strokeColor;
  if (!strokeRef || typeof strokeRef !== "string") return [];
  const fills = buildFills(strokeRef, styles);
  if (!fills.length) return [];
  const [first] = fills;
  return [{ ...first }];
}

function parsePadding(rawPadding) {
  if (!rawPadding || typeof rawPadding !== "string") {
    return { top: 0, right: 0, bottom: 0, left: 0 };
  }
  const parts = rawPadding.trim().split(/\s+/).map((part) => parsePx(part, 0));
  if (parts.length === 1) {
    return { top: parts[0], right: parts[0], bottom: parts[0], left: parts[0] };
  }
  if (parts.length === 2) {
    return { top: parts[0], right: parts[1], bottom: parts[0], left: parts[1] };
  }
  if (parts.length === 3) {
    return { top: parts[0], right: parts[1], bottom: parts[2], left: parts[1] };
  }
  return {
    top: parts[0] ?? 0,
    right: parts[1] ?? 0,
    bottom: parts[2] ?? 0,
    left: parts[3] ?? 0
  };
}

function parseLayoutMode(node) {
  const flex = node.flexContainerInfo;
  if (!flex || typeof flex !== "object") return "NONE";
  if (flex.flexDirection === "row" || flex.flexDirection === "column") return "AUTO";
  return "NONE";
}

function mapPrimaryAxisAlign(value) {
  const map = {
    start: "MIN",
    center: "CENTER",
    end: "MAX",
    "space-between": "SPACE_BETWEEN"
  };
  return map[value] ?? "MIN";
}

function mapCounterAxisAlign(value) {
  const map = {
    start: "MIN",
    center: "CENTER",
    end: "MAX",
    stretch: "STRETCH",
    baseline: "BASELINE"
  };
  return map[value] ?? "MIN";
}

function parseAxisSizing(value) {
  return value === "auto" ? "AUTO" : "FIXED";
}

function parseConstraints(node) {
  const constraints = {};
  if (typeof node.alignSelf === "string") {
    constraints.layoutAlign = mapCounterAxisAlign(node.alignSelf);
  }
  if (node.flexShrink === 0) {
    constraints.preserveSize = true;
  }
  if (node.flexGrow > 0) {
    constraints.grow = true;
    constraints.layoutGrow = safeNumber(node.flexGrow, 1);
  }
  return constraints;
}

function normalizeTextAlign(textAlign) {
  const map = {
    left: "LEFT",
    right: "RIGHT",
    center: "CENTER",
    justified: "JUSTIFIED"
  };
  return map[textAlign] ?? "LEFT";
}

function buildVectorInfo(node, styles) {
  if (node.type !== "PATH" || !Array.isArray(node.path) || node.path.length === 0) {
    return { fills: [], vectorPaths: [] };
  }
  const firstSegment = node.path[0] ?? {};
  const segmentFill = firstSegment.fill;
  return {
    fills: buildFills(segmentFill, styles),
    vectorPaths: node.path
      .map((segment) => ({
        windingRule: "NONZERO",
        data: segment.data
      }))
      .filter((segment) => typeof segment.data === "string" && segment.data.length > 0)
  };
}

function normalizeText(node, styles) {
  if (node.type !== "TEXT") return {};
  const segments = Array.isArray(node.text) ? node.text : [];
  const characters = segments.map((segment) => segment.text ?? "").join("");
  const firstSegment = segments[0] ?? {};
  const fontRef = firstSegment.font;
  const fontStyle = styles[fontRef]?.value ?? {};
  const styleRaw = fontStyle.style;
  const parsedStyle = (() => {
    if (typeof styleRaw !== "string") return {};
    try {
      return JSON.parse(styleRaw);
    } catch {
      return {};
    }
  })();

  return {
    characters,
    textMode: node.textMode ?? "single-line",
    fontFamily: fontStyle.family ?? "Inter",
    fontStyle: parsedStyle.fontStyle ?? "Regular",
    fontWeight: parseFontWeight(parsedStyle.fontStyle ?? fontStyle.style ?? "Regular"),
    fontSize: safeNumber(fontStyle.size, 14),
    lineHeight: safeNumber(fontStyle.lineHeight, 0) || "AUTO",
    letterSpacing: fontStyle.letterSpacing === "auto" ? 0 : safeNumber(fontStyle.letterSpacing, 0),
    textAlignHorizontal: normalizeTextAlign(node.textAlign ?? "left"),
    textAlignVertical: "TOP"
  };
}

function collectTokenRefs(node, styles) {
  const refs = [];
  if (typeof node.fill === "string") {
    const ref = buildTokenRef(node.fill, styles);
    if (ref) refs.push(ref);
  }

  if (typeof node.effect === "string") {
    const ref = buildTokenRef(node.effect, styles);
    if (ref) refs.push(ref);
  }

  if (node.type === "TEXT") {
    const segments = Array.isArray(node.text) ? node.text : [];
    for (const segment of segments) {
      if (segment.font) {
        const ref = buildTokenRef(segment.font, styles);
        if (ref) refs.push(ref);
      }
    }

    const textColors = Array.isArray(node.textColor) ? node.textColor : [];
    for (const textColor of textColors) {
      if (textColor.color) {
        const ref = buildTokenRef(textColor.color, styles);
        if (ref) refs.push(ref);
      }
    }
  }

  if (typeof node.strokeColor === "string") {
    const ref = buildTokenRef(node.strokeColor, styles);
    if (ref) refs.push(ref);
  }

  return refs;
}

function adaptNode(node, styles) {
  const mappedType = TYPE_MAP[node.type] ?? "GROUP";
  const layout = node.layoutStyle ?? {};
  const flex = node.flexContainerInfo ?? {};
  const padding = parsePadding(flex.padding);
  const vectorInfo = buildVectorInfo(node, styles);
  const tokenRefs = collectTokenRefs(node, styles);
  const text = normalizeText(node, styles);

  const adapted = {
    id: node.id,
    type: mappedType,
    name: node.name ?? node.id,
    x: safeNumber(layout.relativeX, 0),
    y: safeNumber(layout.relativeY, 0),
    width: safeNumber(layout.width, 0),
    height: safeNumber(layout.height, 0),
    rotation: safeNumber(node.rotation, 0),
    layoutMode: parseLayoutMode(node),
    constraints: parseConstraints(node),
    primaryAxisSizingMode: parseAxisSizing(flex.mainSizing),
    counterAxisSizingMode: parseAxisSizing(flex.crossSizing),
    primaryAxisAlignItems: mapPrimaryAxisAlign(flex.justifyContent),
    counterAxisAlignItems: mapCounterAxisAlign(flex.alignItems),
    paddingTop: padding.top,
    paddingRight: padding.right,
    paddingBottom: padding.bottom,
    paddingLeft: padding.left,
    itemSpacing: parsePx(flex.gap, 0),
    fills: vectorInfo.fills.length ? vectorInfo.fills : buildFills(node.fill, styles),
    strokes: buildStrokes(node, styles),
    strokeWeight: parsePx(node.strokeWidth, 0),
    strokeAlign: typeof node.strokeAlign === "string" ? node.strokeAlign.toUpperCase() : "INSIDE",
    effects: buildEffects(node.effect, styles),
    opacity: parseOpacity(node.opacity),
    cornerRadius: parsePx(node.borderRadius, 0),
    vectorPaths: vectorInfo.vectorPaths,
    tokenRefs,
    children: []
  };

  if (mappedType === "TEXT") {
    adapted.characters = text.characters;
    adapted.fontFamily = text.fontFamily;
    adapted.fontStyle = text.fontStyle;
    adapted.fontWeight = text.fontWeight;
    adapted.fontSize = text.fontSize;
    adapted.lineHeight = text.lineHeight;
    adapted.letterSpacing = text.letterSpacing;
    adapted.textAlignHorizontal = text.textAlignHorizontal;
    adapted.textAlignVertical = text.textAlignVertical;
  }

  if (mappedType === "INSTANCE") {
    adapted.mainComponentId = node.componentId ?? null;
    adapted.componentKey = node.componentId ?? node.id;
    adapted.overrides = node.componentInfo?.properties ?? {};
  }

  adapted.children = (node.children ?? []).map((child) => adaptNode(child, styles));
  return adapted;
}

export function exportFromDslPayload({
  dslPayload,
  documentMeta = {},
  exportMode = "selection",
  assetInlineLimitBytes
}) {
  const dsl = dslPayload.dsl ?? dslPayload;
  const styles = dsl.styles ?? {};
  const roots = (dsl.nodes ?? []).map((node) => adaptNode(node, styles));

  return exportFromMasterGo({
    roots,
    exportMode,
    documentMeta,
    assetInlineLimitBytes
  });
}
