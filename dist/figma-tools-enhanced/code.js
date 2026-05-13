"use strict";
// This file holds the main code for plugins. Code in this file has access to
// the *figma document* via the figma global object.
// You can access browser APIs in the <script> tag inside "ui.html" which has a
// full browser environment (See https://www.figma.com/plugin-docs/how-plugins-run).
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
// This plugin creates rectangles on the screen.
let baseStypleProps = ["fills", "effects", "backgroundsVisible", "effectsVisible"];
let strokeStypleProps = ["strokes", "strokeWeight", "strokeAlign", "strokeCap", "strokeJoin"];
let radiusStypleProps = ["cornerSmoothing", "cornerRadius"];
let radiiStypleProps = ["topLeftRadius", "topRightRadius", "bottomLeftRadius", "topRightRadius"];
// 1. 集中管理支持圆角的节点类型（新增/删除只需改这里）
const CORNER_SUPPORTED_TYPES = ["FRAME", "RECTANGLE", "ComponentNode", "ComponentSetNode", "InstanceNode"];
const LAYOUT_ABBR_MAP = {
    layoutMode: {
        HORIZONTAL: 'h',
        VERTICAL: 'v',
        NONE: 'n',
        GRID: 'g'
    },
    layoutWrap: {
        NO_WRAP: 'n',
        WRAP: 'w'
    },
    primaryAxisAlignItems: {
        MIN: 's',
        MAX: 'e',
        CENTER: 'c',
        SPACE_BETWEEN: 'b',
    },
    counterAxisAlignItems: {
        MIN: 's',
        MAX: 'e',
        CENTER: 'c',
        SPACE_BETWEEN: 'b',
    },
    primaryAxisSizingMode: {
        FIXED: 'f',
        AUTO: 'a'
    },
    counterAxisSizingMode: {
        AUTO: 'a',
        FIXED: 'f'
    },
    layoutSizingHorizontal: {
        FIXED: 'f',
        HUG: 'h',
        FILL: 'l'
    },
    layoutSizingVertical: {
        FIXED: 'f',
        HUG: 'h',
        FILL: 'l'
    },
    counterAxisAlignContent: {
        AUTO: 'a',
        SPACE_BETWEEN: 'b'
    }
};
// AY段属性解析顺序
const AY_PROP_ORDER = [
    'layoutMode',
    'layoutWrap',
    'primaryAxisAlignItems',
    'counterAxisAlignItems',
    'primaryAxisSizingMode',
    'counterAxisSizingMode',
    'layoutSizingHorizontal',
    'layoutSizingVertical',
    'counterAxisAlignContent'
];
// AY数值段解析顺序
const AY_NUM_ORDER = [
    'itemSpacing',
    'counterAxisSpacing',
    'paddingTop',
    'paddingRight',
    'paddingBottom',
    'paddingLeft'
];
const selectedNodes = figma.currentPage.selection;
let csNodes = [];

