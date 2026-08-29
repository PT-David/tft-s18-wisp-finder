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
- 复制器 / 妮蔻 / Champion Duplicator
- 阵亡 / 死亡
- 击杀 / 击倒 / takedown
- 刷新 / D / reroll / roll
- 经验 / XP

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
`survival_duration`，buff duration 不属于 survival 或 stage/time condition。

## 5. 后续工作

使用完整 18.1 仙灵文本实际生成第一版：

- `search-concepts.json`
- `synonyms.json`
- 每个仙灵的 `searchConcepts[]`

C2.1 draft 经人工审核后再进入 C2.2；不得直接把自动候选灌入 production 字段。
