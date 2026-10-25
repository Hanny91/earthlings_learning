/** A readable message for anything thrown; AuthError and ApiError already carry one. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.';
}
