# 后续补丁更新流程

## 1. 每次 18.x 更新

1. 保存新版本 raw snapshot。
2. 规范化生成 `wisps_18.x.json`。
3. 执行 `validate-data`。
4. 对上一版本执行 `diff-data`。
5. 人工查看所有变动字段。
6. 只更新 normalized data / rules，不随意改 UI。
7. 回归测试。
8. 部署。

## 2. diff 输出重点

- 新增/删除仙灵；
- cost；
- stage ranges；
- normal effect；
- Blossom；
- Prismatic；
- Requirements；
- once-per-game；
- cooldown rules；
- official category。

## 3. 搜索词库更新

若效果文本变化：

1. 重新做关键词抽取；
2. 对变更仙灵重跑概念匹配；
3. 只对变化项人工复核；
4. 不必重审整套词库。

## 4. 规则更新

`rules/wisp_rules_18.x.json` 独立版本化。

若 Riot 修改 Stage 5 Combat 节奏、Blossom 阈值等，只更新规则文件与对应测试，不在组件中散落 magic numbers。
