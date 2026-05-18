# 迁移包与 JSON Schema v0 字段字典（Mg-to-Fig）

## 1. 迁移包结构

正式迁移交付物为 `.mgfig` zip 包，而不是单个 JSON 文件。单个 `document.json` 只用于调试、预检或低保真兜底。

```text
document.json
manifest.json
diagnostics.json
assets/
  <assetId>.png|jpg|webp|svg
```

## 2. document.json 顶层结构

```json
{
  "schemaVersion": "0.1.0",
  "documentMeta": {},
  "nodes": [],
  "assets": [],
  "tokens": [],
  "diagnostics": []
}
```

`assets[]` 是兼容字段。正式 `.mgfig` 导入应优先读取 `manifest.json.assets[]` 与包内 `assets/` 文件。

## 3. documentMeta

- `sourceTool`: string，固定为 `mastergo`
- `exportMode`: string，`currentPage` | `selection`
- `exportedAt`: string，ISO 时间
- `sourceFileId`: string，源文件标识
- `sourcePageId`: string，源页面标识
- `sourcePageName`: string，源页面名称

## 4. nodes[]

- `id`: string，源节点 ID
- `type`: string，节点类型（FRAME/GROUP/TEXT/RECTANGLE/VECTOR/IMAGE/COMPONENT/INSTANCE）
- `name`: string，节点名称
- `visible`: boolean
- `locked`: boolean
- `parentId`: string | null
- `children`: string[]，子节点 ID 列表
- `geometry`:
  - `x`: number
  - `y`: number
  - `width`: number
  - `height`: number
  - `rotation`: number
- `layout`:
  - `mode`: string，`none` | `autoLayout`
  - `constraints`: object
  - `padding`: object
  - `itemSpacing`: number
- `style`:
  - `fills`: array
    - 普通 Figma paint 可直接透传
    - 图片资源使用 `{ "type": "IMAGE_REF", "assetId": "...", "scaleMode": "FILL" }`，通过 `manifest.json` / `assets[]` 解析
  - `strokes`: array
  - `effects`: array
  - `opacity`: number
  - `cornerRadius`: number | object
  - `strokeWeight`: number
  - `strokeAlign`: string
- `vectorPaths`（仅 VECTOR）:
  - `windingRule`: string
  - `data`: string
- `text`（仅 TEXT）:
  - `characters`: string
  - `fontFamily`: string
  - `fontStyle`: string
  - `fontWeight`: number
  - `fontSize`: number
  - `lineHeight`: number | string
  - `letterSpacing`: number
  - `textAlignHorizontal`: string
  - `textAlignVertical`: string
- `imageRef`（仅 IMAGE）: string，关联 `manifest.assets[].id` 或兼容字段 `assets[].id`
- `componentRef`（仅 COMPONENT/INSTANCE）:
  - `componentKey`: string
  - `instanceOf`: string | null
  - `overrides`: object
- `tokenRefs`: array，节点使用的 token 引用

## 5. manifest.json

- `packageVersion`: string
- `createdAt`: string
- `documentPath`: string，通常为 `document.json`
- `diagnosticsPath`: string，通常为 `diagnostics.json`
- `assets`: array
  - `id`: string
  - `type`: string，`image` | `svg` | `mask` | `other`
  - `mimeType`: string
  - `path`: string，例如 `assets/icon-home.svg`
  - `sizeBytes`: number
  - `checksum`: string
  - `width`: number | null
  - `height`: number | null
  - `sourceNodeIds`: string[]
  - `fallbackUri`: string | null，外链兜底，不作为主链路

## 6. assets[] 兼容字段

- `id`: string
- `type`: string，`image` | `svg` | `mask` | `other`
- `mimeType`: string
- `sizeBytes`: number
- `transport`: string，`package` | `inline` | `external` | `chunked`
- `path`: string（package）
- `uri`: string（external/chunked fallback）
- `data`: string（inline，base64，仅调试或小资源兜底）
- `checksum`: string（可选）
- `width`: number | null（可选）
- `height`: number | null（可选）

## 7. tokens[]

- `tokenId`: string
- `path`: string（例如 `color.brand.primary`）
- `name`: string
- `kind`: string（color/number/string/effect/typography）
- `resolvedValue`: any
- `usageNodeIds`: string[]
- `bindingStatus`: string，`tracked` | `pending` | `bound`

## 8. diagnostics[]

- `level`: string，`info` | `warn` | `error`
- `code`: string（见 PRD 错误码）
- `nodeId`: string | null
- `assetId`: string | null
- `message`: string
- `fallbackApplied`: boolean
- `details`: object

## 9. 版本演进规则

- `schemaVersion` 使用 semver。
- 小版本升级（0.x.y）允许新增可选字段，不破坏已有消费方。
- 次版本升级（0.y.0）允许新增节点类型和结构，但需提供迁移说明。
- 任意移除或重命名字段都必须提升主版本并提供迁移脚本。
