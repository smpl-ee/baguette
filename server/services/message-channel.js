/**
 * Async-iterable message channel used to feed user messages into a Claude
 * agent query stream.  Messages are pushed in from event listeners and
 * consumed by the SDK's `query()` via `for await … of`.
 */
export function createMessageChannel() {
  const pending = [];
  let resolve = null;
  let done = false;

  return {
    [Symbol.asyncIterator]() {
      return this;
    },
    next() {
      if (done) return Promise.resolve({ value: undefined, done: true });
      if (pending.length) return Promise.resolve({ value: pending.shift(), done: false });
      return new Promise((r) => {
        resolve = r;
      });
    },
    push(msg) {
      if (done) return;
      if (resolve) {
        const r = resolve;
        resolve = null;
        r({ value: msg, done: false });
      } else {
        pending.push(msg);
      }
    },
    end() {
      done = true;
      if (resolve) {
        resolve({ value: undefined, done: true });
        resolve = null;
      }
    },
  };
}
