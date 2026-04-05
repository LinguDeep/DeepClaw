/**
 * Browser automation module - web browsing, form filling, data extraction
 * Uses Puppeteer for headless browser control
 */

import { getLogger } from './logger';

const logger = getLogger();

export interface BrowseResult {
  success: boolean;
  url: string;
  title?: string;
  content?: string;
  screenshot?: string;
  error?: string;
  links?: { text: string; href: string }[];
  forms?: { action: string; fields: string[] }[];
}

export interface ExtractResult {
  success: boolean;
  data: any;
  error?: string;
}

export class BrowserAutomation {
  private browser: any;
  private page: any;
  private available: boolean;
  private puppeteer: any;

  constructor() {
    this.browser = null;
    this.page = null;
    this.available = false;
  }

  async init(): Promise<boolean> {
    try {
      this.puppeteer = require('puppeteer');
      this.browser = await this.puppeteer.launch({
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
      });
      this.page = await this.browser.newPage();
      await this.page.setUserAgent(
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      );
      this.available = true;
      logger.info('Browser automation initialized');
      return true;
    } catch (error: any) {
      logger.warn(`Browser automation unavailable: ${error.message}`);
      this.available = false;
      return false;
    }
  }

  get isAvailable(): boolean {
    return this.available;
  }

  async browse(url: string): Promise<BrowseResult> {
    if (!this.available || !this.page) {
      return { success: false, url, error: 'Browser not initialized. Install puppeteer: npm i puppeteer' };
    }

    try {
      await this.page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
      const title = await this.page.title();
      const content = await this.page.evaluate('(() => { const b = document.body; if (!b) return ""; const c = b.cloneNode(true); c.querySelectorAll("script,style,noscript").forEach(e => e.remove()); return c.innerText.substring(0, 5000); })()');

      const links = await this.page.evaluate('Array.from(document.querySelectorAll("a[href]")).slice(0,20).map(a => ({ text: (a.textContent||"").trim().substring(0,80), href: a.href }))');

      logger.info(`Browsed: ${url} - ${title}`);
      return { success: true, url, title, content, links };
    } catch (error: any) {
      return { success: false, url, error: error.message };
    }
  }

  async screenshot(url?: string): Promise<BrowseResult> {
    if (!this.available || !this.page) {
      return { success: false, url: url || '', error: 'Browser not initialized' };
    }

    try {
      if (url) await this.page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
      const screenshotBase64 = await this.page.screenshot({ encoding: 'base64', fullPage: false });
      const title = await this.page.title();
      return { success: true, url: this.page.url(), title, screenshot: screenshotBase64 };
    } catch (error: any) {
      return { success: false, url: url || '', error: error.message };
    }
  }

  async fillForm(selector: string, value: string): Promise<BrowseResult> {
    if (!this.available || !this.page) {
      return { success: false, url: '', error: 'Browser not initialized' };
    }

    try {
      await this.page.waitForSelector(selector, { timeout: 5000 });
      await this.page.type(selector, value);
      return { success: true, url: this.page.url() };
    } catch (error: any) {
      return { success: false, url: this.page.url(), error: error.message };
    }
  }

  async click(selector: string): Promise<BrowseResult> {
    if (!this.available || !this.page) {
      return { success: false, url: '', error: 'Browser not initialized' };
    }

    try {
      await this.page.waitForSelector(selector, { timeout: 5000 });
      await this.page.click(selector);
      await this.page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 10000 }).catch(() => {});
      const title = await this.page.title();
      return { success: true, url: this.page.url(), title };
    } catch (error: any) {
      return { success: false, url: this.page.url(), error: error.message };
    }
  }

  async extract(selector: string): Promise<ExtractResult> {
    if (!this.available || !this.page) {
      return { success: false, data: null, error: 'Browser not initialized' };
    }

    try {
      const data = await this.page.evaluate((sel: string) => {
        const elements = (globalThis as any).document.querySelectorAll(sel);
        return Array.from(elements).map((el: any) => ({
          text: el.textContent?.trim(),
          html: el.innerHTML?.substring(0, 500),
          tag: el.tagName,
          attrs: Object.fromEntries(
            Array.from(el.attributes || []).map((a: any) => [a.name, a.value])
          ),
        }));
      }, selector);
      return { success: true, data };
    } catch (error: any) {
      return { success: false, data: null, error: error.message };
    }
  }

  async evaluate(code: string): Promise<ExtractResult> {
    if (!this.available || !this.page) {
      return { success: false, data: null, error: 'Browser not initialized' };
    }

    try {
      const result = await this.page.evaluate(code);
      return { success: true, data: result };
    } catch (error: any) {
      return { success: false, data: null, error: error.message };
    }
  }

  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.page = null;
      this.available = false;
      logger.info('Browser closed');
    }
  }
}
