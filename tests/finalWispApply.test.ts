import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { searchWisps } from '../src/search/searchEngine';
import { parseRuntimeSearchLexicon } from '../src/data/searchLexiconRepository';
import { buildNewRecordPlan } from '../scripts/data/lib/c4.2b-field-decisions';
import { composeB4Lifecycle } from '../scripts/data/lib/c4.2b4-final-fields';
import { applyFinalBlockerOverrides } from '../scripts/data/lib/final-wisp-apply';

const json = (path: string) => JSON.parse(readFileSync(path, 'utf8'));
const base = 'data/reviews/18.1/';
const effective = composeB4Lifecycle(json(`${base}c4.2b2-field-evidence.json`), json(`${base}c4.2b-field-decisions.json`), json(`${base}c4.2b3-required-field-evidence.json`), json(`${base}c4.2b3-required-field-decisions.json`), json(`${base}c4.2b4-final-field-evidence.json`), json(`${base}c4.2b4-final-field-decisions.json`));
const manual = json('data/c4_final_three_blocker_overrides_18.1.json');
const production = json('data/normalized/wisps_18.1.json');

describe('final Set 18 data Apply', () => {
  it('adds exactly seven distinct reviewed base identities', () => {
    const ids = ['DA_BearsVisit18', 'DA_MemorialDummy18', 'DA_PottedLifebloom18', 'DA_PottedStonebark18', 'DA_Snacktime18', 'DA_TigersVisit18_Wisp', 'DA_TurtlesVisit18'];
    expect(production.records).toHaveLength(176);
    for (const id of ids) expect(production.records.filter((record: any) => record.riotId === id)).toHaveLength(1);
    expect(new Set(production.records.map((record: any) => record.riotId).filter(Boolean)).size).toBe(production.records.filter((record: any) => record.riotId).length);
    expect(new Set(ids.slice(-2).concat(ids[0]!)).size).toBe(3);
    expect(production.records.some((record: any) => record.riotId === 'DA_BearsVisit18_Upgrade')).toBe(false);
    expect(production.records.find((record: any) => record.riotId === 'DA_Snacktime18').cost).toBe(3);
  });

  it('keeps Tiger byte-equivalent to the pre-existing effective plan', () => {
    const expected = buildNewRecordPlan(effective.frozen, effective.overlay, 'DA_TigersVisit18_Wisp');
    expect(production.records.find((record: any) => record.riotId === 'DA_TigersVisit18_Wisp')).toEqual(expected);
  });

  it('fails closed for extra, duplicate, unknown, and wrong-valued overrides', () => {
    const mutate = (change: (value: any) => void) => { const value = structuredClone(manual); change(value); return () => applyFinalBlockerOverrides(effective, value); };
    expect(mutate((value) => value.overrides.push({ riotId: 'DA_TigersVisit18_Wisp', field: 'cost', value: 99 }))).toThrow(/not allowed/);
    expect(mutate((value) => value.overrides.push(structuredClone(value.overrides[0])))).toThrow(/Duplicate/);
    expect(mutate((value) => value.overrides[0].riotId = 'unknown')).toThrow(/not allowed/);
    expect(mutate((value) => value.overrides[2].value = 4)).toThrow(/unexpected value/);
    expect(mutate((value) => value.overrides[1].value[0].textZh = '错误条件')).toThrow(/unexpected value/);
    expect(mutate((value) => value.overrides[1].value[0].textEn = 'Wrong requirement')).toThrow(/unexpected value/);
  });

  it('finds every addition by Chinese name, English name, and effect text', () => {
    const concepts = json('data/materialized/18.1/search-concepts.json'), synonyms = json('data/materialized/18.1/synonyms.json');
    const lexicon = parseRuntimeSearchLexicon(concepts, synonyms);
    for (const record of production.records.filter((item: any) => ['DA_BearsVisit18', 'DA_MemorialDummy18', 'DA_PottedLifebloom18', 'DA_PottedStonebark18', 'DA_Snacktime18', 'DA_TigersVisit18_Wisp', 'DA_TurtlesVisit18'].includes(item.riotId))) {
      for (const query of [record.nameZh, record.nameEn, record.effects.normal]) expect(searchWisps(production.records, query, lexicon).some(({ wisp }) => wisp.id === record.id)).toBe(true);
      expect(record.searchConcepts).toEqual([]); expect(record.synonyms).toEqual([]);
    }
  });
});
