export class FetchError extends Error {
  constructor(
    message: string,
    public readonly url: string,
    public readonly provider: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'FetchError';
  }
}
