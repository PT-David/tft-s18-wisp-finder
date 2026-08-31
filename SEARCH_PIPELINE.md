# 搜索概念与同义词生成方案

## 1. 设计目标

可见 UI 只使用官方 7 类；`复制器 / 玩家生命 / 阵亡 / 击杀 / 存活时间` 等是**内部检索语义**，不做成首页标签。

## 2. 词库生成流程

按照用户确定的方向：

### Step 1 — 汇总每个仙灵完整文本

拼接：

- 名称
- 普通效果
- Blossom Upgrade
- Prismatic Blossom
- Requirements

但保留字段边界，不仅生成一条大字符串。

### Step 2 — 关键词抽取

抽取实体与动作，例如：

- 资源：金币、经验、刷新次数、玩家生命
- 英雄：费用等级、复制器、升星、获得英雄、变形
- 战斗：击杀、阵亡、存活、护盾、攻速、法强、攻击力、真伤、控制
- 装备：组件、成装、神器、重铸、临时装备
- 商店：刷新、指定费用、2 星、免费刷新
- 条件：连胜、连败、血量、羁绊、阵容、时间

### Step 3 — 相似内容聚类

把功能相近但文本不同的仙灵聚到同一概念：

- `复制英雄`
- `首次己方阵亡`
- `敌方阵亡`
- `存活时间奖励`
- `玩家生命恢复/消耗`
- `指定费用英雄获取`

允许一个仙灵属于多个概念。

### Step 4 — 同义词扩展

示例：

- 生命值 / 血量 / HP
- 复制器 / 英雄复制器 / Champion Duplicator
- 阵亡 / 死亡
- 击杀 / takedown
- 刷新 / 重随 / reroll
- 经验 / 经验值 / XP / experience

同义词仅用于 query expansion，不强迫显示在卡片上。

### Step 5 — 人工复核

自动提取结果必须人工审查，避免：

- “player” 把完全无关的玩家条件全部聚为同一意图；
- “health” 混淆英雄生命与玩家生命；
- “kill” 混淆立即击杀、斩杀阈值、击杀奖励；
- “item” 混淆获得装备、临时装备、装备条件。

## 3. 搜索实现

- query normalization：大小写、全半角、标点、常见英文缩写。
- 同义词展开。
- 默认多词 AND。
- 可选 OR 语法后续加入。
- 分字段打分，不只做全文 contains。
- 结果顶部可根据 concept 动态生成二级建议。

## 4. Stage C2.1 候选数据层

运行 `npm run data:lexicon:18.1`，仅以 `data/normalized/wisps_18.1.json` 为输入，
确定性生成 concept draft、synonym draft 与人工审核报告。生成物中的
`candidate_high_confidence` 仍是候选，不代表批准，也不会写回 normalized 或 public
production 数据；人工完成语义、碰撞及证据审核后，才能在 C2.2 决定哪些内容上线。

`queryExpansionGroups` 是全局“查询表达 → 等价查询表达”，`recordAliases` 则只表示
某个具体 Wisp 的可靠名称别称。效果相似不构成 record alias；没有可靠证据时该数组
应保持为空。完整短语（例如 `Champion Duplicator`）作为一个 alias 保存，不拆词。

同一 alias 跨不同 semantic group 才是 `actualAliasCollisions`；单字母 `D` 等自身风险
单独记录为 `intrinsicAliasRisks`，一个 group 关联多个相关 concept 并不构成碰撞。通用
`HP / 生命值 / 血量` expansion 保持 concept-neutral，不推断玩家或弈子主体。

金币候选分别使用获得、实际支付/失去、当前金币条件和商店售价 concept。普通“在 N
秒后”使用 delayed-trigger 语义；只有明确按存活或存活友军数量结算时才进入
`survival_condition`，buff duration 不属于 survival 或 stage/time condition。

`champion_star_up` 只表示现有弈子实际发生升星或星级提升动作；静态星级、星级
Requirement，以及直接获得或召唤指定星级弈子的表达使用 `champion_star_level`。裸
`N星` 不得自动推导出升星动作。`time_stage` 覆盖上/本/这/每/下一回合、玩家对战回合、
准备阶段和明确的第 N 回合，但不收录“持续 N 秒”“每 N 秒”或“在 N 秒后”。

`shield` 是泛化的护盾相关概念，覆盖提供、提升、削减护盾以及以护盾为作用对象；
`win_streak` 与 `loss_streak` 分别覆盖对应状态和计数，不只表示由状态决定的条件。