function mg2figHasMarker(name) {
    return /\[(ay|wh|ncf|py|cc|ef|tt)-/.test(String(name || ''));
}
function mg2figExtract(name, prefix) {
    var marker = '[' + prefix;
    var start = String(name || '').indexOf(marker);
    if (start < 0) return '';
    var i = start + marker.length;
    var depth = 0;
    var result = '';
    while (i < name.length) {
        var ch = name[i];
        if (ch === '[') { depth++; result += ch; }
        else if (ch === ']') { if (depth === 0) break; depth--; result += ch; }
        else result += ch;
        i++;
    }
    return result;
}
function mg2figWalk(nodes, visit) {
    var list = Array.prototype.slice.call(nodes || []);
    for (var i = 0; i < list.length; i++) {
        var node = list[i];
        visit(node);
        if (node && 'children' in node && node.children) mg2figWalk(node.children, visit);
    }
}
function mg2figAnalyzeSelection(nodes) {
    var stats = {
        total: 0,
        frames: 0,
        instances: 0,
        components: 0,
        texts: 0,
        ay: 0,
        wh: 0,
        ef: 0,
        cc: 0,
        masks: 0,
        fullSizeMaskCandidates: 0,
        riskyAutoLayout: [],
        residualAutoLayoutRisk: [],
        namedSamples: []
    };
    mg2figWalk(nodes, function (node) {
        stats.total++;
        var name = String(node.name || '');
        if (node.type === 'FRAME') stats.frames++;
        if (node.type === 'INSTANCE') stats.instances++;
        if (node.type === 'COMPONENT' || node.type === 'COMPONENT_SET') stats.components++;
        if (node.type === 'TEXT') stats.texts++;
        if (name.indexOf('[ay-') > -1) stats.ay++;
        if (name.indexOf('[wh-') > -1) stats.wh++;
        if (name.indexOf('[ef-') > -1) stats.ef++;
        if (name.indexOf('[cc-') > -1) stats.cc++;
        if (node.isMask) stats.masks++;
        if (mg2figHasMarker(name) && stats.namedSamples.length < 12) {
            stats.namedSamples.push(node.type + ' ' + name);
        }
        if (node.type === 'FRAME' && name.indexOf('[ay-') > -1 && node.children && node.children.length > 1) {
            var ay = mg2figExtract(name, 'ay-');
            var direction = ay && ay[0] === 'h' ? 'H' : ay && ay[0] === 'v' ? 'V' : '?';
            var flow = [];
            var rawFlow = [];
            var maskLikeSkipped = 0;
            for (var j = 0; j < node.children.length; j++) {
                var child = node.children[j];
                if (child.visible === false) continue;
                rawFlow.push(child);
                var isFirst = j === 0;
                var isShape = child.type === 'RECTANGLE' || child.type === 'ELLIPSE';
                var fullSize = Math.abs((child.x || 0)) <= 1
                    && Math.abs((child.y || 0)) <= 1
                    && Math.abs((child.width || 0) - (node.width || 0)) <= 1
                    && Math.abs((child.height || 0) - (node.height || 0)) <= 1;
                if (isFirst && isShape && fullSize) {
                    maskLikeSkipped++;
                    stats.fullSizeMaskCandidates++;
                    continue;
                }
                flow.push(child);
            }
            var inversions = 0;
            for (var k = 1; k < flow.length; k++) {
                var prev = flow[k - 1];
                var curr = flow[k];
                if (direction === 'V' && Number(curr.y || 0) < Number(prev.y || 0)) inversions++;
                if (direction === 'H' && Number(curr.x || 0) < Number(prev.x || 0)) inversions++;
            }
            var rawOverlap = false;
            for (var a = 0; a < rawFlow.length; a++) {
                for (var b = a + 1; b < rawFlow.length; b++) {
                    var one = rawFlow[a];
                    var two = rawFlow[b];
                    var overlapX = Math.max(0, Math.min((one.x || 0) + (one.width || 0), (two.x || 0) + (two.width || 0)) - Math.max(one.x || 0, two.x || 0));
                    var overlapY = Math.max(0, Math.min((one.y || 0) + (one.height || 0), (two.y || 0) + (two.height || 0)) - Math.max(one.y || 0, two.y || 0));
                    if (overlapX > 1 && overlapY > 1) rawOverlap = true;
                }
            }
            var residualOverlap = false;
            for (var c = 0; c < flow.length; c++) {
                for (var d = c + 1; d < flow.length; d++) {
                    var left = flow[c];
                    var right = flow[d];
                    var residualOverlapX = Math.max(0, Math.min((left.x || 0) + (left.width || 0), (right.x || 0) + (right.width || 0)) - Math.max(left.x || 0, right.x || 0));
                    var residualOverlapY = Math.max(0, Math.min((left.y || 0) + (left.height || 0), (right.y || 0) + (right.height || 0)) - Math.max(left.y || 0, right.y || 0));
                    if (residualOverlapX > 1 && residualOverlapY > 1) residualOverlap = true;
                }
            }
            if (inversions > 0 || rawOverlap) {
                var item = { id: node.id, name: name, direction: direction, children: flow.length, rawChildren: rawFlow.length, skippedMaskLike: maskLikeSkipped, inversions: inversions, overlap: rawOverlap, residualOverlap: residualOverlap };
                stats.riskyAutoLayout.push(item);
                if (inversions > 0 || residualOverlap) {
                    stats.residualAutoLayoutRisk.push(item);
                }
            }
        }
    });
    return stats;
}
function mg2figFormatDiagnostics(stats) {
    var lines = [];
    lines.push('Mg-to-Fig 诊断报告');
    lines.push('节点总数: ' + stats.total);
    lines.push('Frame: ' + stats.frames + ' / Instance: ' + stats.instances + ' / Text: ' + stats.texts);
    lines.push('标记数量: ay=' + stats.ay + ', wh=' + stats.wh + ', ef=' + stats.ef + ', cc=' + stats.cc);
    lines.push('Mask 节点: ' + stats.masks);
    lines.push('全尺寸背景/遮罩候选: ' + stats.fullSizeMaskCandidates);
    lines.push('Auto Layout 原始风险容器: ' + stats.riskyAutoLayout.length);
    lines.push('排除首层全尺寸背景后的残留风险: ' + stats.residualAutoLayoutRisk.length);
    if (stats.fullSizeMaskCandidates > 0) {
        lines.push('建议顺序: 先运行 Trans Mask To Parent，再运行诊断；残留风险为 0 或很低时再运行 Related Autolayout。');
    }
    for (var i = 0; i < Math.min(stats.riskyAutoLayout.length, 12); i++) {
        var item = stats.riskyAutoLayout[i];
        lines.push('- ' + item.name + ' | dir=' + item.direction + ' children=' + item.children + '/' + item.rawChildren + ' maskLike=' + item.skippedMaskLike + ' inversions=' + item.inversions + ' rawOverlap=' + item.overlap + ' residualOverlap=' + item.residualOverlap);
    }
    if (stats.namedSamples.length) {
        lines.push('标记样例:');
        for (var j = 0; j < stats.namedSamples.length; j++) lines.push('- ' + stats.namedSamples[j]);
    }
    return lines.join('\n');
}
function mg2figCreateDiagnosticsReport(text) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            yield figma.loadFontAsync({ family: 'Inter', style: 'Regular' });
            var report = figma.createText();
            report.name = 'MG2FIG_DIAGNOSTICS_REPORT';
            report.fontName = { family: 'Inter', style: 'Regular' };
            report.fontSize = 12;
            report.characters = text;
            report.resize(520, Math.min(900, Math.max(240, text.split('\n').length * 18)));
            var maxX = 0;
            for (var i = 0; i < figma.currentPage.children.length; i++) {
                var node = figma.currentPage.children[i];
                maxX = Math.max(maxX, (node.x || 0) + (node.width || 0));
            }
            report.x = maxX + 80;
            report.y = 80;
            figma.currentPage.appendChild(report);
            figma.currentPage.selection = [report];
            figma.viewport.scrollAndZoomIntoView([report]);
        } catch (error) {
            // If text report creation fails, notification still gives the summary.
        }
    });
}
if (figma.command == 'mg2fig_diagnose') {
    (() => __awaiter(void 0, void 0, void 0, function* () {
        if (selectedNodes.length === 0) {
            figma.notify('请选择 SK 导入后的页面或容器', { error: true });
            figma.closePlugin();
            return;
        }
        var stats = mg2figAnalyzeSelection(selectedNodes);
        var text = mg2figFormatDiagnostics(stats);
        yield mg2figCreateDiagnosticsReport(text);
        figma.notify('诊断完成: 节点 ' + stats.total + '，Auto Layout 风险 ' + stats.riskyAutoLayout.length, { timeout: 8000 });
        figma.closePlugin();
    }))();
}

