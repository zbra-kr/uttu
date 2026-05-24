import OpenAI from 'openai';
import type { LLMAdapter, LLMStreamParams, LLMStreamChunk } from './types';

export class OpenAIAdapter implements LLMAdapter {
  readonly provider = 'openai';
  readonly modelId: string;

  constructor(modelId = 'gpt-4o') {
    this.modelId = modelId;
  }

  async *stream(params: LLMStreamParams): AsyncIterable<LLMStreamChunk> {
    if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY 환경변수 미설정');

    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const messages: OpenAI.ChatCompletionMessageParam[] = [];
    if (params.system) messages.push({ role: 'system', content: params.system });
    for (const m of params.messages) {
      messages.push({ role: m.role as 'user' | 'assistant', content: m.content });
    }

    const stream = await client.chat.completions.create({
      model:          this.modelId,
      messages,
      max_tokens:     params.max_tokens,
      stream:         true,
      stream_options: { include_usage: true },
    });

    let stopReason = 'stop';

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content;
      if (delta) yield { type: 'text', text: delta };

      const finish = chunk.choices[0]?.finish_reason;
      if (finish) stopReason = finish;

      if (chunk.usage) {
        yield {
          type: 'usage',
          usage: {
            input_tokens:  chunk.usage.prompt_tokens     ?? 0,
            output_tokens: chunk.usage.completion_tokens ?? 0,
          },
        };
      }
    }

    yield { type: 'stop', stop_reason: stopReason };
  }
}
