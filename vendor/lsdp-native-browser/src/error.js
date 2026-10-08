export class LSDPError extends Error {
  constructor(code, outcome = "rejected") {
    super(code);
    this.name = "LSDPError";
    this.code = code;
    this.outcome = outcome;
  }
}
export const fail = (code, outcome) => {
  throw new LSDPError(code, outcome);
};
export function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  // A server-side peer may close before its owner awaits readiness.
  promise.catch(() => {});
  return { promise, resolve, reject };
}
