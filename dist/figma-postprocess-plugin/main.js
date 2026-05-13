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
  var marker = `[${prefix}`;
  var start = String(name == null ? "" : name).indexOf(marker);
  if (start === -1) return "";

  var index = start + marker.length;
  var depth = 0;
  var result = "";
  while (index < name.length) {
    var char = name[index];
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
  var pureName = String(name == null ? "" : name).trim();
  pureName = pureName.replace(/\]+/g, "]");
  var bracketIndex = pureName.indexOf("[");
  if (bracketIndex !== -1) pureName = pureName.slice(0, bracketIndex).trim();
  return pureName || "Untitled";
}

function parseNumArray(value) {
  var result = [];
  var regex = /\[(-?\d+(?:\.\d+)?)\]/g;
  var match;
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
  if (value === undefined || !canSet(node, prop)) return false;
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
  var visibleFlowChildren = (frame.children || []).filter((child) => (
    child.visible !== false && child.layoutPositioning !== "ABSOLUTE"
  ));
  if (visibleFlowChildren.length !== 1) return false;
  frame.primaryAxisAlignItems = "MIN";
  return true;
}

function getAyLayoutDirection(segment) {
  var first = segment ? segment.charAt(0) : "";
  if (first === "h") return "HORIZONTAL";
  if (first === "v") return "VERTICAL";
  return null;
}

