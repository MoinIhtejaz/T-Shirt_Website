import { useCallback, useEffect, useRef, useState } from 'react';
import { isAbortError } from '../lib/api/client';

export type AsyncState<T> =
  | { status: 'loading'; data: undefined; error: undefined }
  | { status: 'success'; data: T; error: undefined }
  | { status: 'error'; data: undefined; error: unknown };

export type AsyncResult<T> = AsyncState<T> & {
  /** Runs the loader again (used by every "Try again" button). */
  reload: () => void;
  /** Replaces the loaded data locally after a mutation. */
  setData: (update: (current: T) => T) => void;
};

/**
 * Runs `load` whenever `deps` change, aborting the previous run.
 * The loader receives an AbortSignal it should pass to the API client.
 */
export function useAsync<T>(load: (signal: AbortSignal) => Promise<T>, deps: readonly unknown[]): AsyncResult<T> {
  const [state, setState] = useState<AsyncState<T>>({ status: 'loading', data: undefined, error: undefined });
  const [attempt, setAttempt] = useState(0);
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: 'loading', data: undefined, error: undefined });
    loadRef.current(controller.signal).then(
      (data) => {
        if (!controller.signal.aborted) setState({ status: 'success', data, error: undefined });
      },
      (error: unknown) => {
        if (controller.signal.aborted || isAbortError(error)) return;
        setState({ status: 'error', data: undefined, error });
      },
    );
    return () => controller.abort();
  }, [...deps, attempt]);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);
  const setData = useCallback((update: (current: T) => T) => {
    setState((s) => (s.status === 'success' ? { ...s, data: update(s.data) } : s));
  }, []);

  return { ...state, reload, setData };
}
