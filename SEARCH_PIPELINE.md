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

## 5. 后续工作

Stage C2.1 已针对 `generatorVersion = c2.1-v8` 和 normalized input SHA-256
`a7fdf375bc36f0f164a36912af4ca22c1671ede0ba94ae3e8ce3c8bbdee9abe7` 完成 taxonomy、
query expansion 与全部 assignment 的人工审核。当前 generated assignment 与 manual decision
为完整的一一对应关系，最终人工结果为 289/289 approved、0 rejected、0 modified。Validator
会双向检查 generated assignment 和 manual decision key set，防止未审核 assignment、过期 decision
或重复 decision 仅通过更新 metadata 绕过审核。

这一审核完成状态仍属于 C2.1 review overlay，不表示 reviewed concepts 已写入 production。
`data/normalized/wisps_18.1.json` 与 `public/data/wisps.json` 中的 `searchConcepts[]`、`synonyms[]`
继续保持为空；将审核结果 materialize 到 production search pipeline 是 Stage C2.2 的职责。

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
