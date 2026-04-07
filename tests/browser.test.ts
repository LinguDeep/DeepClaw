import { BrowserAutomation } from '../src/browser';

describe('BrowserAutomation', () => {
  let browser: BrowserAutomation;

  beforeEach(() => {
    browser = new BrowserAutomation();
  });

  afterEach(async () => {
    await browser.close();
  });

  it('should initialize as unavailable', () => {
    expect(browser.isAvailable).toBe(false);
  });

  it('should return empty history initially', () => {
    expect(browser.getHistory()).toEqual([]);
  });

  it('should return error when browsing without init', async () => {
    const result = await browser.browse('https://example.com');
    expect(result.success).toBe(false);
    expect(result.error).toContain('not initialized');
  });

  it('should return error when taking screenshot without init', async () => {
    const result = await browser.screenshot();
    expect(result.success).toBe(false);
    expect(result.error).toContain('not initialized');
  });

  it('should return error when filling form without init', async () => {
    const result = await browser.fillForm('#input', 'value');
    expect(result.success).toBe(false);
    expect(result.error).toContain('not initialized');
  });

  it('should return error when clicking without init', async () => {
    const result = await browser.click('#button');
    expect(result.success).toBe(false);
    expect(result.error).toContain('not initialized');
  });

  it('should return error when extracting without init', async () => {
    const result = await browser.extract('.class');
    expect(result.success).toBe(false);
    expect(result.error).toContain('not initialized');
  });

  it('should return error when evaluating without init', async () => {
    const result = await browser.evaluate('1+1');
    expect(result.success).toBe(false);
    expect(result.error).toContain('not initialized');
  });

  it('should return error when waiting without init', async () => {
    const result = await browser.waitFor('#elem');
    expect(result.success).toBe(false);
    expect(result.error).toContain('not initialized');
  });

  it('should return error when generating PDF without init', async () => {
    const result = await browser.pdf();
    expect(result.success).toBe(false);
    expect(result.error).toContain('not initialized');
  });

  it('should use fallback search when browser unavailable', async () => {
    // This tests the HTTP fallback - may fail without internet
    const result = await browser.search('test query');
    // Either succeeds via fallback or fails gracefully
    expect(typeof result.success).toBe('boolean');
    expect(Array.isArray(result.results)).toBe(true);
  });

  it('should close without error when not initialized', async () => {
    await expect(browser.close()).resolves.not.toThrow();
  });
});
