'use client';

export class FundingReadTimeoutError extends Error {
  constructor() { super('Funding UI read deadline exceeded'); this.name = 'FundingReadTimeoutError'; }
}

/** Bounds UI waiting only; abort does not prove backend query cancellation. */
export function startFundingRead<T>(read: (signal: AbortSignal) => Promise<T>) {
  const controller = new AbortController();
  let settled = false;
  let cancel = () => {};
  const promise = new Promise<T>((resolve, reject) => {
    const finish = (publish: () => void) => {
      if (settled) return;
      settled = true; clearTimeout(timer); publish();
    };
    const timer = setTimeout(() => finish(() => {
      reject(new FundingReadTimeoutError()); controller.abort();
    }), 15000);
    cancel = () => finish(() => {
      const error = new Error('Funding read disposed'); error.name = 'AbortError';
      reject(error); controller.abort();
    });
    try {
      void read(controller.signal).then(value => finish(() => resolve(value)), error => finish(() => reject(error)));
    } catch (error) { finish(() => reject(error)); }
  });
  return { promise, cancel: () => cancel() };
}
