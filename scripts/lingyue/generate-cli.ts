import { generate } from './generate.js';

generate().catch(() => {
  console.error('知识生成未完成。请检查快照、向量缓存和 SILICONFLOW_API_KEY；已有缓存已保留。');
  process.exitCode = 1;
});
