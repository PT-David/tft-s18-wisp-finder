# 数据源政策 SOURCE_POLICY

## 1. 优先级

### Tier A — Riot 官方

用于规则与版本事实：

- Patch 18.1
- Enchanted Wilds Overview
- 后续 Riot hotfix / patch notes

若 Riot 明确给出某个仙灵字段，直接覆盖低优先级来源。

### Tier B — Riot 客户端数据 / CommunityDragon

用于内部 ID、资产路径、本地化字符串、机器数据。

必须记录具体快照时间与 patch。2026-08-26 检查时 CommunityDragon `latest` 仍为 8/16，PBE 为 8/22，因此不能自动当作 18.1 正式最终数值。

### Tier C — 高质量结构化第三方

当前首选 LoLCHESS：

- Wisp 页面标记 `Updated: August 26, 2026`；
- 包含价格、阶段、普通效果、Blossom、Prismatic、Requirements、once-per-game 等；
- Riot Patch 18.1 的“3rd Party Friends”列表明确包含 LoLCHESS。

用于 Riot 未逐条公开的字段，但必须标记 `verified_third_party`。

### Tier D — DataTFT 中文展示

优先参考其：

- 中文仙灵名；
- 中文效果表达；
- 中文类别称呼。

原则：中文翻译可以借用 DataTFT 风格，但数值/阶段/条件冲突时，不能凭翻译层覆盖 Tier A–C 的正式数值。

### Tier E — 交叉检查

Mobalytics、Tactics.tools 等用于发现冲突和历史变化，不作为单一最终真值。

## 2. 冲突处理

1. 先比较更新时间和 patch。
2. Riot 明示 > 客户端正式数据 > 当日高质量第三方 > 其他第三方。
3. 若两家同日正式服来源冲突，字段标记 `needs_review`，不要静默任选。
4. 不让旧 PBE 数值覆盖 18.1 live。

## 3. 字段级 provenance

建议每个关键字段都有：

- `sourceId`
- `verifiedAt`
- `confidence`

方便后续 patch diff 与定位错误来源。