if (figma.command == "findParents") {
    findParents(selectedNodes);
}
if (figma.command == "rename") {
    rename(selectedNodes);
}
if (figma.command == "setPageBackgroundColor") {
    setPageBackgroundColor();
}
let ttNodeArray = [];
if (figma.command.indexOf("off") > -1) {
    if (selectedNodes.length === 0) {
        figma.notify("请选择图层", { error: true });
        figma.closePlugin();
    }
    // 2. 创建 loading（长时间不自动关闭）
    const loading = figma.notify("☕️ take a coffee...", { timeout: 1000000 });
    // 3. 异步逻辑必须包在 async 主函数里
    (() => __awaiter(void 0, void 0, void 0, function* () {
        yield new Promise(r => setTimeout(r, 200));
        if (figma.command.indexOf("all") > -1) {
            let deleteCount = transMask(selectedNodes);
            let autolayoutCount = related_Autolayout(selectedNodes);
            let sectionCount = 0;
            cleanPureName(selectedNodes);
            if (csNodes.length > 0) {
                sectionCount = parseCsSegmentByArray(csNodes);
            }
            loading.cancel();
            figma.notify(`✔ Success delete ${deleteCount} layers, handle autoLayout ${autolayoutCount} layers, handle ${sectionCount} Sections`);
        }
        if (figma.command.indexOf("transMask") > -1) {
            let deleteCount = transMask(selectedNodes);
            loading.cancel();
            figma.notify(`✔ Success delete ${deleteCount} layers`);
        }
        if (figma.command.indexOf("related_Autolayout") > -1) {
            let autolayoutCount = related_Autolayout(selectedNodes);
            loading.cancel();
            figma.notify(`✔ Success handle autoLayout ${autolayoutCount} layers`);
        }
        if (ttNodeArray.length > 0) {
            // await setTruncateSafe(ttNodeArray);
            for (let node of ttNodeArray) {
                if (node.fontName != figma.mixed) {
                    yield figma.loadFontAsync(node.fontName);
                    if (node.name.indexOf("[tt") > -1) {
                        node.textTruncation = "ENDING";
                    }
                    if (node.name.indexOf("[wh-hh") > -1) {
                        node.textAutoResize = "WIDTH_AND_HEIGHT";
                    }
                }
            }
        }
        if (figma.command == "off_clean_pureName") {
            cleanPureName(selectedNodes);
            loading.cancel();
            figma.notify(`✔ Success clean name`);
        }
        figma.commitUndo();
        figma.closePlugin();
    }))();
}
if (figma.command == "test") {
}
if (figma.command == "swap_text") {
    swapTwoTextNodes(selectedNodes);
}
function rename(selectedNodes) {
    if (selectedNodes.length === 0) {
        figma.notify('请先选择图层');
        return 0;
    }
    // 遍历选中节点执行重命名
    for (const node of selectedNodes) {
        renameRecursive(node);
    }
    figma.commitUndo();
    figma.closePlugin();
    return 0;
}
function related_Autolayout(selectedNodes) {
    // 1. 遍历处理选中的节点（直接传入只读数组）;
    let count = traverseNodes(selectedNodes, true);
    // figma.notify("scuess handle " + count + " scenes Autolayout");
    return count;
}
// 名称清理方法（原有最终版）
function cleanPureName(nodes, recursive = true, clearSectionName) {
    const mutableNodes = [...nodes];
    let count = 0;
    try {
        for (let i = 0; i < mutableNodes.length; i++) {
            const node = mutableNodes[i];
            let name = node.name;
            if (!name || name.trim() === '') { }
            ;
            let pureName = name.trim();
            pureName = pureName.replace(/\]+/g, '');
            pureName = pureName.split('-ay')[0].split('-ncf')[0].trim();
            const firstBracketIndex = pureName.indexOf('[');
            if (firstBracketIndex !== -1) {
                pureName = pureName.substring(0, firstBracketIndex).trim();
            }
            node.name = pureName;
            count++;
            // 递归遍历子节点
            if (recursive && 'children' in node && node.children.length > 0) {
                // console.log(`🔍 递归遍历【${node.name}】的子节点（共${node.children.length}个）`);
                count = count + node.children.length;
                cleanPureName(node.children, true);
            }
        }
    }
    catch (error) {
        console.error(`cleanPureName 失败:${error.message}`);
    }
    return count;
}
/**
 * 兼容版 padEnd：替代 String.padEnd
 * @param str 原字符串
 * @param length 目标长度
 * @param padChar 填充字符
 */
function stringPadEnd(str, length, padChar = ' ') {
    if (str.length >= length)
        return str.slice(0, length);
    const padLength = length - str.length;
    let padStr = '';
    for (let i = 0; i < padLength; i++)
        padStr += padChar;
    return (str + padStr).slice(0, length);
}
/**
 * 兼容版 Object.entries：替代 Object.entries()
 * @param obj 目标对象
 */
function objectEntries(obj) {
    const entries = [];
    for (const key in obj) {
        if (obj.hasOwnProperty(key))
            entries.push([key, obj[key]]);
    }
    return entries;
}
/**
 * 提取节点名称中的特定片段
 */
function extractSegment(name, prefix) {
    // 步骤1：找到前缀起始位置（如 "[ay-"）
    const startMarker = `[${prefix}`;
    const startIndex = name.indexOf(startMarker);
    if (startIndex === -1)
        return '';
    // 步骤2：确定片段起始位置（跳过 "[ay-"）
    let currentIndex = startIndex + startMarker.length;
    const nameLength = name.length;
    let bracketCount = 0; // 嵌套括号计数器
    let result = '';
    // 步骤3：遍历字符，处理嵌套[]
    while (currentIndex < nameLength) {
        const char = name[currentIndex];
        if (char === '[') {
            bracketCount++;
            result += char;
        }
        else if (char === ']') {
            if (bracketCount === 0) {
                // 遇到闭合括号且无嵌套，结束提取
                break;
            }
            bracketCount--;
            result += char;
        }
        else {
            result += char;
        }
        currentIndex++;
    }
    return result;
}
/**
 * 解析数值段
 */
/**
 * 修复版：解析数值段 [63][-8] 等格式（支持负数）
 */
function parseNumArray(str) {
    const numRegex = /\[(-?\d+)\]/g; // 关键修改：-? 匹配负号，支持负数解析
    const numMatches = [];
    let match;
    while ((match = numRegex.exec(str)) !== null) {
        numMatches.push(match[1]);
    }
    return numMatches.map(num => parseInt(num, 10) || 0);
}
/**
 * 解析AY段
 */
function parseAySegment(segment, node) {
    var _a, _b;
    if (!segment)
        return false;
    const abbrPart = segment.split('[')[0] || '';
    const numPart = segment.slice(abbrPart.length);
    const numArray = parseNumArray(numPart);
    const abbrStr = stringPadEnd(abbrPart, AY_PROP_ORDER.length, '');
    try {
        for (let i = 0; i < AY_PROP_ORDER.length; i++) {
            const propName = AY_PROP_ORDER[i];
            const abbrChar = abbrStr[i];
            const propMap = LAYOUT_ABBR_MAP[propName];
            if (!abbrChar || !propMap)
                continue;
            let realValue;
            const entries = objectEntries(propMap);
            for (let j = 0; j < entries.length; j++) {
                const [key, val] = entries[j];
                if (val === abbrChar) {
                    realValue = key;
                    break;
                }
            }
            if (!realValue)
                continue;
            // (node as any)[propName] = realValue;
            if (propName === "layoutSizingHorizontal" || propName === "layoutSizingVertical") {
                if (realValue == "FILL") {
                    if (((_a = node.parent) === null || _a === void 0 ? void 0 : _a.type) == "FRAME" && ((_b = node.parent) === null || _b === void 0 ? void 0 : _b.layoutMode) !== 'NONE') {
                        node[propName] = realValue;
                    }
                }
            }
            else {
                if (propName in node) {
                    node[propName] = realValue;
                }
            }
            if (node.type == "FRAME") {
                node.clipsContent = false;
                fixFrameJustifyAlignment(node);
            }
            // console.log(`✅ 【AY段】${propName}：${abbrChar} → ${realValue}`);
        }
        if (numArray.length >= 6 && 'paddingTop' in node) {
            const numMap = {};
            for (let i = 0; i < AY_NUM_ORDER.length; i++) {
                numMap[AY_NUM_ORDER[i]] = numArray[i] || 0;
            }
            if ('itemSpacing' in node && node.layoutMode !== 'NONE') {
                node.itemSpacing = numMap.itemSpacing;
            }
            if ('counterAxisSpacing' in node && node.layoutMode !== 'NONE') {
                node.counterAxisSpacing = numMap.counterAxisSpacing;
            }
            node.paddingTop = numMap.paddingTop;
            node.paddingRight = numMap.paddingRight;
            node.paddingBottom = numMap.paddingBottom;
            node.paddingLeft = numMap.paddingLeft;
            // console.log(`✅ 【AY段】内边距：top=${numMap.paddingTop}, right=${numMap.paddingRight}, bottom=${numMap.paddingBottom}, left=${numMap.paddingLeft}`);
        }
    }
    catch (error) {
        console.error(`💥 解析AY段失败：${node.name}:${error.message}`);
    }
}
/**
 * 解析PY段
 */
