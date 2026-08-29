# TFT 18.1 Wisp 数据审计

- 快照：DataTFT 2026-08-28T16:49:16Z；OP.GG 2026-08-29T04:15:26Z。
- OP.GG：HTTP 200，SHA-256 dca16121554a06b6f864da3d85e357375e2a4c8fd3e7def55fb7cb1b92e6e5da，页面声明 200 条，实际解析 200 条；分类合计 200。
- 旧算法会无阈值地耗尽两侧记录，因而人为制造 169/31/0；该结果已删除。新规则只有 client key、唯一英文名、唯一中文名和 reviewed alias 可以确认身份。
- 确认交集：166（{"exact_client_key":144,"exact_english_name":15,"exact_chinese_name":4,"reviewed_cross_source_identity":3}）；模糊候选 34，其中 ambiguous 21。候选不会进入确认交集。
- CommunityDragon identity audit：raw 345 行（base 163 / Upgrade 163 / Prismatic 19）；unique base apiName 163，unique canonical base identity 163；exact duplicate groups 0，conflicting groups 0，canonical collisions 0。
- Duplicate audit 前→后：{"status":"historical_superseded","confirmedIntersection":152,"exactClientKey":144,"candidateCount":48,"ambiguousCount":27,"unresolvedOpggCount":48,"dataTftUnmatchedCount":17,"confirmedCorpusButIncomplete":8} → {"confirmedIntersection":166,"exactClientKey":144,"candidateCount":34,"ambiguousCount":21,"unresolvedOpggCount":34,"dataTftUnmatchedCount":1,"confirmedCorpusButIncomplete":6}；0 个 candidate 因安全去重升级为 exact_client_key。
- 当前已提交 CDragon snapshot 没有重复 apiName；显式 reviewed cross-source mapping 共 17 条，未隐藏在代码 special case 中。Mitosis base/Upgrade 分层保持正确，blossom 仍为 null。
- 确认 OP.GG-only：0；DataTFT unmatched（不等同于其它来源不存在）：1；OP.GG unresolved：34。原 31 条差异结论已全部撤销并按当前强证据重新计算。
- CommunityDragon 为 6 条未链接 OP.GG identity 提供 exact base client identity；它确认 corpus 身份，但不能证明这些记录与 1 条 DataTFT unmatched rows 相互独立，因此 confirmed OP.GG-only 仍为 0。
- appearanceCondition 只作为需求字段，绝不再决定 A/C 或排除。规则授权的条件 Wisp 仍属于 corpus。
- 当前可证实 corpus 下限为 169；normalized production 也是 169。另有 6 个已确认 corpus identity 尚未完成 DataTFT/production 身份链接，不能重复计数。
- Blossom 130；Mitosis 的非独立 Upgrade 仍为 null。Knowledge<T>、字段 provenance、seed/production 分离均保持不变。
- LoLCHESS browser snapshot：174 条，按确认/reviewed canonical identity 与 production 匹配 164 条；逐字段审计见 data-lolchess-field-audit-18.1.json。来源规模 163/169/174/200 分别反映 CommunityDragon canonical base、DataTFT normalized、LoLCHESS rendered catalog、OP.GG catalog 的不同结构与口径，不能仅凭数量选择全集。
- **Production ready：否。** 当前仍需人工审核 34 个 OP.GG candidate group 与 1 个 DataTFT unmatched rows；离线构建保持确定性。
