import { TaskScheduler, ScheduledJob } from '../src/scheduler';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('TaskScheduler', () => {
  let scheduler: TaskScheduler;
  let testDir: string;

  beforeEach(() => {
    testDir = path.join(os.tmpdir(), `linguclaw-test-${Date.now()}`);
    fs.mkdirSync(testDir, { recursive: true });
    scheduler = new TaskScheduler(testDir);
  });

  afterEach(() => {
    scheduler.stop();
    try { fs.rmSync(testDir, { recursive: true }); } catch {}
  });

  describe('addJob', () => {
    it('should create a job with an ID', () => {
      const job = scheduler.addJob({
        name: 'Test Job',
        type: 'interval',
        schedule: '5m',
        command: 'echo hello',
      });

      expect(job.id).toBeDefined();
      expect(job.name).toBe('Test Job');
      expect(job.type).toBe('interval');
      expect(job.runCount).toBe(0);
      expect(job.enabled).toBe(true);
    });

    it('should persist jobs to disk', () => {
      scheduler.addJob({ name: 'Persist Test', type: 'interval', schedule: '1h', command: 'test' });
      
      const dataPath = path.join(testDir, 'scheduler.json');
      expect(fs.existsSync(dataPath)).toBe(true);

      const data = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
      expect(data.jobs.length).toBe(1);
      expect(data.jobs[0].name).toBe('Persist Test');
    });
  });

  describe('removeJob', () => {
    it('should remove an existing job', () => {
      const job = scheduler.addJob({ name: 'To Remove', type: 'once', schedule: '2030-01-01', command: 'test' });
      expect(scheduler.getJobs().length).toBe(1);
      
      const removed = scheduler.removeJob(job.id);
      expect(removed).toBe(true);
      expect(scheduler.getJobs().length).toBe(0);
    });

    it('should return false for non-existent job', () => {
      expect(scheduler.removeJob('nonexistent')).toBe(false);
    });
  });

  describe('toggleJob', () => {
    it('should toggle job enabled state', () => {
      const job = scheduler.addJob({ name: 'Toggle', type: 'interval', schedule: '1h', command: 'test' });
      expect(job.enabled).toBe(true);

      const toggled = scheduler.toggleJob(job.id);
      expect(toggled?.enabled).toBe(false);

      const toggledBack = scheduler.toggleJob(job.id);
      expect(toggledBack?.enabled).toBe(true);
    });
  });

  describe('updateJob', () => {
    it('should update job fields', () => {
      const job = scheduler.addJob({ name: 'Original', type: 'interval', schedule: '1h', command: 'test' });
      
      const updated = scheduler.updateJob(job.id, { name: 'Updated', schedule: '2h' });
      expect(updated?.name).toBe('Updated');
      expect(updated?.schedule).toBe('2h');
    });

    it('should return null for non-existent job', () => {
      expect(scheduler.updateJob('fake', { name: 'test' })).toBeNull();
    });
  });

  describe('getStats', () => {
    it('should return correct stats', () => {
      scheduler.addJob({ name: 'Job 1', type: 'interval', schedule: '1h', command: 'test', enabled: true });
      scheduler.addJob({ name: 'Job 2', type: 'interval', schedule: '2h', command: 'test', enabled: false });

      const stats = scheduler.getStats();
      expect(stats.total).toBe(2);
      expect(stats.enabled).toBe(1);
      expect(stats.running).toBe(false);
    });
  });

  describe('parseInterval', () => {
    it('should parse various interval formats', () => {
      expect(scheduler.parseInterval('500ms')).toBe(500);
      expect(scheduler.parseInterval('30s')).toBe(30000);
      expect(scheduler.parseInterval('5m')).toBe(300000);
      expect(scheduler.parseInterval('2h')).toBe(7200000);
      expect(scheduler.parseInterval('1d')).toBe(86400000);
      expect(scheduler.parseInterval('1w')).toBe(604800000);
    });

    it('should handle decimal intervals', () => {
      expect(scheduler.parseInterval('0.5h')).toBe(1800000);
      expect(scheduler.parseInterval('1.5m')).toBe(90000);
    });

    it('should return 0 for invalid formats', () => {
      expect(scheduler.parseInterval('invalid')).toBe(0);
      expect(scheduler.parseInterval('')).toBe(0);
      expect(scheduler.parseInterval('5')).toBe(0);
    });
  });

  describe('start/stop', () => {
    it('should start and stop without error', () => {
      scheduler.addJob({ name: 'Interval', type: 'interval', schedule: '1h', command: 'test' });
      
      expect(() => scheduler.start()).not.toThrow();
      expect(scheduler.getStats().running).toBe(true);

      expect(() => scheduler.stop()).not.toThrow();
      expect(scheduler.getStats().running).toBe(false);
    });
  });

  describe('job execution', () => {
    it('should execute job and record result', (done) => {
      scheduler.setExecutor(async (job) => `Executed: ${job.name}`);
      
      const job = scheduler.addJob({
        name: 'Quick Job',
        type: 'interval',
        schedule: '100ms',
        command: 'test',
      });

      scheduler.start();

      setTimeout(() => {
        const results = scheduler.getResults(job.id);
        expect(results.length).toBeGreaterThan(0);
        expect(results[0].success).toBe(true);
        expect(results[0].output).toContain('Quick Job');
        scheduler.stop();
        done();
      }, 300);
    });

    it('should handle executor errors', (done) => {
      scheduler.setExecutor(async () => { throw new Error('Test failure'); });
      
      const job = scheduler.addJob({
        name: 'Fail Job',
        type: 'interval',
        schedule: '100ms',
        command: 'test',
      });

      scheduler.start();

      setTimeout(() => {
        const results = scheduler.getResults(job.id);
        expect(results.length).toBeGreaterThan(0);
        expect(results[0].success).toBe(false);
        expect(results[0].error).toBe('Test failure');
        scheduler.stop();
        done();
      }, 300);
    });
  });

  describe('data persistence', () => {
    it('should restore jobs after reload', () => {
      scheduler.addJob({ name: 'Persistent', type: 'interval', schedule: '1h', command: 'test' });

      // Create new scheduler with same dir
      const scheduler2 = new TaskScheduler(testDir);
      const jobs = scheduler2.getJobs();
      expect(jobs.length).toBe(1);
      expect(jobs[0].name).toBe('Persistent');
      scheduler2.stop();
    });
  });
});