function parsePySegment(segment, node, isAbsolute) {
    if (!segment)
        return;
    const parts = segment.split('-');
    const posAbbr = parts[0] || '';
    const numPart = parts.slice(1).join('-') || '';
    const numArray = parseNumArray(numPart);
    let finalAbsolute = isAbsolute;
    if (posAbbr === 'p') {
        finalAbsolute = true;
        if (node.parent && node.parent.type == "FRAME" && node.parent.layoutMode !== 'NONE') {
            node.layoutPositioning = 'ABSOLUTE';
        }
    }
    else if (posAbbr === 'a') {
        finalAbsolute = false;
        node.layoutPositioning = 'AUTO';
    }
    if (finalAbsolute && numArray.length >= 2) {
        const x = numArray[0];
        const y = numArray[1];
        node.x = x;
        node.y = y;
        // console.log(`✅ 【PY段】坐标设置：x=${x}, y=${y}（绝对定位）`);
    }
    else if (!finalAbsolute) {
        // console.log(`ℹ️ 【PY段】非绝对定位，跳过坐标设置`);
    }
}
/**
 * 解析NCF段
 */
function parseNcfSegment(segment, node) {
    if (!segment)
        return;
    const posAbbr = segment.charAt(0) || '';
    const numArray = parseNumArray(segment.slice(1));
    let isAbsolute = false;
    if (posAbbr === 'p') {
        isAbsolute = true;
        node.layoutPositioning = 'ABSOLUTE';
        // console.log(`✅ 【NCF段】layoutPositioning = ABSOLUTE`);
    }
    else {
        node.layoutPositioning = 'AUTO';
        // console.log(`✅ 【NCF段】layoutPositioning = AUTO`);
    }
    if (isAbsolute && numArray.length >= 2) {
        const x = numArray[0];
        const y = numArray[1];
        node.x = x;
        node.y = y;
        // console.log(`✅ 【NCF段】坐标设置：x=${x}, y=${y}`);
    }
}
/**
 * 解析WH段（核心修正：第一位=水平，第二位=垂直）
 * wh-0s → 0=layoutSizingHorizontal，s=layoutSizingVertical
 */
function parseWhSegment(segment, node) {
    return __awaiter(this, void 0, void 0, function* () {
        if (!segment || segment.length < 2)
            return;
        // 最终规则（修正后）：
        // 第一位 → layoutSizingHorizontal（水平尺寸）
        // 第二位 → layoutSizingVertical（垂直尺寸）
        const horizontalAbbr = segment.charAt(0); // wh-0s 的 0 → 水平
        const verticalAbbr = segment.charAt(1); // wh-0s 的 s → 垂直
        // 解析水平尺寸（layoutSizingHorizontal）
        const horizontalMap = LAYOUT_ABBR_MAP.layoutSizingHorizontal;
        let horizontalValue;
        const horizontalEntries = objectEntries(horizontalMap);
        try {
            for (let i = 0; i < horizontalEntries.length; i++) {
                const [key, val] = horizontalEntries[i];
                if (val === horizontalAbbr) {
                    horizontalValue = key;
                    break;
                }
            }
            if (node.layoutMode && node.layoutMode != "NONE") {
                node["layoutSizingHorizontal"] = horizontalValue;
            }
            if (node.type === "TEXT" && node.parent.layoutMode && node.parent.layoutMode != "NONE") {
                if (node.name.indexOf("[tt") < 0) {
                    node["layoutSizingHorizontal"] = horizontalValue;
                }
                else {
                    // (node as any)["layoutSizingHorizontal"] = horizontalValue;
                    // await setAutoWidth(node as TextNode);
                }
            }
            // 解析垂直尺寸（layoutSizingVertical）
            const verticalMap = LAYOUT_ABBR_MAP.layoutSizingVertical;
            let verticalValue;
            const verticalEntries = objectEntries(verticalMap);
            for (let i = 0; i < verticalEntries.length; i++) {
                const [key, val] = verticalEntries[i];
                if (val === verticalAbbr) {
                    verticalValue = key;
                    break;
                }
            }
            if (node.layoutMode && node.layoutMode != "NONE") {
                node["layoutSizingVertical"] = verticalValue;
            }
            if (node.type === "TEXT" && node.parent.layoutMode && node.parent.layoutMode != "NONE") {
                if (node.name.indexOf("[tt") < 0) {
                    node["layoutSizingVertical"] = verticalValue;
                }
                else {
                    // (node as any)["layoutSizingVertical"] = horizontalValue;
                }
            }
        }
        catch (error) {
            const errMsg = error instanceof Error ? error.message : '未知错误';
            console.error(`💥 处理节点失败：${errMsg}`);
        }
    });
}
/**
 * 处理指定 Frame 节点的自动布局对齐方式：
 * 主轴两端对齐且仅1个有效一级子节点时，改为左/上对齐
 * @param frameNode 要处理的 Frame 节点（严格类型为 Figma 的 FrameNode）
 */
function fixFrameJustifyAlignment(frameNode) {
    // 1. 校验节点类型：必须是 Frame 且开启自动布局（layoutMode 非 null）
    if (frameNode.type !== 'FRAME' || !frameNode.layoutMode) {
        console.warn('传入的节点不是开启自动布局的 Frame 节点');
        return;
    }
    // 2. 判断主轴是否为两端对齐（SPACE_BETWEEN 对应 Figma 中的「两端对齐」）
    const isJustifyBetween = frameNode.primaryAxisAlignItems === 'SPACE_BETWEEN';
    if (!isJustifyBetween) {
        return; // 非两端对齐，无需处理
    }
    // 3. 统计有效一级子节点：非绝对定位 + 可见
    const validChildCount = frameNode.children.filter((child) => {
        return child.layoutPositioning !== 'ABSOLUTE' && child.visible === true;
    }).length;
    // 4. 仅1个有效子节点时，修改主轴对齐方式
    if (validChildCount === 1) {
        // 根据布局方向适配对齐方式：
        // HORIZONTAL（水平）→ LEFT（左对齐）；VERTICAL（垂直）→ TOP（上对齐）
        // const newJustifyContent: string = frameNode.layoutMode === 'HORIZONTAL'
        //   ? 'LEFT'
        //   : 'TOP';
        // 修改主轴对齐方式（TypeScript 会校验 newJustifyContent 类型是否合法）
        frameNode.primaryAxisAlignItems = "MIN";
    }
}
/**
 * 解析节点名称
 */
