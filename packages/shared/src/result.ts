export type Result<T, E = Error> = { ok: true; value: T } | { ok: false; error: E };

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
export const err = <E>(error: E): Result<never, E> => ({ ok: false, error });

export async function tryAsync<T, E = Error>(
  fn: () => Promise<T>,
  errorMapper?: (e: unknown) => E
): Promise<Result<T, E>> {
  try {
    const value = await fn();
    return ok(value);
  } catch (e) {
    // cast is safe: caller's errorMapper handles typing; fallback trusts E matches thrown value
    const error = errorMapper ? errorMapper(e) : (e as E);
    return err(error);
  }
}

export function trySync<T, E = Error>(fn: () => T, errorMapper?: (e: unknown) => E): Result<T, E> {
  try {
    return ok(fn());
  } catch (e) {
    // cast is safe: same rationale as tryAsync above
    const error = errorMapper ? errorMapper(e) : (e as E);
    return err(error);
  }
}
