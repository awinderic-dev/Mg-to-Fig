# MasterGo -> Figma 映射规则（v0）

本文档定义迁移引擎使用的“节点/样式/布局”映射规则，作为插件实现基线。

## 1. 基础原则

- 样式来源优先级：**MasterGo 样式库 token > 节点直接值**。
- 坐标规则：先按 DSL 计算绝对坐标，再在导入时按父节点折算为相对坐标。
- 允许差异：仅文本换行可接受；参数值（尺寸、圆角、描边、阴影、字体参数）应保持一致。

## 2. 节点类型映射

- `FRAME` -> `FRAME`
- `GROUP` -> `GROUP`（导入时以 `FRAME` 承载）
- `LAYER` -> `GROUP`（降级）
- `INSTANCE` -> `INSTANCE`（优先复原，失败降级 `FRAME`）
- `TEXT` -> `TEXT`
- `PATH` / `SVG_ELLIPSE` -> `VECTOR`

## 3. 定位与尺寸

- 来源字段：`layoutStyle.relativeX/relativeY/width/height`
- 映射字段：`geometry.x/y/width/height`
- 旋转：`rotation`（无值时默认为 `0`）

## 4. 自动布局与约束

- 来源字段：`flexContainerInfo`
  - `flexDirection=row|column` -> `layout.mode=autoLayout` + `layout.direction`
  - `gap` -> `layout.itemSpacing`
  - `padding` -> `layout.padding`（支持 1~4 值 CSS 语法）
- 约束推断：
  - `flexGrow>0` -> `constraints.grow=true`
  - `flexShrink=0` -> `constraints.preserveSize=true`
- Figma MCP 验证结论（2026-05-11）：
  - `layoutSizingHorizontal/Vertical = FILL` 必须在节点被挂入 Auto Layout 父级之后设置；挂入前会报错。
  - `resize()` 会把 `layoutSizingHorizontal/Vertical` 重置为 `FIXED`，因此导入/后处理顺序必须是：先 `resize`，再挂父级，最后设置 `wh-*` sizing。
  - 单个有效流式子节点的 `SPACE_BETWEEN` 会造成视觉偏移，后处理统一降为 `MIN`。

## 5. 样式映射

### 5.1 Fill（`paint_*`）

- `#RRGGBB` -> `SOLID`
- `rgba(...)` -> `SOLID + opacity`
- `linear-gradient(...)` -> `GRADIENT_LINEAR`
- 图片 URL -> `IMAGE_REF` + `assets[]` 记录，导入阶段优先按资产解析

### 5.2 Stroke

- 来源字段：`strokeColor/strokeWidth/strokeAlign/strokeType`
- 映射：
  - `strokeColor` 走 `paint_*` 解析
  - `strokeWidth` 去 `px` 后转 number
  - `strokeAlign` 转大写（`INSIDE/CENTER/OUTSIDE`）

### 5.3 Effect（`effect_*`）

- 若值已是 Figma effect 结构，直接透传
- 若是影子语义字段（`shadowColor` 等），转为 `DROP_SHADOW`
- 旧命名协议里的 `[ef-...]` 由 Figma 后处理器恢复：
  - `[ds]` -> `DROP_SHADOW`
  - `[is]` -> `INNER_SHADOW`
  - `[lb]` -> `LAYER_BLUR`
  - `[bb]` -> `BACKGROUND_BLUR`
  - `LIQUID_GLASS/MOTION_BLUR` 当前仅诊断记录，暂不强行套用，避免 Figma 运行时兼容问题。

### 5.4 Radius / Opacity

- `borderRadius: "4px"` -> `cornerRadius: 4`
- `opacity` 字符串/数字统一归一化到 `[0,1]`

## 6. 文本映射

- 来源字段：`text[]`、`textColor[]`、`textAlign`、`textMode`
- 字体来源：`font_*` token
  - `family/size/style/lineHeight/letterSpacing` -> TextNode 属性
- 对齐：`left/right/center/justified` -> `LEFT/RIGHT/CENTER/JUSTIFIED`
- 字重：从 `fontStyle` 文本推断（Regular/Medium/Bold 等）
- 字体回退：精确匹配 -> 同 family -> Inter -> 系统首个可用字体

## 7. 组件与实例