function parseNodeName(node) {
    return __awaiter(this, void 0, void 0, function* () {
        const currentNodeName = (node.name || '').trim();
        // console.log(`\n开始处理节点：${currentNodeName}`);
        try {
            // 1. 自动布局格式：[ay-xxx][py-xxx]
            const aySegment = extractSegment(currentNodeName, 'ay-');
            const pySegment = extractSegment(currentNodeName, 'py-');
            let isAbsolute = false;
            if (aySegment) {
                parseAySegment(aySegment, node);
            }
            if (pySegment) {
                parsePySegment(pySegment, node, isAbsolute);
            }
            // 2. 非自动布局格式：[ncf-xxx] 或 [wh-xxx]
            const ncfSegment = extractSegment(currentNodeName, 'ncf-');
            const whSegment = extractSegment(currentNodeName, 'wh-');
            if (ncfSegment) {
                parseNcfSegment(ncfSegment, node);
            }
            if (whSegment) {
                parseWhSegment(whSegment, node);
            }
            const ccSegment = extractSegment(currentNodeName, 'cc-');
            if (ccSegment) {
                if (node.type == "FRAME")
                    node.clipsContent = true;
            }
            const csSegment = extractSegment(currentNodeName, 'cs-');
            if (csSegment) {
                if (node.type == "FRAME")
                    csNodes.push([node, csSegment]);
            }
            const efSegment = extractSegment(currentNodeName, 'ef-');
            if (efSegment) {
                const efSegmentArray = efSegment.split("_");
                let multipleEffects = [];
                efSegmentArray.forEach(efSegment => {
                    let effect;
                    if (efSegment.startsWith("[ds") || efSegment.startsWith("[is")) {
                        effect = parseShadow(efSegment);
                    }
                    if (efSegment.startsWith("[lb") || efSegment.startsWith("[bb")) {
                        effect = parseLayerBlur(efSegment);
                    }
                    if (efSegment.startsWith("[lg")) {
                        effect = parseLayerGlass(efSegment);
                    }
                    if (effect) {
                        multipleEffects.push(effect);
                    }
                });
                applyDropShadowToNode(node, multipleEffects);
            }
            //ttSegment
            // ******
            // const ttSegment = extractSegment(currentNodeName, 'tt-');
            if (node.name.indexOf("[wh-hh") > -1 || node.name.indexOf("tt") > -1) {
                if (node.type == "TEXT") {
                    ttNodeArray.push(node);
                }
                //   if (node.type == "TEXT") {
                //     ttNodeArray.push(node)
                //     // await setTruncateSafe(ttNodeArray);
                //     await setTruncateSafeSingle(node);
                //   }
            }
            // ******
            // if (node.name.indexOf("wh-hh") > -1) {
            //   if (node.type == "TEXT") {
            //     await setAutoWidth(node);
            //   }
            // }
            // figma.notify(`节点【${currentNodeName}】处理完成！`);
            // console.log(`setImageFillToFillMode - ${currentNodeName}`);
            setImageFillToFillMode(node);
        }
        catch (error) {
            const errMsg = error instanceof Error ? error.message : '未知错误';
            console.error(`💥 处理节点失败：${errMsg}`);
            // figma.notify(`处理失败：${errMsg}`, { error: true });
        }
    });
}
/**
 * 将 Frame 节点转换为 Section 节点（等效转换）
 * @param frameNode 要转换的 Frame 节点
 * @returns 转换后的 Section 节点（转换失败返回 null）
 */
function convertFrameToSection(frameNode) {
    try {
        // 1. 校验输入节点类型
        if (frameNode.type !== 'FRAME') {
            console.warn('传入的节点不是 Frame 类型');
            return null;
        }
        // 2. 复制原 Frame 的核心属性（按需扩展）
        const frameProps = {
            // 基础位置/尺寸
            x: frameNode.x,
            y: frameNode.y,
            width: frameNode.width,
            height: frameNode.height,
            name: frameNode.name,
            fills: frameNode.fills
        };
        // 3. 创建新的 Section 节点（挂载到原 Frame 的父节点下）
        const sectionNode = figma.createSection();
        const parentNode = frameNode.parent;
        if (!parentNode) {
            console.warn('Frame 无父节点，无法创建 Section');
            return null;
        }
        parentNode.appendChild(sectionNode);
        // 4. 给新 Section 赋值原 Frame 的属性
        sectionNode.x = frameProps.x;
        sectionNode.y = frameProps.y;
        sectionNode.resizeWithoutConstraints(frameProps.width, frameProps.height);
        sectionNode.name = frameProps.name;
        sectionNode.fills = frameNode.fills;
        // 5. 迁移原 Frame 的所有子节点到新 Section
        // 倒序遍历（避免正序遍历导致子节点索引变化）
        for (let i = frameNode.children.length - 1; i >= 0; i--) {
            const child = frameNode.children[i];
            sectionNode.insertChild(0, child); // 插入到 Section 首位（保持原顺序）
        }
        // 6. 删除原 Frame 节点
        frameNode.remove();
        // console.log(`Frame「${frameProps.name}」已成功转换为 Section`);
        return sectionNode;
    }
    catch (error) {
        console.error('转换 Frame 为 Section 失败：', error);
        return null;
    }
}
/**
 * 遍历节点（支持所有类型）
 */