## 5. C2.1 人工审核完成状态

Stage C2.1 已针对 `generatorVersion = c2.1-v8` 和 normalized input SHA-256
`a7fdf375bc36f0f164a36912af4ca22c1671ede0ba94ae3e8ce3c8bbdee9abe7` 完成 taxonomy、
query expansion 与全部 assignment 的人工审核。当前 generated assignment 与 manual decision
为完整的一一对应关系，最终人工结果为 289/289 approved、0 rejected、0 modified。Validator
会双向检查 generated assignment 和 manual decision key set，防止未审核 assignment、过期 decision
或重复 decision 仅通过更新 metadata 绕过审核。

这一审核完成状态仍属于 C2.1 review overlay，不表示 reviewed concepts 已写入 production。
C2.1 完成时，`data/normalized/wisps_18.1.json` 与当时的 `public/data/wisps.json` 中
`searchConcepts[]`、`synonyms[]` 均保持为空；之后由 Stage C2.2A materialize、C2.2B1 publish。
normalized 目前仍保持空 search-derived fields，public 则是 reviewed materialized runtime copy。

使用完整 18.1 仙灵文本实际生成第一版：

- `search-concepts.json`
- `synonyms.json`
- 每个仙灵的 `searchConcepts[]`

C2.1 draft 经人工审核后再进入 C2.2；不得直接把自动候选灌入 production 字段。

人工审核结论维护在 `data/reviews/18.1/search-lexicon-decisions.json`，generator 不得覆盖。
validator 将其 generator version 与 normalized input SHA 和当前 draft 对齐，过期结论必须重新确认。
每个 generated query expansion group 必须恰好对应一条人工 decision。后续 assignment 审核记录使用
`wispId`、`conceptKey`、`action`（approved / rejected / modified）和非空 `reason`；modified 还必须提供
不同且合法的 `replacementConceptKey`。C2.1 review 完成后，assignment decision key set 必须与
generated assignment key set 完全相等；generator confidence 与人工 action 是相互独立的状态。
报告中的 `taxonomyDefinitions` 是完整 canonical key 定义数，`conceptKeysUsed` 仅是当前 production
文本实际命中的 key 数，两者不得混用。`assignmentsByConcept` 按 concept key 稳定排序，供人工逐项
审核时直接核对各 concept 的 assignment 数量。

## 6. Stage C2.2A — reviewed materialization

运行 `npm run data:materialize-search:18.1` 会先复用 C2.1 overlay validator，随后只从
normalized snapshot、两个 reviewed draft 与人工 decisions 确定性生成：

- `data/materialized/18.1/search-concepts.json`：完整 canonical taxonomy 与逐 Wisp reviewed concept membership；
- `data/materialized/18.1/synonyms.json`：人工批准的全局 query-expansion groups，与 record aliases 分层保存；
- `data/materialized/18.1/wisps.json`：保留 normalized core data、仅填充 reviewed search-derived fields 的派生数据集。

`data/normalized/wisps_18.1.json` 始终是 **C1 normalized / C2.1 review source snapshot**；反写它会改变
人工审核所绑定的 SHA 并形成自引用。`data/materialized/18.1/...` 是 **C2.2 reviewed derived search
artifacts**，不是与 normalized 竞争的原始 source of truth。`npm run validate:materialized-search` 会验证
metadata、完整 effective assignment key set、批准 alias exact set、record alias 隔离、稳定顺序和 core-data
不变式。

C2.2A 合并时尚未接入 runtime，也没有修改当时的 `public/data/wisps.json`、structured `SearchHit` 或
search highlighting；其 artifacts 现在由下述 C2.2B1 publication 接入 runtime。

## 7. Stage C2.2B1 — reviewed runtime publication（已完成）

`npm run data:publish-search:18.1` 只把 C2.2A reviewed artifacts 确定性、逐字节发布为
`public/data/wisps.json`、`public/data/search-concepts.json` 和
`public/data/search-synonyms.json`。C1 builder 不再写 public；`normalized` 仍是 C1 core / C2.1
review source，`materialized` 仍是 reviewed derived source，public 只是其 runtime publication，
不是新的人工 source of truth。

