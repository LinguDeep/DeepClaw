/**
 * Browser automation module - web browsing, search, form filling, data extraction
 * Uses Puppeteer for headless browser control
 */

import { getLogger } from './logger';
import axios from 'axios';

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

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export class BrowserAutomation {
  private browser: any;
  private page: any;
  private available: boolean;
  private puppeteer: any;
  private history: { url: string; title: string; timestamp: string }[] = [];

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
        args: [
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
        ],
      });
      this.page = await this.browser.newPage();
      await this.page.setUserAgent(
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      );
      await this.page.setViewport({ width: 1280, height: 800 });
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

  getHistory(): typeof this.history {
    return this.history.slice(-50);
  }

  async browse(url: string): Promise<BrowseResult> {
    if (!this.available || !this.page) {
      return { success: false, url, error: 'Browser not initialized. Install puppeteer: npm i puppeteer' };
    }

    try {
      const response = await this.page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
      const status = response?.status();
      const title = await this.page.title();

      const content = await this.page.evaluate('(() => { const b = document.body; if (!b) return ""; const c = b.cloneNode(true); c.querySelectorAll("script,style,noscript,svg,iframe").forEach(e => e.remove()); return c.innerText.substring(0, 8000); })()');

      const links = await this.page.evaluate('Array.from(document.querySelectorAll("a[href]")).slice(0,30).map(a => ({ text: (a.textContent||"").trim().substring(0,100), href: a.href })).filter(l => l.text && l.href.startsWith("http"))');

      const forms = await this.page.evaluate('Array.from(document.querySelectorAll("form")).slice(0,5).map(f => ({ action: f.action, fields: Array.from(f.querySelectorAll("input,textarea,select")).map(el => (el.name||el.id)+"["+( el.type||"text")+"]") }))');

      this.history.push({ url, title, timestamp: new Date().toISOString() });
      logger.info(`Browsed: ${url} - ${title} (${status})`);
      return { success: true, url, title, content, links, forms };
    } catch (error: any) {
      return { success: false, url, error: error.message };
    }
  }

  async search(query: string): Promise<{ success: boolean; results: SearchResult[]; error?: string }> {
    if (!this.available || !this.page) {
      // Fallback: use DuckDuckGo HTML API
      return this.searchFallback(query);
    }

    try {
      const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
      await this.page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 15000 });

      const results: SearchResult[] = await this.page.evaluate('Array.from(document.querySelectorAll(".result")).slice(0,10).map(item => ({ title: (item.querySelector(".result__title")?.textContent||"").trim(), url: (item.querySelector(".result__url")?.textContent||"").trim(), snippet: (item.querySelector(".result__snippet")?.textContent||"").trim() })).filter(r => r.title && r.url)');

      logger.info(`Search: "${query}" - ${results.length} results`);
      return { success: true, results };
    } catch (error: any) {
      return this.searchFallback(query);
    }
  }

  private async searchFallback(query: string): Promise<{ success: boolean; results: SearchResult[]; error?: string }> {
    try {
      const res = await axios.get(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        timeout: 10000,
      });

      const html = res.data as string;
      const results: SearchResult[] = [];
      const regex = /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>[\s\S]*?<a[^>]*class="result__snippet"[^>]*>(.*?)<\/a>/gi;
      let match;

      while ((match = regex.exec(html)) !== null && results.length < 10) {
        results.push({
          url: match[1].replace(/.*uddg=/, '').split('&')[0],
          title: match[2].replace(/<[^>]*>/g, '').trim(),
          snippet: match[3].replace(/<[^>]*>/g, '').trim(),
        });
      }

      return { success: true, results };
    } catch (error: any) {
      return { success: false, results: [], error: error.message };
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
      await this.page.click(selector, { clickCount: 3 }); // Select all existing text
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
      await Promise.all([
        this.page.click(selector),
        this.page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 10000 }).catch(() => {}),
      ]);
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
      const data = await this.page.evaluate(`Array.from(document.querySelectorAll(${JSON.stringify(selector)})).slice(0,50).map(el => ({ text: el.textContent?.trim()?.substring(0,500), html: el.innerHTML?.substring(0,500), tag: el.tagName, attrs: Object.fromEntries(Array.from(el.attributes||[]).map(a => [a.name, a.value])) }))`);
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
      const result = await this.page.evaluate(`(async () => { ${code} })()`);
      return { success: true, data: result };
    } catch (error: any) {
      return { success: false, data: null, error: error.message };
    }
  }

  async waitFor(selector: string, timeout: number = 5000): Promise<BrowseResult> {
    if (!this.available || !this.page) {
      return { success: false, url: '', error: 'Browser not initialized' };
    }

    try {
      await this.page.waitForSelector(selector, { timeout });
      return { success: true, url: this.page.url() };
    } catch (error: any) {
      return { success: false, url: this.page.url(), error: `Timeout waiting for ${selector}` };
    }
  }

  async pdf(outputPath?: string): Promise<{ success: boolean; path?: string; data?: string; error?: string }> {
    if (!this.available || !this.page) {
      return { success: false, error: 'Browser not initialized' };
    }

    try {
      if (outputPath) {
        await this.page.pdf({ path: outputPath, format: 'A4' });
        return { success: true, path: outputPath };
      } else {
        const data = await this.page.pdf({ format: 'A4' });
        return { success: true, data: data.toString('base64') };
      }
    } catch (error: any) {
      return { success: false, error: error.message };
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