function traverseNodes(nodes, recursive = true) {
    const mutableNodes = [...nodes];
    let count = 0;
    for (let i = 0; i < mutableNodes.length; i++) {
        const node = mutableNodes[i];
        parseNodeName(node);
        count++;
        // 递归遍历子节点
        if (recursive && 'children' in node && node.children.length > 0) {
            // console.log(`🔍 递归遍历【${node.name}】的子节点（共${node.children.length}个）`);
            count = count + node.children.length;
            traverseNodes(node.children, true);
        }
    }
    return count;
}
function transMask(selectedNodes) {
    let deleteCount = 0;
    for (let index = 0; index < 2; index++) {
        const allFrameInfo = traverseFromSelectedNodes();
        allFrameInfo.forEach(node => {
            var _a, _b, _c, _d;
            let targetStypleProps = [baseStypleProps, strokeStypleProps, radiusStypleProps];
            const lastChild = node.firstChild;
            const parentNode = node.containerNode;
            if (((lastChild === null || lastChild === void 0 ? void 0 : lastChild.type) == "RECTANGLE" || (lastChild === null || lastChild === void 0 ? void 0 : lastChild.type) == "ELLIPSE") && (parentNode === null || parentNode === void 0 ? void 0 : parentNode.type) == "FRAME") {
                if (((_a = lastChild.absoluteBoundingBox) === null || _a === void 0 ? void 0 : _a.x) == ((_b = parentNode.absoluteBoundingBox) === null || _b === void 0 ? void 0 : _b.x) && ((_c = lastChild.absoluteBoundingBox) === null || _c === void 0 ? void 0 : _c.y) == ((_d = parentNode.absoluteBoundingBox) === null || _d === void 0 ? void 0 : _d.y) && lastChild.width == parentNode.width && lastChild.height == parentNode.height) {
                    if (!lastChild.isMask && parentNode.type == "FRAME") {
                        copyNodeStyles(lastChild, parentNode, targetStypleProps);
                    }
                    lastChild.remove();
                    if (lastChild.removed) {
                        deleteCount++;
                    }
                }
            }
        });
    }
    return deleteCount;
}
function findParents(selectedNodes) {
    return __awaiter(this, void 0, void 0, function* () {
        const pNodes = [];
        selectedNodes.forEach((node) => {
            var _a;
            if (((_a = node.parent) === null || _a === void 0 ? void 0 : _a.type) != "PAGE") {
                pNodes.push(node.parent);
            }
        });
        figma.currentPage.selection = pNodes;
        figma.closePlugin();
    });
}
// 3. 类型守卫函数：封装判断逻辑（核心优化）
function isCornerSupportedNode(node) {
    // 用 indexOf 替代 includes 兼容低版本 TS（也可改用 includes，需确保 lib 配置 ES2016+）
    return CORNER_SUPPORTED_TYPES.indexOf(node.type) !== -1;
}
function copyNodeStyles(sourceNode, targetNode, targetStypleProps) {
    targetStypleProps.forEach(propsArray => {
        propsArray.forEach((prop) => {
            if (prop in sourceNode && prop in targetNode) {
                if (prop == "cornerRadius") {
                    if (isCornerSupportedNode(targetNode) && isCornerSupportedNode(sourceNode)) {
                        if (sourceNode["cornerRadius"] === figma.mixed) {
                            radiiStypleProps.forEach((radii) => {
                                targetNode[radii] = sourceNode[radii];
                            });
                        }
                        else {
                            targetNode.cornerRadius = sourceNode.cornerRadius;
                        }
                    }
                    if (sourceNode.type == "ELLIPSE" && isCornerSupportedNode(targetNode)) {
                        targetNode[prop] = 100;
                    }
                }
                else {
                    targetNode[prop] = sourceNode[prop];
                }
            }
        });
    });
}
function hexToRgb(hex) {
    // const rgbColor = hexToRgb("#333333");
    // 去除 # 号，统一格式
    const cleanHex = hex.replace(/^#/, "");
    // 处理简写格式（如 #333 → #333333）
    const fullHex = cleanHex.length === 3
        ? cleanHex.split('').map(c => c + c).join('')
        : cleanHex;
    // 转换为 0-255 区间的 RGB 值
    const r = parseInt(fullHex.substring(0, 2), 16);
    const g = parseInt(fullHex.substring(2, 4), 16);
    const b = parseInt(fullHex.substring(4, 6), 16);
    // 转换为 Figma 要求的 0-1 区间
    return {
        r: r / 255,
        g: g / 255,
        b: b / 255
    };
}
/**
 * 将十六进制颜色值转换为 Figma 兼容的 SolidPaint 颜色对象
 * 修复 "Unrecognized key(s) in object: 'a'" 报错
 * @param hexColor 纯十六进制颜色值（如 #333333）
 * @param opacity 不透明度（默认1）
 * @returns Figma 合法的 SolidPaint 颜色对象
 */
function hexToFigmaColor(hexColor, opacity = 1) {
    var _a;
    // 转换十六进制为 RGBA（r/g/b 范围 0-1，opacity 范围 0-1）
    const rgba = figma.util.rgba(hexColor);
    // 关键修复：去掉 a 属性，将透明度映射到 opacity 字段
    return {
        type: 'SOLID',
        color: {
            r: rgba.r,
            g: rgba.g,
            b: rgba.b
        },
        opacity: (_a = rgba.a) !== null && _a !== void 0 ? _a : opacity // 使用 rgba.a 或默认 opacity
    };
}
function isRectangleMask(node) {
    return node.type === 'RECTANGLE' && node.isMask === true;
}
function parseCsSegment(selectedNodes) {
    let count = 0;
    selectedNodes.forEach(node => {
        const csSegment = extractSegment(node.name, 'cs-');
        if (csSegment) {
            if (node.type == "FRAME") {
                const colorRegex = /\[(\#([0-9a-fA-F]{3}){1,2})\]/;
                const matchResult = csSegment.match(colorRegex);
                if (matchResult && matchResult[1]) {
                    node.fills = [
                        figma.util.solidPaint(matchResult[1])
                    ];
                }
                let sectionNode = convertFrameToSection(node) || undefined;
                if (sectionNode) {
                    // cleanPureName([sectionNode as SectionNode], false);
                }
                count++;
            }
        }
    });
    return count;
}
function parseCsSegmentByArray(csNodes) {
    let count = 0;
    for (let i = csNodes.length - 1; i >= 0; i--) {
        const [node, csSegment] = csNodes[i]; // ✅ 正确解构
        if (csSegment) {
            if (node.type == "FRAME") {
                const colorRegex = /\[(\#([0-9a-fA-F]{3}){1,2})\]/;
                const matchResult = csSegment.match(colorRegex);
                if (matchResult && matchResult[1]) {
                    node.fills = [
                        figma.util.solidPaint(matchResult[1])
                    ];
                }
                let sectionNode = convertFrameToSection(node) || undefined;
                count++;
            }
        }
    }
    ;
    return count;
}
/**
 * 入口函数：从选中节点开始遍历，返回包含完整 FrameNode 实例的结果
 */
function traverseFromSelectedNodes() {
    // 扩展结果结构：新增容器类型标记（区分 Frame/Group）
    const resultList = [];
    const selectedNodes = figma.currentPage.selection;
    if (selectedNodes.length === 0) {
        console.log('❌ 未选中任何节点');
        return resultList;
    }
    /**
     * 处理单个容器节点（兼容 Frame/Group）
     * @param containerNode 容器节点（Frame/Group）
     * @param parentPath 父级路径
     */
    function processSingleContainer(containerNode, parentPath = '') {
        // 1. 基础信息提取（兼容 Frame/Group）
        const containerType = containerNode.type;
        const currentPath = parentPath ? `${parentPath} → ${containerNode.name}` : containerNode.name;
        const firstChild = containerNode.children.length > 0 ? containerNode.children[0] : null;
        const isFirstChildMask = firstChild ? isRectangleMask(firstChild) : false;
        // 2. 存入结果（包含完整容器实例）
        resultList.push({
            containerNode: containerNode, // 完整的 Frame/Group 实例
            containerType: containerType, // 标记是 Frame 还是 Group
            containerId: containerNode.id, // 容器 ID
            containerName: containerNode.name, // 容器名称
            firstChild: firstChild,
            isFirstChildRectangleMask: isFirstChildMask,
            path: currentPath
        });
        // 3. 打印调试信息（区分 Frame/Group）
        // console.log(`📌 ${containerType === 'FRAME' ? 'Frame' : 'Group'} [${currentPath}]`);
        // console.log(`   ID: ${containerNode.id}`);
        // if (firstChild) {
        //   console.log(`   第一个子节点: ${firstChild.name} (${firstChild.type})`);
        //   console.log(`   是否为矩形遮罩: ${isFirstChildMask ? '✅ 是' : '❌ 否'}`);
        // } else {
        //   console.log(`   第一个子节点: 无`);
        // }
        // console.log('---');
        // 4. 递归处理子容器（Frame/Group 都递归）
        containerNode.children.forEach((child) => {
            if (child.type === 'FRAME' || child.type === 'GROUP') {
                processSingleContainer(child, currentPath);
            }
        });
    }
    // 遍历选中节点（兼容 Frame/Group 作为选中节点）
    selectedNodes.forEach((node, index) => {
        // console.log(`\n🔍 开始处理第 ${index + 1} 个选中节点：${node.name} (${node.type})`);
        // 情况1：选中节点是 Frame/Group → 直接处理
        if (node.type === 'FRAME' || node.type === 'GROUP') {
            processSingleContainer(node);
        }
        // 情况2：选中节点是其他容器类节点 → 找子节点中的 Frame/Group
        else if ('children' in node) {
            node.children.forEach((child) => {
                if (child.type === 'FRAME' || child.type === 'GROUP') {
                    processSingleContainer(child, `${node.name} 的子节点`);
                }
            });
        }
        // 情况3：非容器节点 → 跳过
        else {
            // console.log(`⚠️ 选中节点 ${node.name} 不是容器节点（Frame/Group），跳过`);
        }
    });
    return resultList;
}
// const numberOfRectangles = 5;
// const nodes: SceneNode[] = [];
// for (let i = 0; i < numberOfRectangles; i++) {
//   const rect = figma.createRectangle();
//   rect.x = i * 150;
//   rect.fills = [{ type: 'SOLID', color: { r: 1, g: 0.5, b: 0 } }];
//   figma.currentPage.appendChild(rect);
//   nodes.push(rect);
// }
// figma.currentPage.selection = nodes;
// figma.viewport.scrollAndZoomIntoView(nodes);
// // Make sure to close the plugin when you're done. Otherwise the plugin will
// // keep running, which shows the cancel button at the bottom of the screen.
// figma.closePlugin();
/**
 * 完全匹配 Figma 运行时参数规范 efi
 * 修复：radius 缺失、type 大小写、blur 字段不识别等问题
 */
// ========== 核心：解析 Drop Shadow（匹配运行时规范） ==========
function parseShadow(dsMatch) {
    // 匹配 ef 段中的 drop-shadow 配置
    // 提取配置项
    const effectArr = dsMatch.match(/\[([^\]]+)\]/g).map(item => item.replace(/\[|\]/g, ''));
    const [type, visFlag, colorStr, xStr, yStr, spreadStr, radiusStr, bmCode] = effectArr;
    // 解析颜色（RGBA 0-1 范围，运行时要求）
    function parseColor(colorStr) {
        // 1. 验证输入格式：必须是 8 位的十六进制字符串
        const hexRegex = /^[0-9A-Fa-f]{8}$/;
        if (!hexRegex.test(colorStr)) {
        }
        // 2. 统一转为大写（避免大小写问题），并拆分各通道
        const hex = colorStr.toUpperCase();
        const hexR = hex.slice(0, 2); // 前两位：红色
        const hexG = hex.slice(2, 4); // 中间两位：绿色
        const hexB = hex.slice(4, 6); // 后两位前：蓝色
        const hexA = hex.slice(6, 8); // 最后两位：透明度
        // 3. 核心转换：十六进制 → 0-255 整数 → 0-1 小数
        const r = parseInt(hexR, 16) / 255;
        const g = parseInt(hexG, 16) / 255;
        const b = parseInt(hexB, 16) / 255;
        const a = parseInt(hexA, 16) / 255;
        // 4. 返回标准 RGBA 对象（0-1 小数）
        return { r, g, b, a };
    }
    // 混合模式映射（运行时要求的有效值）
    const getBlendMode = (code) => {
        const map = {
            'n': 'NORMAL',
            'm': 'MULTIPLY',
            's': 'SCREEN',
            'pt': 'PASS_THROUGH'
        };
        return map[code] || 'NORMAL';
    };
    // 构建 Figma 运行时要求的 DROP_SHADOW 对象
    // 关键修复：type 大写、radius 替代 blur、移除不识别的字段
    // if (type == "is") {
    return {
        type: type == "ds" ? 'DROP_SHADOW' : 'INNER_SHADOW', // 运行时要求大写，不是文档的 drop-shadow
        // type: 'INNER_SHADOW',
        color: parseColor(colorStr),
        offset: {
            x: parseInt(xStr, 10) || 0,
            y: parseInt(yStr, 10) || 0
        },
        spread: parseInt(spreadStr, 10) || 0,
        radius: Math.max(0, parseInt(radiusStr, 10) || 0), // 运行时要求 radius 而非 blur
        blendMode: getBlendMode(bmCode),
        visible: visFlag === 'v',
        // showShadowBehindNode: true // 运行时支持该字段
    };
    // }
    return null;
}
function parseLayerGlass(dsMatch) {
    //ef-[lg][v][20][50][50][80][-45][0][pt]
    const effectArr = dsMatch.match(/\[([^\]]+)\]/g).map(item => item.replace(/\[|\]/g, ''));
    const [type, visFlag, depth, dispersion, refraction, lightIntensity, lightAngle, splay, bmCode] = effectArr;
    return {
        type: "GLASS",
        radius: 5,
        depth: Math.max(0, parseInt(depth) || 0),
        dispersion: parseInt(dispersion) / 100,
        refraction: parseInt(refraction) / 100,
        lightIntensity: parseInt(lightIntensity) / 100,
        lightAngle: parseInt(lightAngle),
        visible: visFlag === 'v',
        splay: 0,
    };
}
function parseLayerBlur(dsMatch) {
    //r[wh-hh][ef-[lb][v][99][pt][p][22][99][0.10158749669790268][0.33152535557746887][0.8372407555580139][0.754766583442688][1.0,1.0][0][0,0]]
    const effectArr = dsMatch.match(/\[([^\]]+)\]/g).map(item => item.replace(/\[|\]/g, ''));
    const [type, visFlag, radiusStr, bmCode, mode, sStr, eStr, startX, startY, endX, endY, scale, rotate, translate] = effectArr;
    if (mode == "e") {
        return {
            type: type == "lb" ? "LAYER_BLUR" : "BACKGROUND_BLUR",
            blurType: "NORMAL",
            radius: Math.max(0, parseInt(radiusStr, 10) || 0),
            visible: visFlag === 'v',
        };
    }
    else {
        return {
            type: type == "lb" ? "LAYER_BLUR" : "BACKGROUND_BLUR",
            blurType: "PROGRESSIVE",
            radius: Math.max(0, parseInt(radiusStr, 10) || 0),
            startRadius: Math.max(0, parseInt(sStr, 10) || 0),
            visible: visFlag === 'v',
            startOffset: { x: parseFloat(startX), y: parseFloat(startY) },
            endOffset: { x: parseFloat(endX), y: parseFloat(endY) }
        };
    }
}
// ========== 核心：应用 Drop Shadow 到节点 ==========
function applyDropShadowToNode(node, parseEffect) {
    // 支持特效的节点类型列表
    node.effects = [];
    const supportedTypes = ['FRAME', "ELLIPSE", 'RECTANGLE', 'TEXT', 'COMPONENT', 'INSTANCE', 'GROUP'];
    // for 循环判断节点类型（兼容低版本 TS）
    let isSupported = false;
    for (let i = 0; i < supportedTypes.length; i++) {
        if (supportedTypes[i] === node.type) {
            isSupported = true;
            break;
        }
    }
    if (!isSupported) {
        // console.log(`节点 ${node.name} (${node.type}) 不支持添加阴影`);
        return;
    }
    node.effects = parseEffect;
}
function setTruncateSafe(ttNodeArray) {
    return __awaiter(this, void 0, void 0, function* () {
        // 跳过混合字体，解决 TS 类型错误
        for (let node of ttNodeArray) {
            if (node.fontName != figma.mixed) {
                yield figma.loadFontAsync(node.fontName);
                node.textTruncation = "ENDING";
            }
        }
    });
}
function setTruncateSafeSingle(node) {
    return __awaiter(this, void 0, void 0, function* () {
        // 跳过混合字体，解决 TS 类型错误
        if (node.fontName != figma.mixed) {
            yield figma.loadFontAsync(node.fontName);
            node.textTruncation = "ENDING";
        }
    });
}
function setAutoWidth(node) {
    return __awaiter(this, void 0, void 0, function* () {
        // 跳过混合字体，解决 TS 类型错误
        if (node.fontName != figma.mixed) {
            yield figma.loadFontAsync(node.fontName);
            node.textAutoResize = "WIDTH_AND_HEIGHT";
        }
    });
}
// 将节点的图片填充统一改为 FILL 模式
function setImageFillToFillMode(node) {
    // 只处理支持 fills 的节点
    if (!("fills" in node))
        return;
    const originalFills = node.fills;
    if (!Array.isArray(originalFills))
        return;
    // 替换图片填充的 scaleMode
    const newFills = originalFills.map(fill => {
        if (fill.type === "IMAGE") {
            return Object.assign(Object.assign({}, fill), { scaleMode: "FILL" });
        }
        return fill;
    });
    node.fills = newFills;
}
function swapTwoTextNodes(selectedNodes) {
    return __awaiter(this, void 0, void 0, function* () {
        if (selectedNodes.length !== 2) {
            figma.notify('✕ Please select two Text nodes');
            return;
        }
        const node1 = selectedNodes[0];
        const node2 = selectedNodes[1];
        // 校验：必须都是文本图层
        if (node1.type !== 'TEXT' || node2.type !== 'TEXT') {
            figma.notify('✕ Please select two Text nodes');
            return;
        }
        // 新增：判断是否为混合字体，有则报错
        if (node1.fontName === figma.mixed || node2.fontName === figma.mixed) {
            figma.notify('✕ Text characters are mixed');
            return;
        }
        // 加载字体（修复 TS 报错 + 安全判断）
        yield Promise.all([
            figma.loadFontAsync(node1.fontName),
            figma.loadFontAsync(node2.fontName)
        ]);
        // 交换文字内容
        const tempText = node1.characters;
        node1.characters = node2.characters;
        node2.characters = tempText;
        figma.notify('✔ Success swap Text');
        figma.commitUndo();
        figma.closePlugin();
    });
}
// ====================== 核心重命名规则 ======================
function renameNodeByRule(node) {
    // 1. 文本节点：用内容，最多10字
    if (node.type === 'TEXT') {
        const text = node.characters.trim() || '文本';
        const newName = text.length > 10 ? text.slice(0, 10) + '...' : text;
        node.name = newName;
        return;
    }
    // 2. Frame / Group：递归找子节点字号最大的文本内容
    if (node.type === 'FRAME' || node.type === 'GROUP') {
        const maxText = getMaxFontSizeText(node);
        node.name = maxText || '未命名容器';
        return;
    }
    // 3. 其他图层：直接用类型名称
    node.name = node.type;
}
// ====================== 工具：获取容器内字号最大的文本 ======================
function getMaxFontSizeText(container) {
    let maxFontSize = 0;
    let maxText = '';
    // 递归遍历所有子节点
    function traverseRename(node) {
        // 文本节点
        if (node.type === 'TEXT') {
            try {
                const fontSize = node.fontSize;
                const text = node.characters.trim();
                if (fontSize > maxFontSize && text) {
                    maxFontSize = fontSize;
                    maxText = text;
                }
            }
            catch (error) {
            }
        }
        // 递归子节点
        if ('children' in node && node.children) {
            node.children.forEach((child) => traverseRename(child));
        }
    }
    traverseRename(container);
    // 限制 10 字 + ...
    return maxText.length > 10 ? maxText.slice(0, 10) + '...' : maxText;
}
// ====================== 【递归重命名】核心 ======================
function renameRecursive(node) {
    // 1. 先重命名自己
    renameNodeByRule(node);
    // 2. 如果有子节点，递归全部重命名
    if ('children' in node && node.children) {
        node.children.forEach((child) => renameRecursive(child));
    }
}
/**
 * 设置当前 Page 背景色为 #1f1f1f
 */
function setPageBackgroundColor() {
    // 获取当前页面
    const currentPage = figma.currentPage;
    // 设置背景色：#1f1f1f
    currentPage.backgrounds = [
        {
            type: "SOLID",
            color: {
                r: 0x1f / 255, // 31 / 255
                g: 0x1f / 255, // 31 / 255
                b: 0x1f / 255 // 31 / 255
            }
        }
    ];
    figma.closePlugin();
}
