import { describe, expect, it } from 'vitest';
import {
  captureAuthReturnError,
  consumeAuthReturnError,
  readAuthReturnError,
  resetAuthReturnError,
} from './auth-return-error';

describe('readAuthReturnError', () => {
  it('finds the marker in the query string', () => {
    expect(
      readAuthReturnError('?error=server_error&error_code=unexpected_failure&error_description=Database+error%3A+signup_not_allowed', ''),
    ).toBe('signup_not_allowed');
  });

  it('finds the marker in the hash fragment', () => {
    expect(
      readAuthReturnError('', '#error=access_denied&error_description=signup_not_allowed'),
    ).toBe('signup_not_allowed');
  });

  it('handles plus and %20 encodings, any case', () => {
    expect(readAuthReturnError('', '#error_description=Signup+Not+Allowed')).toBe('signup_not_allowed');
    expect(readAuthReturnError('?error_description=SIGNUP%20NOT%20ALLOWED', '')).toBe('signup_not_allowed');
  });

  it('classifies an unrelated error as other', () => {
    expect(readAuthReturnError('?error=access_denied&error_description=User+cancelled', '')).toBe('other');
  });

  it('returns null without an error, and for a recovery link', () => {
    expect(readAuthReturnError('', '')).toBeNull();
    expect(readAuthReturnError('?denied=invite', '')).toBeNull();
    expect(readAuthReturnError('', '#access_token=abc&type=recovery')).toBeNull();
  });
});

describe('capture / consume', () => {
  it('hands the snapshot out exactly once', () => {
    resetAuthReturnError();
    captureAuthReturnError('', '#error_description=signup_not_allowed');
    expect(consumeAuthReturnError()).toBe('signup_not_allowed');
    expect(consumeAuthReturnError()).toBeNull();
    resetAuthReturnError();
  });
});
