// The one error the pipeline treats as a verdict: its key is stored on the job or pass and shown
// to the admin as a translated text (`translate.*`). Everything else counts as a retryable fault.

export class TranslateError extends Error {
  key: string;
  constructor(key: string) {
    super(key);
    this.key = key;
  }
}
