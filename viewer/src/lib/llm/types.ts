// LLM provider abstraction — adapter 기반 streaming (tool-free)
// tool calling은 /api/ai/chat에서 provider별 직접 처리

export interface LLMMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface LLMUsage {
  input_tokens: number;
  output_tokens: number;
}

export type LLMStreamChunk =
  | { type: 'text';  text: string }
  | { type: 'usage'; usage: LLMUsage }
  | { type: 'stop';  stop_reason: string };

export interface LLMStreamParams {
  messages:    LLMMessage[];
  system?:     string;
  max_tokens:  number;
  temperature?: number;
}

export interface LLMAdapter {
  readonly provider: string;
  readonly modelId:  string;
  stream(params: LLMStreamParams): AsyncIterable<LLMStreamChunk>;
}
