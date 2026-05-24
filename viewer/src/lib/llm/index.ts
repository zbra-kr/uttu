export type { LLMAdapter, LLMMessage, LLMUsage, LLMStreamChunk, LLMStreamParams } from './types';
export { ClaudeAdapter }  from './claude';
export { OpenAIAdapter }  from './openai';
export { GeminiAdapter }  from './gemini';

import type { LLMAdapter } from './types';
import { ClaudeAdapter }   from './claude';
import { OpenAIAdapter }   from './openai';
import { GeminiAdapter }   from './gemini';

export function getAdapter(provider: string, modelId?: string): LLMAdapter {
  switch (provider) {
    case 'anthropic': return new ClaudeAdapter(modelId);
    case 'openai':    return new OpenAIAdapter(modelId);
    case 'google':    return new GeminiAdapter(modelId);
    default: throw new Error(`Unknown LLM provider: ${provider}`);
  }
}
