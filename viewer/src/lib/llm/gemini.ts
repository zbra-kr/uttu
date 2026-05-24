import { GoogleGenerativeAI } from '@google/generative-ai';
import type { LLMAdapter, LLMStreamParams, LLMStreamChunk } from './types';

export class GeminiAdapter implements LLMAdapter {
  readonly provider = 'google';
  readonly modelId: string;

  constructor(modelId = 'gemini-2.0-flash') {
    this.modelId = modelId;
  }

  async *stream(params: LLMStreamParams): AsyncIterable<LLMStreamChunk> {
    if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY 환경변수 미설정');

    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({
      model: this.modelId,
      ...(params.system ? { systemInstruction: params.system } : {}),
    });

    const contents = params.messages.map(m => ({
      role:  m.role === 'assistant' ? 'model' as const : 'user' as const,
      parts: [{ text: m.content }],
    }));

    const result = await model.generateContentStream({ contents });

    for await (const chunk of result.stream) {
      const text = chunk.text();
      if (text) yield { type: 'text', text };
    }

    const final = await result.response;
    yield {
      type: 'usage',
      usage: {
        input_tokens:  final.usageMetadata?.promptTokenCount     ?? 0,
        output_tokens: final.usageMetadata?.candidatesTokenCount ?? 0,
      },
    };
    yield { type: 'stop', stop_reason: 'stop' };
  }
}
