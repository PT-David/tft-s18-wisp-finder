# 验收测试 ACCEPTANCE_TESTS

## A. UI

1. 搜索结果不得分页；所有结果在单页连续滚动。
2. 桌面宽屏为多列卡片，手机自动变为 1～2 列。
3. 有 Requirements 的仙灵必须在折叠卡片直接显示条件提示。
4. 普通 / Blossom / 条件 / 限制常驻；Prismatic（存在时）和数据来源使用各自紧凑折叠区，且不重复业务信息。
5. 没有 Prismatic 的仙灵不显示空的 Prismatic 区块。
6. `仅棱彩` 能正确过滤。
7. 查询控件不得在输入时被重建；英文逐字编辑、连续删除和 IME composition 生命周期不丢失 caret/focus。
8. 完整查询面板不 sticky；桌面首屏可同时看到查询条件、结果标题和首行卡片主要内容。
9. 版本只在查询上下文选择器显示，卡片内不重复。
10. 搜索框只显示弱化的 AND 说明，不出现伪按钮；搜索图标使用垂直居中的 SVG。
11. 参考仙灵可按中英文名搜索、选择、清除，也可从卡片直接设置。
12. Stage C2.2B2 搜索基础设施：`SearchHit` 为每个成功 clause 提供且只提供一个 winning structured match；direct、query expansion、concept 可区分，surface match 携带实际 `fieldPath` 与安全的原始 UTF-16 `[start,end)` 范围，concept-only 不伪造范围；`matchedFields` 从 matches 派生，且 metadata 不改变结果、score、Candidate Pool 或 probability。
13. 搜索高亮仍未实现；未来可选高亮默认关闭，必须使用 structured match ranges 安全渲染，不得拼接用户 input 到 `innerHTML`，也不得自行重新搜索文本位置。

## B. 阶段

### Petrify Shields 回归用例

数据窗口：4-2～4-7，以及 6-1～10-1。

- 查询 4-3：出现。
- 查询 5-2：不出现。
- 查询 6-1：再次出现。

## C. 条件

### Hero of Prophecy

折叠卡必须能够显示至少：

- 35 金要求；
- 50 玩家生命要求；
- 等级 10 要求；
- once-per-game。

## D. 金币

若当前金币 3，价格 8 的 Field of Mice 不应进入“可负担候选池”。

注意：高级纯浏览过滤如果关闭“只看当前可负担”，仍允许用户查看其资料。

## E. 搜索

1. 搜“复制器”应能找到名字里没有“复制器”、但效果/内部概念涉及复制器的仙灵。
2. 搜“阵亡 复制”必须执行 AND，不得把只命中其中一个词的全部混入最高相关结果。
3. 搜“血量”应能通过同义词命中“生命值”。
4. “刷新”扩展仅使用“刷新 / 重随 / reroll”；不得因英文文本中的单字母 D 或名称中的 roll 命中。
5. “复制器”扩展不得使用英雄名“妮蔻”；安全组为 Champion Duplicator / 英雄复制器 / 复制器。
6. 法强、攻速、真伤可分别扩展到法术强度、攻击速度、真实伤害，且多关键词仍保持 AND。
7. 法强必须同时命中 production 使用的“法术加成”；攻击力必须命中“物理加成”。AP / AD 不作为同义词扩展。
8. 免费重随同时属于免费刷新与商店刷新概念；普通“重新”或页面刷新不得被泛化为商店刷新。
9. 实际升星动作与静态 N 星分属 `champion_star_up` / `champion_star_level`；裸 N 星不得产生升星动作。
10. Production 必须显式加载 reviewed query expansion 与 taxonomy artifacts；缺失、非法或 metadata 不一致时初始化失败，不得回退到硬编码词库。
11. taxonomy 中文 label 可通过 canonical `searchConcepts[]` 精确 key membership 命中；同 clause 同时命中文本与 concept 时只计最高字段分数。
12. reviewed synonym/concept 搜索仍只作用于 Displayed Results；Candidate Pool 与概率分母 N 不变。

## F. 概率

假设 Candidate Pool = 40，搜索结果命中 4：

- 目标集合概率 = 10%。
- 单仙灵基础等权概率 = 2.5%。

排除 1 个非目标仙灵：

- Pool = 39；目标仍 4；概率 = 4/39。

排除 1 个目标仙灵：

- Pool = 39；目标 = 3；概率 = 3/39。

不得把当前显示 4 张卡片错误计算为 100%。
排除后必须能够恢复单个仙灵或清空排除，并使 N、K 实时恢复。

## G. Stage 5+

强制 Combat 位：

- 非 Combat 候选概率为 0。
- Combat 候选在 Combat eligible pool 内等权。

不确定位：

- 同时展示普通位和强制 Combat 位；
- 不自动混成一个假设比例未知的单值。

## H. 数据验证

`npm test` 或等价测试必须覆盖：

- 重复 ID；
- 非法 category；
- 非法 stage range；
- 负数 cost；
- normal effect 为空；
- 缺来源元数据。
