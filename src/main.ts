import './style.css';
import { JsonWispRepository, loadWispDataset } from './data/wispRepository';

const app = document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML = `<main><p class="eyebrow">TFT SET 18 · PATCH 18.1</p><h1>仙灵快速检索器</h1><p>阶段 A 核心层开发预览</p><div id="status" class="panel">正在读取开发种子数据…</div><p class="note">当前 JSON 是部分核验种子，并非完整仙灵全集。</p></main>`;

loadWispDataset().then((dataset) => {
  const repository = new JsonWispRepository(dataset);
  document.querySelector('#status')!.textContent = `核心模块已就绪 · 已加载 ${repository.getAll().length} 条回归测试种子`;
}).catch((error: unknown) => {
  document.querySelector('#status')!.textContent = error instanceof Error ? error.message : '数据加载失败';
});
