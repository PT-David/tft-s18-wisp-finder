import type { Wisp, WispDataset } from '../domain/types';

export interface WispRepository { getAll(): readonly Wisp[]; getById(id: string): Wisp | undefined }

export class JsonWispRepository implements WispRepository {
  readonly #records: readonly Wisp[];
  constructor(dataset: WispDataset) { this.#records = dataset.records; }
  getAll(): readonly Wisp[] { return this.#records; }
  getById(id: string): Wisp | undefined { return this.#records.find((wisp) => wisp.id === id); }
}

export async function loadWispDataset(url = '/data/wisps.json'): Promise<WispDataset> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`仙灵数据加载失败 (${response.status})`);
  return response.json() as Promise<WispDataset>;
}
