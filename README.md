# Mg-to-Fig

MasterGo 到 Figma 迁移工具（迁移资源包 + 可编辑重建 + 组件/Token 可追溯）。

## 项目结构

- `packages/schema`：中立结构文档与资源索引校验器
- `plugins/mastergo`：MasterGo 导出插件（页面/选区 -> `.mgfig` 迁移包；当前代码仍保留 document JSON 调试导出）
- `plugins/figma`：Figma 导入插件（`.mgfig` 迁移包 -> 可编辑节点；当前代码仍支持粘贴 document JSON 调试）
- `docs`：PRD、验收清单、自测规程、Schema 字段字典
- `tests`：核心链路自动化测试

## 当前能力

- 导出：节点树、样式、布局、组件信息、token 引用、资源索引
- 导出：支持原始节点树与 MasterGo DSL（`layer_id`）两种输入源
- 导入：可编辑节点重建、组件实例恢复（可降级）、token 可追溯写入 pluginData
- 导入：支持批量分片（offset/limit）导入，避免大页面一次性写入失败
- 导入：分片导入会复用同一导入会话中的父子节点映射，避免跨批次层级丢失
- 导入：导入前生成字体预检结果，按当前 Figma 可用字体执行匹配与回退
- 导入：导入前生成风险预检结果，提示缺失资产、超大图片、未知节点类型
- 资源：目标方案为 `.mgfig` 资源包，`document.json` 只保存 `assetId`，图片/icon/SVG/遮罩等真实文件进入 `assets/`
- 兼容：现有 JSON 调试链路会把图片 fill 转为 `assets[]` + `IMAGE_REF`，只能作为低保真兜底，不能作为正式迁移交付
- 验证：导入后自动生成参数差异报告（位置/尺寸/圆角/描边/字号/行高等）
- 校验：Schema 校验 + 诊断错误码（`E_*`）

## 测试

运行：

```bash
node --test tests/*.test.js
```

## 文档

- 产品规格：`PRD.md`
- 自测规程：`docs/self-test-protocol.md`
- 验收清单：`docs/acceptance-checklist.md`
- 迁移包/Schema 字段字典：`docs/json-schema-v0.md`
- 映射规则：`docs/mapping-rules.md`
