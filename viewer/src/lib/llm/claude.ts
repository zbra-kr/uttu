import Anthropic from '@anthropic-ai/sdk';
import type { LLMAdapter, LLMStreamParams, LLMStreamChunk } from './types';

export class ClaudeAdapter implements LLMAdapter {
  readonly provider = 'anthropic';
  readonly modelId: string;
  private client: Anthropic;

  constructor(modelId = 'claude-sonnet-4-6') {
    this.modelId = modelId;
    this.client  = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
  }

  async *stream(params: LLMStreamParams): AsyncIterable<LLMStreamChunk> {
    const stream = this.client.messages.stream({
      model:      this.modelId,
      max_tokens: params.max_tokens,
      system:     params.system,
      messages:   params.messages.map(m => ({
        role:    m.role,
        content: m.content,
      })),
    });

    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        yield { type: 'text', text: event.delta.text };
      }
    }

    const final = await stream.finalMessage();
    yield { type: 'usage', usage: { input_tokens: final.usage.input_tokens, output_tokens: final.usage.output_tokens } };
    yield { type: 'stop', stop_reason: final.stop_reason ?? 'end_turn' };
  }
}
