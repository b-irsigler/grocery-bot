const AUTH_FAILURE_PATTERN = /403|forbidden|unauthor|2fa|second[_ ]?factor|mfa/i;

export function isPicnicAuthFailure(text: string): boolean {
  return AUTH_FAILURE_PATTERN.test(text);
}

export class PicnicAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PicnicAuthError";
  }
}
