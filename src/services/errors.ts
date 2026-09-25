// User-facing failures from service commands. `code` is stable for UI branching and tests;
// `message` is readable as-is.
export class ServiceError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly detail?: Readonly<Record<string, unknown>>,
  ) {
    super(message)
    this.name = 'ServiceError'
  }
}

export function isServiceError(e: unknown, code?: string): e is ServiceError {
  return e instanceof ServiceError && (code === undefined || e.code === code)
}
