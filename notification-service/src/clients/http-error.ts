export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: string,
    public readonly url: string,
  ) {
    super(`HTTP ${status} from ${url}: ${body}`);
    this.name = 'HttpError';
  }

  get isUnauthorized(): boolean {
    return this.status === 401;
  }
}
