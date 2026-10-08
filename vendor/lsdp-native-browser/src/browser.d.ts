export interface IncomingContext {
  metadata: { profile?: string; target?: string };
  signal: AbortSignal;
}
export class BrowserLSDP {
  constructor(url: string, options?: {
    authToken?: string;
    onTransaction?: (value: unknown, context: IncomingContext) => Promise<unknown>;
    onIncomingFailed?: (context: IncomingContext, error: Error) => void;
    onClose?: (error: Error) => void;
  });
  readonly options: {
    onTransaction?: (value: unknown, context: IncomingContext) => Promise<unknown>;
    onIncomingFailed?: (context: IncomingContext, error: Error) => void;
    onClose?: (error: Error) => void;
  };
  readonly ready: Promise<void>;
  transaction(value: unknown, options?: { signal?: AbortSignal }): Promise<unknown>;
  close(): void;
}
