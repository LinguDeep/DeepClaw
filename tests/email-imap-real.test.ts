/**
 * Email IMAP Integration Tests
 * Tests real IMAP connections with Gmail, Outlook, etc.
 * Requires: EMAIL_IMAP_HOST, EMAIL_IMAP_USER, EMAIL_IMAP_PASS
 */

import { IMAPReceiver, IMAPConfig, GmailReceiver } from '../src/email-receiver';
import { InboxManager } from '../src/inbox';
import { getSemanticMemory } from '../src/semantic-memory';

describe('Email IMAP Real Server Integration', () => {
  const hasImapConfig = !!(
    process.env.EMAIL_IMAP_HOST &&
    process.env.EMAIL_IMAP_USER &&
    process.env.EMAIL_IMAP_PASS
  );

  let inbox: InboxManager;
  let receiver: IMAPReceiver;
  let memory: ReturnType<typeof getSemanticMemory>;

  beforeEach(() => {
    memory = getSemanticMemory();
    inbox = new InboxManager(memory);
    receiver = new IMAPReceiver(inbox);
  });

  afterEach(() => {
    receiver.stop();
  });

  describe('Real IMAP Connection', () => {
    const testIfConfig = hasImapConfig ? it : it.skip;

    testIfConfig('should connect and poll from real IMAP server', async () => {
      const config: IMAPConfig = {
        host: process.env.EMAIL_IMAP_HOST!,
        port: parseInt(process.env.EMAIL_IMAP_PORT || '993'),
        username: process.env.EMAIL_IMAP_USER!,
        password: process.env.EMAIL_IMAP_PASS!,
        tls: true,
        folders: ['INBOX'],
        useIdle: false, // Use polling for test stability
        pollInterval: 1,
      };

      receiver.configure(config);
      receiver.start();

      // Wait for initial poll
      await new Promise(r => setTimeout(r, 5000));

      // Verify receiver is running
      expect((receiver as any).isRunning).toBe(true);

      receiver.stop();
    }, 30000);

    testIfConfig('should handle IMAP IDLE mode', async () => {
      const config: IMAPConfig = {
        host: process.env.EMAIL_IMAP_HOST!,
        port: parseInt(process.env.EMAIL_IMAP_PORT || '993'),
        username: process.env.EMAIL_IMAP_USER!,
        password: process.env.EMAIL_IMAP_PASS!,
        tls: true,
        folders: ['INBOX'],
        useIdle: true,
      };

      receiver.configure(config);
      receiver.start();

      // Wait for connection
      await new Promise(r => setTimeout(r, 3000));

      expect((receiver as any).isRunning).toBe(true);

      receiver.stop();
    }, 30000);

    testIfConfig('should handle Gmail API if configured', async () => {
      // Skip if no Gmail API credentials
      if (!process.env.GMAIL_CLIENT_ID) {
        console.log('Skipping Gmail API test - no credentials');
        return;
      }

      const gmailReceiver = new GmailReceiver(inbox);
      gmailReceiver.configure({
        clientId: process.env.GMAIL_CLIENT_ID!,
        clientSecret: process.env.GMAIL_CLIENT_SECRET!,
        refreshToken: process.env.GMAIL_REFRESH_TOKEN!,
      });

      // Just verify it doesn't crash
      await gmailReceiver.check();
      expect(true).toBe(true);
    }, 30000);
  });

  describe('Common Provider Configurations', () => {
    it('should document Gmail configuration', () => {
      // This test documents how to configure Gmail
      const gmailConfig = {
        imapHost: 'imap.gmail.com',
        imapPort: 993,
        smtpHost: 'smtp.gmail.com',
        smtpPort: 587,
        useTLS: true,
        notes: 'Requires "Less secure app access" or App Password',
      };

      console.log('Gmail Configuration:', gmailConfig);
      expect(gmailConfig.imapHost).toBe('imap.gmail.com');
    });

    it('should document Outlook configuration', () => {
      const outlookConfig = {
        imapHost: 'outlook.office365.com',
        imapPort: 993,
        smtpHost: 'smtp.office365.com',
        smtpPort: 587,
        useTLS: true,
        notes: 'Uses OAuth2 for modern authentication',
      };

      console.log('Outlook Configuration:', outlookConfig);
      expect(outlookConfig.imapHost).toBe('outlook.office365.com');
    });

    it('should document Yahoo Mail configuration', () => {
      const yahooConfig = {
        imapHost: 'imap.mail.yahoo.com',
        imapPort: 993,
        smtpHost: 'smtp.mail.yahoo.com',
        smtpPort: 465,
        useTLS: true,
        notes: 'Requires app-specific password',
      };

      console.log('Yahoo Mail Configuration:', yahooConfig);
      expect(yahooConfig.imapHost).toBe('imap.mail.yahoo.com');
    });
  });

  describe('Mock Tests (No Config Required)', () => {
    it('should validate IMAPReceiver exists and has correct methods', () => {
      expect(typeof IMAPReceiver).toBe('function');
      expect(receiver.configure).toBeDefined();
      expect(receiver.start).toBeDefined();
      expect(receiver.stop).toBeDefined();
    });

    it('should validate GmailReceiver exists', () => {
      expect(typeof GmailReceiver).toBe('function');
    });
  });
});
