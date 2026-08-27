# 18.1 仙灵规则与概率边界

## A. 官方确认（Riot 18.1 / Enchanted Wilds Overview）

1. 仙灵分为 7 类：Champion、Combat、Misc、Shop、Gold/XP、Risky、Item。
2. 类别使用不同颜色和图标。
3. 仙灵只可在 planning phase 购买。
4. 仙灵正常情况下每隔一个商店出现，并位于最右侧。
5. 普通情况下每回合可购买 1 个仙灵。
6. Stage 5 以后，每隔一个仙灵保证为 Combat。
7. Blossom：
   - 3：仙灵升级；
   - 5：每个商店都有仙灵；
   - 7：购买后返还/获得金币；
   - 9：每回合可买 2 个；
   - 11：Prismatic 强化。

## B. 高置信玩家/数据观察（V1 不自动完整模拟）

以下不可标为 Riot 官方：

- 某一具体仙灵被提供后存在 reoffer cooldown；社区实测常见默认约 5 个 shop。
- Item 类具体仙灵可能有更长的约 20 shop reoffer cooldown。
- 恢复玩家生命的特定仙灵可能约 10 shop。
- 某些仙灵 once-per-game。
- 存在大量局面 Requirements。
- 观察支持“当前无法负担的仙灵可能不会被提供”，但完整抽取公式未由 Riot 公开。

注意：这些冷却描述作用于**某个具体仙灵再次被提供**，不是整个官方类型进入冷却。

## C. 尚未确认

目前不能假定游戏一定采用以下任一模型：

- 先抽类型，再在该类型内抽仙灵；
- 所有合资格仙灵完全等权直接抽；
- 每个仙灵有固定隐藏权重。

V1 的等权概率只是工具模型，不是“真实刷新率”。

## D. V1 概率公式

令当前游戏状态筛出的 Candidate Pool 为 E，大小 N。

基础等权：

`P(wisp_i) = 1 / N`

搜索目标集合 R 与 E 交集大小为 K：

`P(target group) = K / N`

用户排除集合 X 后：

`E' = E - X`

重新实时计算。

### Stage 5+

- 普通位：在普通合资格池中等权。
- 强制 Combat 位：仅在合资格 Combat 池中等权。
- 不确定：并排展示两种条件概率，不生成一个伪精确平均值。

## E. 容易误解的例子

Stage 5+ 的“每隔一个仙灵保证 Combat”不等于“Combat / 非 Combat 严格交替”。

逻辑是：

普通位 → 强制 Combat 位 → 普通位 → 强制 Combat 位

普通位仍可能随机得到 Combat，因此连续出现多个不同 Combat 仙灵是允许的。

具体仙灵 A 是否能很快再次出现，还要额外受 A 自己的 reoffer cooldown 约束。
