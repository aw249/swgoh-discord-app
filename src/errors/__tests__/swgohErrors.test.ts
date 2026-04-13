import {
  CloudflareBlockError,
  NoActiveBracketError,
  PlayerNotFoundError,
} from '../swgohErrors';

describe('SWGOH Custom Errors', () => {
  // -------------------------------------------------------------------------
  // CloudflareBlockError
  // -------------------------------------------------------------------------

  describe('CloudflareBlockError', () => {
    it('is instanceof Error', () => {
      expect(new CloudflareBlockError()).toBeInstanceOf(Error);
    });

    it('has correct name', () => {
      expect(new CloudflareBlockError().name).toBe('CloudflareBlockError');
    });

    it('uses default message when none provided', () => {
      const err = new CloudflareBlockError();
      expect(err.message).toMatch(/Cloudflare/i);
    });

    it('preserves a custom message', () => {
      const err = new CloudflareBlockError('custom cloudflare message');
      expect(err.message).toBe('custom cloudflare message');
    });

    it('is instanceof CloudflareBlockError', () => {
      expect(new CloudflareBlockError()).toBeInstanceOf(CloudflareBlockError);
    });
  });

  // -------------------------------------------------------------------------
  // NoActiveBracketError
  // -------------------------------------------------------------------------

  describe('NoActiveBracketError', () => {
    it('is instanceof Error', () => {
      expect(new NoActiveBracketError()).toBeInstanceOf(Error);
    });

    it('has correct name', () => {
      expect(new NoActiveBracketError().name).toBe('NoActiveBracketError');
    });

    it('uses default message when none provided', () => {
      const err = new NoActiveBracketError();
      expect(err.message).toMatch(/bracket/i);
    });

    it('preserves a custom message', () => {
      const err = new NoActiveBracketError('no bracket found');
      expect(err.message).toBe('no bracket found');
    });

    it('is instanceof NoActiveBracketError', () => {
      expect(new NoActiveBracketError()).toBeInstanceOf(NoActiveBracketError);
    });
  });

  // -------------------------------------------------------------------------
  // PlayerNotFoundError
  // -------------------------------------------------------------------------

  describe('PlayerNotFoundError', () => {
    it('is instanceof Error', () => {
      expect(new PlayerNotFoundError()).toBeInstanceOf(Error);
    });

    it('has correct name', () => {
      expect(new PlayerNotFoundError().name).toBe('PlayerNotFoundError');
    });

    it('uses default message when none provided', () => {
      const err = new PlayerNotFoundError();
      expect(err.message).toMatch(/player/i);
    });

    it('preserves a custom message', () => {
      const err = new PlayerNotFoundError('ally code 123 not found');
      expect(err.message).toBe('ally code 123 not found');
    });

    it('is instanceof PlayerNotFoundError', () => {
      expect(new PlayerNotFoundError()).toBeInstanceOf(PlayerNotFoundError);
    });
  });

  // -------------------------------------------------------------------------
  // Cross-type checks: errors don't mix up
  // -------------------------------------------------------------------------

  it('CloudflareBlockError is not instanceof NoActiveBracketError', () => {
    expect(new CloudflareBlockError()).not.toBeInstanceOf(NoActiveBracketError);
  });

  it('PlayerNotFoundError is not instanceof CloudflareBlockError', () => {
    expect(new PlayerNotFoundError()).not.toBeInstanceOf(CloudflareBlockError);
  });
});
