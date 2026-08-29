# 18.1 数据导入与规范化

## 1. 目标

生成唯一前端输入：

`public/data/wisps.json`

UI 不直接访问第三方网站。

## 2. 推荐目录

```text
data/
  raw/
    18.1/
  normalized/
    wisps_18.1.json
  overrides/
    zh.json
    corrections.json
    search-concepts.json
    synonyms.json
scripts/
  build-data.ts
  validate-data.ts
  diff-data.ts
```

## 3. 导入步骤

1. 获取 Riot/CommunityDragon 可用的正式或最近客户端字段。
2. 获取 LoLCHESS 18.1 live 表作为当前逐条结构化校验。
3. 用稳定 ID 关联同一仙灵。
4. DataTFT 仅覆盖中文展示层；保留英文 canonical 文本/标识。
5. 对 price、stage、requirements、Prismatic 等逐字段核验。
6. 输出 normalized JSON。
7. 执行 validate-data。
8. 保存 18.1 snapshot，后续不得直接覆盖历史版本。

## 4. 为什么不把整页数据写死进前端

18.1 上线前最后一天已有 0 金仙灵被 Riot 调弱的公开说明；第三方页面今天仍存在同步差异。后续 18.2/18.3 会继续平衡，因此更新必须是“换数据”而不是“改组件”。

## 5. 当前开发包的数据文件

`data/wisps_18.1.json` 是经 2026-08-26 live 页面核验的**开发种子/回归测试集合**，专门覆盖复杂 Schema 情况：

- 无 Blossom；
- 有 Blossom；
- 有 Prismatic；
- 多阶段区间；
- 多 Requirements；
- once-per-game；
- 0 金并带金币条件；
- Stage 6 高费用。

完整全集应由导入流程生成，而不是让 Codex 手抄到代码中。

## 6. LoLCHESS 浏览器快照

普通浏览器通过 “Save Page As → HTML only” 保存的页面是受支持的正式
fallback。导入器先检查 JSON、JSON-LD、`__NEXT_DATA__` 与 Flight payload；
若其中没有 Wisp records，则按 `.name-cell`、`.description-cell`、升级 label、
requirements hint 和 stage info 等语义 DOM 解析服务端渲染列表，而不依赖构建时
生成的随机 CSS hash。两条路径均无记录时会 fail closed，绝不覆盖已有 raw JSON。

```bash
npm run data:import:lolchess -- artifacts/import/lolchess-set18-wisps.html
```

导入后的 LoLCHESS 数据作为逐记录审计证据；来源总数不同不能单独证明 corpus
成员关系，也不代表 normalized production 已完整。

## 7. Stage C1 engineering exit criteria

Stage C1 在 raw snapshots 可重现、manifest/provenance 无悬空引用、当前报告无
stale facts、仅强证据或显式 reviewed mapping 可确认 identity、其余项目进入
`reports/data-manual-review-18.1.json`、生成器 deterministic 且 CI（包括 E2E）
全绿时完成。人工数据审核可以继续存在；它不应诱发 fuzzy auto-match，也不应把
`productionReady` 提前设为 `true`。来源规模不同且尚不能证明精确全集时，结论必须
保持 `exact corpus size unresolved`。