- `componentId` -> `componentRef.componentKey`
- `componentInfo.properties` -> `componentRef.overrides`
- 导入时优先查找已创建主组件：
  - 命中：`createInstance()`
  - 未命中：降级为 `FRAME`，并记 `E_COMPONENT_BIND_FAIL`
- Figma MCP 验证结论（2026-05-11）：`INSTANCE` 可安全应用 `effects` 等外观属性。后处理器不得删除或重建实例，只能补充属性。

## 8. 路径矢量

- 来源字段：`path[].data`
- 映射字段：`vectorPaths[]`（`windingRule=NONZERO`）
- path 段内 fill token 优先作为矢量填充

## 9. Token 追踪

- 所有 `paint_* / font_* / effect_*` 引用都会写入 `tokenRefs`
- 导入后记录追踪信息，未绑定变量时输出 `E_TOKEN_BIND_PENDING`

## 10. 图片与图标（插件落地规则）

### 10.1 图片迁移（双插件主链路）

- **MasterGo 插件导出阶段**
  - 从样式库 `paint_*` 中识别图片资源（URL/二进制引用）。
  - 生成统一 `assets[]` 记录：`assetId/hash/mimeType/sizeBytes/transport/data|uri`。
  - 小图（阈值内）写入 `data(base64)`；大图写 `uri` 并记录分包信息。
  - 节点仅保存 `imageRef`，不直接依赖运行时临时 URL。
- **Figma 插件导入阶段**
  - 优先使用 `assets.data` -> `figma.createImage(Uint8Array)` 写入 IMAGE paint。
  - 次级回退使用 `assets.uri` -> `figma.createImageAsync(uri)`（需 manifest 白名单域名）。
  - 失败时降级为占位色并输出 `E_ASSET_MISSING`（包含 `nodeId/assetId`）。

### 10.2 图标迁移（PATH/VECTOR）

- 导出时保留原始 `path[].data`，并额外输出归一化版本（命令与参数空格标准化）。
- 导入时优先走 `vectorPaths`（可编辑矢量）；若路径不被 Figma 接受：
  - 回退 `createNodeFromSvg`（保持视觉不丢失）；
  - 同时写 `pluginData` 标记该节点为 SVG 回退，便于后续修复。
- 图标容器（如 `icon-wrapper`）必须保持尺寸与 Auto Layout 语义，不允许因图标失败影响父布局。

### 10.3 稳定性约束

- 不允许在插件主链路依赖“会话态 fetch”去拉图；应以 `assets[]` 为主数据源。
- 图片、图标失败不能中断整页导入；必须节点级降级并继续。
- 所有降级都要进入 `diagnostics[]`，支持批量复跑与问题定位。
- 对 SK 导入后的 Figma 后处理，原则是“补属性，不重建资源节点”：
  - MasterGo MCP 的真实 DSL 验证显示 `PATH.data`、图片 URL、`componentId/componentInfo` 在设计数据里存在。
  - 因此后处理器优先修复 Auto Layout、尺寸、遮罩、效果和文本，不主动替换 PATH、IMAGE、INSTANCE。
  - 全尺寸首层矩形/椭圆遮罩可将 fill/stroke/effect/radius 提升到父级；其他节点不做删除式修复。

### 10.4 批量导入会话

- 同一次插件会话内维护 `mgSourceNodeId -> Figma Node` 映射。
- 分片导入时，后续批次必须复用前序批次父节点，避免子节点被错误挂到当前页。
- 每个导入节点写入 `pluginData.mgSourceNodeId`，用于会话恢复与问题定位。

### 10.5 字体预检

- 导入前读取 Figma 当前可用字体列表。
- 字体匹配顺序：用户规则精确匹配 -> 用户 family 映射 -> 当前文件可用同 family 字体 -> Inter/首个可用字体。
- 每次导入输出 `fontPreflight`，记录请求字体、解析字体、命中策略和回退数量。

### 10.6 风险预检

- 每次导入输出 `preflight`，统计节点数、资产数、图片引用数。
- 预检会列出缺失的 `IMAGE_REF` 资产引用，导入阶段仍会降级为占位色并继续。
- 预检会标记宽或高超过 4096 的图片资产，便于导出侧提前分包或降采样。
- 预检会列出当前导入器不支持的节点类型。
