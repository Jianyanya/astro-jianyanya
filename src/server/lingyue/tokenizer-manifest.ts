export const TOKENIZERS = {
  bge: {
    model: 'BAAI/bge-m3',
    revision: '5617a9f61b028005a4858fdac845db406aefb181',
    files: [
      {
        source: 'tokenizer.json',
        local: 'bge.json',
        algorithm: 'sha256',
        digest: '21106b6d7dab2952c1d496fb21d5dc9db75c28ed361a05f5020bbba27810dd08',
      },
      {
        source: 'tokenizer_config.json',
        local: 'bge.config.json',
        algorithm: 'git',
        digest: 'dc69ac559dcba2694012009aaa108c614541789a',
      },
    ],
  },
  chat: {
    model: 'deepseek-ai/DeepSeek-V4.1-Flash-1017',
    revision: '1bae0e1088993b9b82de08f59de5be5a34e42170',
    files: [
      { source: 'tokenizer.json', local: 'chat.json', algorithm: 'git', digest: '6a15814dd25c934028034531da744c689f87ff21' },
      {
        source: 'tokenizer_config.json',
        local: 'chat.config.json',
        algorithm: 'git',
        digest: 'f3dad388a2bbfd6a8605bd02754acd86d9ca5112',
      },
      { source: 'LICENSE', local: 'DeepSeek-LICENSE', algorithm: 'git', digest: 'd62e3bef9f054f21b7fc616365850fbf879a99ff' },
    ],
  },
} as const;
export type TokenizerKind = keyof typeof TOKENIZERS;