function sortChildrenForAutoLayout(node, direction, diagnostics) {
  if (!node || !direction || !supportsChildren(node) || node.children.length < 2) return 0;
  var sortable = [];
  for (var child of node.children) {
    if (!child || child.visible === false || child.layoutPositioning === "ABSOLUTE") continue;
    sortable.push(child);
  }
  if (sortable.length < 2) return 0;

  var ordered = sortable.slice().sort((a, b) => {
    var ax = Number(a.x || 0);
    var ay = Number(a.y || 0);
    var bx = Number(b.x || 0);
    var by = Number(b.y || 0);
    if (direction === "HORIZONTAL") {
      return ax === bx ? ay - by : ax - bx;
    }
    return ay === by ? ax - bx : ay - by;
  });

  var changed = 0;
  for (var index = 0; index < ordered.length; index += 1) {
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
  var abbrPart = segment.split("[")[0] || "";
  var numPart = segment.slice(abbrPart.length);
  var numbers = parseNumArray(numPart);
  var count = 0;
  count += sortChildrenForAutoLayout(node, getAyLayoutDirection(abbrPart), diagnostics);

  for (var index = 0; index < AY_PROP_ORDER.length; index += 1) {
    var prop = AY_PROP_ORDER[index];
    var value = (LAYOUT_ABBR_MAP[prop] && LAYOUT_ABBR_MAP[prop][abbrPart[index]]);
    if (!value) continue;

    if ((prop === "layoutSizingHorizontal" || prop === "layoutSizingVertical") && value === "FILL") {
      if (!hasAutoLayoutParent(node)) continue;
    }
    if (setIfSupported(node, prop, value)) count += 1;
  }

  if (numbers.length >= AY_NUM_ORDER.length && "paddingTop" in node) {
    for (var index = 0; index < AY_NUM_ORDER.length; index += 1) {
      var prop = AY_NUM_ORDER[index];
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
  var mode = segment[0];
  var numbers = parseNumArray(segment.slice(1));
  var count = 0;
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
  var count = 0;
  var horizontal = LAYOUT_ABBR_MAP.layoutSizingHorizontal[segment[0]];
  var vertical = LAYOUT_ABBR_MAP.layoutSizingVertical[segment[1]];
  if (horizontal) count += setIfSupported(node, "layoutSizingHorizontal", horizontal) ? 1 : 0;
  if (vertical) count += setIfSupported(node, "layoutSizingVertical", vertical) ? 1 : 0;
  return count;
}

function applyClipSegment(node, segment) {
  if (!segment || node.type !== "FRAME") return 0;
  return setIfSupported(node, "clipsContent", true) ? 1 : 0;
}

function parseBracketValues(segment) {
  var matches = String(segment == null ? "" : segment).match(/\[([^\]]*)\]/g);
  return matches ? matches.map((item) => item.slice(1, -1)) : [];
}

function parseHex8Color(hex) {
  if (!/^[0-9A-Fa-f]{8}$/.test(String(hex == null ? "" : hex))) return null;
  var value = String(hex == null ? "" : hex).toUpperCase();
  return {
    r: parseInt(value.slice(0, 2), 16) / 255,
    g: parseInt(value.slice(2, 4), 16) / 255,
    b: parseInt(value.slice(4, 6), 16) / 255,
    a: parseInt(value.slice(6, 8), 16) / 255
  };
}

function parseShadowEffect(segment, diagnostics, node) {
  var [type, visible, color, x, y, spread, radius, blend] = parseBracketValues(segment);
  var parsedColor = parseHex8Color(color);
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
  var [type, visible, radius, , mode, startRadius, , startX, startY, endX, endY] = parseBracketValues(segment);
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
  var effects = [];
  for (var part of segment.split("_")) {
    var values = parseBracketValues(part);
    var type = values[0];
    var effect = null;
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
  var tolerance = 0.01;
  var sameX = Math.abs((mask.x || 0) - 0) <= tolerance || Math.abs(((mask.absoluteBoundingBox && mask.absoluteBoundingBox.x) || 0) - ((parent.absoluteBoundingBox && parent.absoluteBoundingBox.x) || 0)) <= tolerance;
  var sameY = Math.abs((mask.y || 0) - 0) <= tolerance || Math.abs(((mask.absoluteBoundingBox && mask.absoluteBoundingBox.y) || 0) - ((parent.absoluteBoundingBox && parent.absoluteBoundingBox.y) || 0)) <= tolerance;
  return sameX
    && sameY
    && Math.abs((mask.width || 0) - (parent.width || 0)) <= tolerance
    && Math.abs((mask.height || 0) - (parent.height || 0)) <= tolerance;
}

function liftMaskStyle(parent, diagnostics) {
  if (!((parent && parent.type === "FRAME") || (parent && parent.type === "GROUP"))) return 0;
  var firstChild = (parent.children && parent.children[0]) || null;
  if (!canLiftMaskStyle(firstChild, parent)) return 0;

  for (var prop of STYLE_PROPS_TO_LIFT) {
    if (prop in firstChild && prop in parent && firstChild[prop] !== undefined) {
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
  var count = 0;
  if (node.name.indexOf("[tt") > -1 && setIfSupported(node, "textTruncation", "ENDING")) count += 1;
  if (node.name.indexOf("[wh-hh") > -1 && setIfSupported(node, "textAutoResize", "WIDTH_AND_HEIGHT")) count += 1;
  return count;
}

function postprocessNode(node, options, diagnostics) {
  var changed = 0;
  var name = String(node.name == null ? "" : node.name);
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
    var nextName = stripMgPostprocessMarkers(name);
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
  var count = 0;
  var snapshot = Array.prototype.slice.call(nodes || []);
  for (var node of snapshot) {
    try {
      count += visit(node);
    } catch (error) {
      var diagnostics = visit.diagnostics;
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
  var resolvedOptions = {
    cleanNames: options.cleanNames !== false,
    repairMasks: options.repairMasks !== false
  };
  var diagnostics = [];
  var rootNodes = Array.isArray(nodes) ? nodes : [];
  var visit = (node) => postprocessNode(node, resolvedOptions, diagnostics);
  visit.diagnostics = diagnostics;
  var changed = walk(rootNodes, visit);
  return {
    changed,
    diagnostics,
    processed: rootNodes.length
  };
}


try {
  var selected = figma.currentPage.selection;
  if (!selected || selected.length === 0) {
    figma.notify('请先选中 SK 导入后的页面或容器', { error: true });
    figma.closePlugin();
  } else {
    var result = postprocessMasterGoNodes(selected, {
      cleanNames: figma.command !== 'postprocess:keep-names',
      repairMasks: true
    });
    var warnCount = result.diagnostics.filter(function (item) { return item.level === 'warn'; }).length;
    var errorCount = result.diagnostics.filter(function (item) { return item.level === 'error'; }).length;
    var firstWarn = result.diagnostics.filter(function (item) { return item.level === 'warn'; })[0];
    var suffix = firstWarn ? ('；首个警告: ' + firstWarn.message) : '';
    figma.notify('修复完成: 变更 ' + result.changed + ' 处，警告 ' + warnCount + '，错误 ' + errorCount + suffix, { timeout: 8000 });
    if (typeof figma.commitUndo === 'function') figma.commitUndo();
    figma.closePlugin();
  }
} catch (error) {
  figma.notify('运行失败: ' + (error && error.message ? error.message : String(error)), { error: true, timeout: 8000 });
  figma.closePlugin();
}
