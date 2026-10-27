export interface Document {
  id: string;
  title: string;
  url: string;
  locale: string;
  tags: string[];
  body: string;
}

export interface Chunk {
  id: string;
  documentId: string;
  ordinal: number;
  title: string;
  heading: string;
  url: string;
  locale: string;
  tags: string[];
  text: string;
  hash: string;
  embeddingTokens?: number;
  kind?: 'text' | 'code' | 'mixed';
  continuation?: boolean;
  sourceStart?: number;
  sourceEnd?: number;
}

export interface Source {
  id: string;
  documentId?: string;
  chunkId?: string;
  title: string;
  heading: string;
  url: string;
  text: string;
}
export interface Message {
  role: 'user' | 'assistant';
  content: string;
}
export interface ChatInput {
  message: string;
  history: Message[];
  articleId?: string;
  requestId: string;
}
export interface Usage {
  prompt_tokens: number;
  completion_tokens: number;
  prompt_cache_hit_tokens?: number;
}
export type Emit = (event: string, data: unknown) => void;
