# TFT S18 仙灵快速检索器 — Codex 开发包 v1

版本日期：2026-08-26  
目标版本：TFT Set 18 / Patch 18.1（Enchanted Wilds 正式服）

## 1. 项目定位

这是一个面向对局备战阶段的 **仙灵快速检索 + 条件过滤 + 理论概率计算工具**，不是百科站。

用户最常见的问题应在数秒内完成：

- 当前回合有哪些仙灵可能出现？
- 当前金币能买得起哪些？
- 搜索“复制器 / 玩家生命 / 阵亡 / 击杀 / 存活”等内容时，有哪些相关仙灵？
- 某个仙灵剩余出现窗口内，还有哪些仙灵与它存在阶段重叠？
- 开启概率模式后，在当前候选池等权假设下，目标仙灵或目标集合的理论概率是多少？

## 2. V1 技术栈

推荐：Vite + Vanilla TypeScript + CSS + JSON，静态部署 GitHub Pages。

不要引入：后端、SQL、登录系统、服务器 API、React/Vue（除非实现过程中有不可避免的充分理由）。

## 3. 主要文件

- `CODEX_TASK.md`：给 Codex 的一次性开发任务。
- `SPEC.md`：产品与 UI 行为规格。
- `DATA_SCHEMA.md`：仙灵、条件、阶段、来源等数据结构。
- `RULES.md`：18.1 已确认规则、玩家观察规则、概率模型边界。
- `SOURCE_POLICY.md`：数据源优先级与冲突处理。
- `DATA_INGESTION.md`：18.1 数据导入/更新设计。
- `SEARCH_PIPELINE.md`：内容检索、关键词与同义词词库生成方案。
- `ACCEPTANCE_TESTS.md`：必须通过的验收用例。
- `UPDATE_WORKFLOW.md`：18.2 以后如何低成本更新。
- `data/source_manifest_18.1.json`：18.1 数据源清单。
- `data/wisps_18.1.json`：**18.1 正式服已核验种子数据，不是完整仙灵全集**。用于开发与测试，完整全集应由数据导入流程生成。
- `rules/wisp_rules_18.1.json`：规则层结构。
- `ui/UI_REFERENCE.png`：UI 概念图参考。

## 4. 重要状态说明

Riot 18.1 正式补丁已上线，但 Riot 官方补丁没有逐条公开全部仙灵的名称、价格、阶段、普通/升级/棱彩文本。当前可核验的来源状态：

1. Riot Patch 18.1：正式规则最高权威。
2. Riot Enchanted Wilds Overview：机制说明最高权威。
3. CommunityDragon：接近客户端数据，但 2026-08-26 检查时 `latest` 快照日期仍为 8 月 16 日，PBE 快照为 8 月 22 日，不可无条件当作正式 18.1 最终数值。
4. LoLCHESS：仙灵表页面标注 Updated: August 26, 2026；Riot 18.1 Patch Notes 也将 LoLCHESS 列在第三方资源推荐列表中。它可作为当前逐仙灵字段的重要核验源，但仍不是 Riot 官方。
5. DataTFT：本项目中文展示优先参考其中文译名/表述，但数值与规则冲突时不覆盖更高优先级数据源。

因此完整数据集必须保留字段级来源和核验时间，不能把任一第三方页面直接写死到前端组件中。

## 5. 搜索数据状态

Stage C2 已完成 reviewed search semantics、materialization、runtime publication、structured match
metadata、Match Reason 与可选安全高亮。Production runtime 只消费由 normalized source、
machine-generated draft 和 manual review decisions 确定性生成并发布的 reviewed artifacts；
`public/data` 是 runtime publication，不是人工 source of truth。完整 ownership 与 closeout 证据见
`SEARCH_PIPELINE.md` 和 `reports/stage-c2-final-audit.md`。这不代表整个项目已完成；后续仍应回到 roadmap
选择下一个主功能阶段。

## 6. Refresh Rules 阶段状态

**Stage C3 — COMPLETE。** C3.1 已完成版本化 typed rules data、跨 production Wisp 数据校验、
data-driven 规则页 view model、SPEC 所列规则内容覆盖及逐仙灵规则索引基础；C3.2 已完成章节导航、
原生 disclosure 内的中英文名称定位、类别与特殊规则筛选、独立状态、响应式信息层级及无障碍收口。

Stage C3 完成的是“规则页数据基础 + 最终可用 UX”，不表示游戏规则事实已经永远完全验证。下一步为
**Release Data Audit**：审查 18.1 production 数据完整性、provenance、field gaps、剩余 unknown / unverified
与 release readiness。现有 dependency audit warning 记录为 **Release / dependency audit follow-up**，不在
C3.2 中强制升级依赖。

## 7. Release Data Audit 阶段状态

**Stage C4 — IN PROGRESS；C4.1 Release Data Audit。** 当前审计结论仍为 productionReady=false：
各来源 catalog 口径不同，精确 corpus 边界及有限 identity / critical-field 人工审核队列尚未解决。
运行 `npm run data:release-audit:18.1` 可确定性重建机器报告与人工入口，
`npm run validate:release-audit` 只校验报告是否 stale/inconsistent，不会因为已知 blocker 本身使 CI 失败。
