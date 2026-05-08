/**
 * Shared helpers for capturing LLM provider response metadata from a
 * `streamResult.response` promise. Used by both the WS and SSE transports so
 * observability (response id, model id, provider headers like
 * x-correlation-id) is emitted consistently.
 *
 * The ai-lib boundary already attaches a rejection suppressor to the same
 * promise (see `packages/ai-lib/src/core/agent-factory.ts`), so callers here
 * never need to worry about leaking unhandled rejections — a rejected
 * response promise simply yields no metadata.
 */

export interface ResponseMetadata {
  headers?: Record<string, string>;
  responseId?: string;
  modelId?: string;
}

type ResponseLike = {
  id?: string;
  modelId?: string;
  headers?: Record<string, string>;
};

/**
 * Attach non-blocking handlers to a response promise. Fires `onResolved` when
 * the metadata arrives; swallows rejections (the ai-lib boundary has already
 * logged / suppressed them). Never awaits — safe to call on the stream hot
 * path.
 */
export function captureResponseMetadata(
  responsePromise: PromiseLike<ResponseLike> | undefined,
  onResolved: (meta: ResponseMetadata) => void
): void {
  if (!responsePromise) return;
  Promise.resolve(responsePromise).then(
    (res) => {
      const meta: ResponseMetadata = {};
      if (res?.headers) meta.headers = res.headers;
      if (res?.id) meta.responseId = res.id;
      if (res?.modelId) meta.modelId = res.modelId;
      onResolved(meta);
    },
    () => {
      /* rejection already suppressed at ai-lib boundary — nothing to do */
    }
  );
}

/**
 * Await a response promise up to `timeoutMs`, returning `{}` if it rejects or
 * times out. Use this as a fallback when `captureResponseMetadata`'s eager
 * handler hasn't fired yet and you need the metadata now (e.g., about to emit
 * a terminal event).
 */
export async function awaitResponseMetadata(
  responsePromise: PromiseLike<ResponseLike> | undefined,
  timeoutMs = 500
): Promise<ResponseMetadata> {
  if (!responsePromise) return {};
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const res = await Promise.race<ResponseLike | undefined>([
      Promise.resolve(responsePromise).catch(() => undefined),
      new Promise<undefined>((resolve) => {
        timer = setTimeout(() => resolve(undefined), timeoutMs);
        timer.unref();
      }),
    ]);
    if (!res) return {};
    const meta: ResponseMetadata = {};
    if (res.headers) meta.headers = res.headers;
    if (res.id) meta.responseId = res.id;
    if (res.modelId) meta.modelId = res.modelId;
    return meta;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
