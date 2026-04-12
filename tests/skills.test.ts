import { EmailSkill, CalendarSkill, FileSkill, WebSearchSkill, SystemSkill, NoteSkill, SkillManager } from '../src/skills';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('SkillManager', () => {
  let manager: SkillManager;

  beforeEach(() => {
    manager = new SkillManager(path.join(os.tmpdir(), `linguclaw-skills-${Date.now()}`));
  });

  it('should register and list skills', () => {
    manager.loadBuiltinSkills();
    const skills = manager.listSkills();
    expect(skills.length).toBeGreaterThanOrEqual(6);
    expect(skills.map(s => s.name)).toContain('email');
    expect(skills.map(s => s.name)).toContain('web_search');
    expect(skills.map(s => s.name)).toContain('system');
    expect(skills.map(s => s.name)).toContain('notes');
  });

  it('should get a skill by name', () => {
    manager.loadBuiltinSkills();
    const skill = manager.get('email');
    expect(skill).toBeDefined();
    expect(skill?.NAME).toBe('email');
  });

  it('should return error for non-existent skill', async () => {
    const result = await manager.execute('nonexistent', {});
    expect(result.success).toBe(false);
    expect(result.error).toContain('not found');
  });

  it('should unregister a skill', () => {
    manager.loadBuiltinSkills();
    manager.unregister('email');
    expect(manager.get('email')).toBeUndefined();
  });
});

describe('SystemSkill', () => {
  let skill: SystemSkill;

  beforeEach(() => {
    skill = new SystemSkill();
  });

  it('should return system info', async () => {
    const result = await skill.execute({ action: 'info' });
    expect(result.success).toBe(true);
    expect(result.output).toContain('Hostname');
    expect(result.output).toContain('Platform');
    expect(result.output).toContain('CPUs');
  });

  it('should return current time', async () => {
    const result = await skill.execute({ action: 'time' });
    expect(result.success).toBe(true);
    expect(result.output).toBeDefined();
  });

  it('should return uptime', async () => {
    const result = await skill.execute({ action: 'uptime' });
    expect(result.success).toBe(true);
    expect(result.output).toContain('uptime');
  });

  it('should return disk usage', async () => {
    const result = await skill.execute({ action: 'disk' });
    expect(result.success).toBe(true);
  });

  it('should execute safe commands', async () => {
    const result = await skill.execute({ action: 'exec', command: 'echo hello' });
    expect(result.success).toBe(true);
    expect(result.output).toBe('hello');
  });

  it('should block dangerous commands', async () => {
    const result = await skill.execute({ action: 'exec', command: 'rm -rf /' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('Blocked');
  });

  it('should handle invalid action', async () => {
    const result = await skill.execute({ action: 'invalid' });
    expect(result.success).toBe(false);
  });
});

describe('NoteSkill', () => {
  let skill: NoteSkill;
  let notesDir: string;

  beforeEach(() => {
    notesDir = path.join(os.tmpdir(), `linguclaw-notes-${Date.now()}`);
    fs.mkdirSync(notesDir, { recursive: true });
    // Override notesPath by creating skill with config
    skill = new NoteSkill();
    // @ts-ignore - override private property for testing
    skill['notesPath'] = path.join(notesDir, 'notes.json');
  });

  afterEach(() => {
    try { fs.rmSync(notesDir, { recursive: true }); } catch {}
  });

  it('should add a note', async () => {
    const result = await skill.execute({ action: 'add', title: 'Test Note', content: 'Hello world' });
    expect(result.success).toBe(true);
    expect(result.output).toContain('Test Note');
  });

  it('should list notes', async () => {
    await skill.execute({ action: 'add', title: 'Note 1', content: 'First' });
    await skill.execute({ action: 'add', title: 'Note 2', content: 'Second' });

    const result = await skill.execute({ action: 'list' });
    expect(result.success).toBe(true);
    expect(result.output).toContain('Note 1');
    expect(result.output).toContain('Note 2');
  });

  it('should search notes', async () => {
    await skill.execute({ action: 'add', title: 'TypeScript Guide', content: 'Learn TS' });
    await skill.execute({ action: 'add', title: 'Python Guide', content: 'Learn Python' });

    const result = await skill.execute({ action: 'search', query: 'TypeScript' });
    expect(result.success).toBe(true);
    expect(result.output).toContain('TypeScript');
    expect(result.output).not.toContain('Python');
  });

  it('should require title for adding', async () => {
    const result = await skill.execute({ action: 'add' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('Title');
  });

  it('should return empty when no notes', async () => {
    const result = await skill.execute({ action: 'list' });
    expect(result.success).toBe(true);
    expect(result.output).toContain('No notes');
  });
});

describe('CalendarSkill', () => {
  let skill: CalendarSkill;

  beforeEach(() => {
    skill = new CalendarSkill();
  });

  it('should handle create action', async () => {
    const result = await skill.execute({
      action: 'create',
      title: 'Meeting',
      start: new Date().toISOString(),
      end: new Date(Date.now() + 3600000).toISOString(),
    });
    expect(result.success).toBe(true);
    expect(result.output).toContain('Meeting');
  });

  it('should handle list action', async () => {
    const result = await skill.execute({ action: 'list' });
    expect(result.success).toBe(true);
  });
});

describe('FileSkill', () => {
  let skill: FileSkill;
  let testDir: string;

  beforeEach(() => {
    testDir = path.join(os.tmpdir(), `linguclaw-files-${Date.now()}`);
    fs.mkdirSync(testDir, { recursive: true });
    skill = new FileSkill();
  });

  afterEach(() => {
    try { fs.rmSync(testDir, { recursive: true }); } catch {}
  });

  it('should search files', async () => {
    fs.writeFileSync(path.join(testDir, 'test.txt'), 'hello');
    fs.writeFileSync(path.join(testDir, 'data.json'), '{}');

    const result = await skill.execute({ action: 'search', root: testDir, pattern: '*.txt' });
    expect(result.success).toBe(true);
    expect(result.output).toContain('1 files');
  });

  it('should handle non-existent source for organize', async () => {
    const result = await skill.execute({ action: 'organize', source: '/nonexistent/path' });
    expect(result.success).toBe(false);
  });

  it('should handle invalid action', async () => {
    const result = await skill.execute({ action: 'invalid' });
    expect(result.success).toBe(false);
  });
});

describe('EmailSkill', () => {
  let skill: EmailSkill;

  beforeEach(() => {
    skill = new EmailSkill();
  });

  it('should fail without credentials', async () => {
    const result = await skill.execute({ action: 'send', to: 'test@example.com', subject: 'Test' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('credentials');
  });

  it('should handle read action', async () => {
    const result = await skill.execute({ action: 'read' });
    expect(result.success).toBe(true);
  });
});