前端初始化同时加载 reviewed Wisp dataset 与两份 reviewed lexicon artifact，并验证 schema、patch、
生成器版本、review input SHA、record count 及 taxonomy key 唯一性。加载或 metadata 验证失败会终止
初始化，不会回退到 hard-coded 或空词库。运行时保留 query group 的 aliases 与 conceptKeys，直接使用
reviewed taxonomy label 建立 concept clause，并以 canonical key 精确匹配 materialized
`searchConcepts[]`；同 phrase 的 taxonomy 与 synonym semantics 会合并。

初始化还会把 Wisp dataset 与 `search-concepts.json` 的 reviewed membership 精确绑定：record count、
完整且无重复的 Wisp ID set、逐 Wisp canonical concept set、assignmentCount、taxonomy references 与
reviewed record aliases 任一不一致都会 fail-closed，runtime 不会修补或覆盖任一 artifact。

C2.2B1 当时没有开始 structured `SearchHit`；该 runtime 基础现已由下述 C2.2B2 完成。

## 8. Stage C2.2B2 — structured SearchHit（已完成）

每个非空 query clause 现在恰好产生一个 winning `SearchMatch`，并明确区分 source 自身命中
(`direct`)、reviewed group 中其它 surface term 命中 (`queryExpansion`) 与 canonical membership
命中 (`concept`)。短路优先级、每 clause 只取最高分、AND、结果排序和 `- order / 10000` 均保持
C2.2B1 行为；clause match 的 `score` 不包含该稳定排序 penalty。兼容字段 `matchedFields` 不维护
第二份事实，而是按 clause 顺序从 winning matches 的 `scoreField` 去重派生。

`scoreField` 表示旧有 scoring bucket，`fieldPath` 则无歧义定位实际原始字段：中英文名称、三种
effect、带 array index 与 locale 的 requirement，或带 index 的 record alias。因此 expansion 落到
`effects.normal` 时仍可保持 `synonym = 140`，同时准确报告 surface 来源。

Surface ranges 是原始字段的 UTF-16 offset、使用 half-open `[start,end)`，语义与 JavaScript
`String.prototype.slice(start,end)` 完全一致。Normalization-aware index 将 NFKC、大小写、标点/符号
空格化及 whitespace collapse 后的命中映射回原文；normalized index 绝不能直接作为 raw range。
实现会再次归一化 raw slice 作安全校验，不能可靠映射的极端输入宁可不给 range，也不返回错误位置。
Concept-only match 没有 surface field，因而不伪造 `matchedTerm`、`fieldPath` 或 range。

本阶段只提供未来安全渲染需要的 runtime metadata。UI 不得通过 query string 搜索或 replace 原文来
重算位置，而应只消费 structured match ranges。

## 9. Stage C2.3A — Match Reason UI（已完成）

结果卡片现在直接消费 structured `SearchHit.matches[]`，按 `clauseIndex` 顺序为每个 clause 显示一个
compact reason。Direct 显示用户可理解的字段标签和实际原文，query expansion 使用“同义·字段”及
实际匹配 surface term，concept-only 则按 `conceptKey` 从 reviewed runtime taxonomy 读取正式中文 label。

Surface reason 通过 `fieldPath` 安全读取单个原始字段，并只用第一个 raw UTF-16 range 的
`slice(start, end)`；空 range 或无效路径安全 fallback 到 structured `matchedTerm`，不通过 query 或
`indexOf` 重新搜索/推断文本位置。Cached card 在每次 `updateResults()` 都 replace reason children，
因此 query 切换与清空不会留下 stale reason。

## 10. Stage C2.3B — Optional Safe Highlighting（已完成）

搜索辅助区提供默认关闭且不持久化的“高亮匹配”checkbox。实现只消费 C2.2B2 的 `fieldPath` 与全部 raw
UTF-16 half-open ranges，通过固定的 `wisp-search-match` registry entry、DOM `Range` 和 CSS Custom
Highlight API 定位原始 name/effect/requirement 单一文本节点，不重新搜索 query 或修正 offset。Query
expansion 因而高亮真正的 surface term；concept-only、record alias、不可见字段、DOM/raw 不一致及无效范围
均安全跳过，Match Reason 仍负责解释原因。

这是 progressive enhancement：支持 API 时显示 toggle，不支持时隐藏 toggle，搜索与 Match Reason 继续工作；
没有 `<mark>` 或其他 fallback。每次 query/results/card cache/patch 变化先清理旧 registry，toggle off、清空
query 与进入规则页也立即清理；返回查询页且仍开启时从当前 cached cards 重建。Prismatic 折叠状态不改变。

Stage C2 搜索语义与搜索体验主线实现完成，等待 Stage C2 Final Audit / Closeout。
