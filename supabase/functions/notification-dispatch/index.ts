import { createHandler, readConfig } from "./core.ts";

// Supabase supplies Deno at runtime; no Node/Python dependencies or secrets are bundled.
const runtime = (globalThis as unknown as {
  Deno: {
    env: { get(name: string): string | undefined };
    serve(handler: (request: Request) => Promise<Response>): unknown;
  };
}).Deno;
runtime.serve(createHandler(readConfig((name) => runtime.env.get(name))));
