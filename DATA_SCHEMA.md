# 数据结构 DATA_SCHEMA

## 1. 核心原则

- 中文展示名不是主键。
- 英文名也不是唯一可靠主键。
- 优先使用客户端/Riot 内部 ID；若正式 18.1 ID 尚未取得，使用稳定临时 ID，并预留 `riotId`。
- 阶段必须是数组，支持不连续区间。
- Requirements 同时存机器字段与展示文本。
- 每个字段可以追踪来源，而不是整个对象只有一个来源。

## 2. TypeScript 建议接口

```ts
export type WispCategory =
  | 'champion'
  | 'combat'
  | 'misc'
  | 'shop'
  | 'gold_xp'
  | 'risky'
  | 'item';

export type Confidence =
  | 'official'
  | 'client_data'
  | 'verified_third_party'
  | 'community_high_confidence'
  | 'unverified';

export interface StagePoint {
  stage: number;
  round: number;
}

export interface StageRange {
  start: StagePoint;
  end: StagePoint;
}

export interface Requirement {
  type: string;
  operator?: '>' | '>=' | '<' | '<=' | '=' | '!=' | 'in' | 'active' | 'inactive';
  value?: number | string | boolean | string[];
  textZh: string;
  textEn?: string;
  machineEvaluable: boolean;
}

export interface FieldSource {
  sourceId: string;
  verifiedAt: string;
  confidence: Confidence;
}

export type Knowledge<T> =
  | { status: 'unknown' }
  | { status: 'confirmed'; value: T };

export interface Wisp {
  id: string;
  riotId?: string | null;
  nameZh: string;
  nameEn: string;
  category: WispCategory;
  cost: number;
  minimumAffordableGold?: number | null;
  stageRanges: StageRange[];

  effects: {
    normal: string;
    blossom?: string | null;
    prismatic?: string | null;
  };

  requirements: Requirement[];
  oncePerGame: boolean | Knowledge<boolean>;
  reofferCooldownShops?: number | null | Knowledge<number | null>;

  searchConcepts: string[];
  synonyms: string[];

  sources: Record<string, FieldSource>;
  patch: '18.1';
}
```

生产快照使用 `Knowledge<T>` 区分未知与已确认值。旧 seed 中的 boolean/number/null
继续作为向后兼容输入；新生产数据不得用 `false` 或 `null` 表示未取得信息。
`minimumAffordableGold` 没有独立证据时省略；不得仅将 `cost` 复制到该字段并声称为
已确认最低可负担金币。候选过滤仍可把基础售价作为显然必要的购买下界，但不能把它展示为完整规则。

## 3. Requirements 结构示例

玩家生命：

```json
{
  "type": "player_health",
  "operator": ">=",
  "value": 50,
  "textZh": "玩家生命值至少为 50",
  "machineEvaluable": true
}
```

连胜：

```json
{
  "type": "win_streak",
  "operator": ">=",
  "value": 5,
  "textZh": "至少 5 连胜",
  "machineEvaluable": true
}
```

羁绊：

```json
{
  "type": "trait",
  "operator": "active",
  "value": "lunar",
  "textZh": "需要激活 Lunar 羁绊",
  "machineEvaluable": true
}
```

无法可靠机器判断的特殊规则仍可保留：

```json
{
  "type": "special",
  "textZh": "上回合至少登场 5 个 1 费英雄",
  "machineEvaluable": false
}
```

## 4. 数据完整性

`validate-data` 至少检查：

- `id` 唯一；
- `category` 属于 7 类；
- `cost >= 0`；
- `stageRanges` 非空；
- start <= end；
- normal effect 非空；
- `prismatic` 允许 null；
- 每个关键字段有来源；
- 18.1 数据不得混入标明为早期 PBE 且未经核验的数值。
