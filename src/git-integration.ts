/**
 * Git Integration for LinguClaw
 * Advanced Git operations with blame, diff, history, and branch management
 */

import { execSync, spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { getLogger } from './logger';

const logger = getLogger();

export interface GitCommit {
  hash: string;
  shortHash: string;
  author: string;
  email: string;
  date: Date;
  message: string;
  filesChanged: number;
  insertions: number;
  deletions: number;
}

export interface GitBranch {
  name: string;
  isCurrent: boolean;
  isRemote: boolean;
  upstream?: string;
  lastCommit?: string;
}

export interface GitFileStatus {
  path: string;
  status: 'modified' | 'added' | 'deleted' | 'renamed' | 'copied' | 'untracked' | 'ignored';
  staged: boolean;
  originalPath?: string;
}

export interface GitBlameLine {
  line: number;
  content: string;
  commit: string;
  author: string;
  date: Date;
  summary: string;
}

export interface GitDiff {
  oldFile: string;
  newFile: string;
  oldMode?: string;
  newMode?: string;
  hunks: GitDiffHunk[];
  isBinary: boolean;
}

export interface GitDiffHunk {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: GitDiffLine[];
  header: string;
}

export interface GitDiffLine {
  type: 'context' | 'added' | 'removed';
  content: string;
  oldLine?: number;
  newLine?: number;
}

export interface GitStash {
  index: number;
  message: string;
  branch: string;
  hash: string;
}

export interface GitTag {
  name: string;
  message?: string;
  tagger?: string;
  date?: Date;
  hash: string;
}

export class GitIntegration {
  private repoPath: string;
  private isGitRepo: boolean = false;

  constructor(repoPath: string) {
    this.repoPath = path.resolve(repoPath);
    this.checkIsRepo();
  }

  private checkIsRepo(): void {
    try {
      const gitDir = path.join(this.repoPath, '.git');
      this.isGitRepo = fs.existsSync(gitDir) && fs.statSync(gitDir).isDirectory();
    } catch {
      this.isGitRepo = false;
    }
  }

  isRepository(): boolean {
    return this.isGitRepo;
  }

  private execGit(args: string[]): string {
    try {
      return execSync(`git ${args.join(' ')}`, {
        cwd: this.repoPath,
        encoding: 'utf-8',
        maxBuffer: 50 * 1024 * 1024, // 50MB buffer
      }).trim();
    } catch (error: any) {
      logger.error(`Git command failed: git ${args.join(' ')} - ${error.message}`);
      throw new Error(`Git command failed: ${error.message}`);
    }
  }

  // ============================================
  // COMMIT OPERATIONS
  // ============================================

  getLog(options: {
    maxCount?: number;
    since?: Date;
    until?: Date;
    author?: string;
    grep?: string;
    file?: string;
    branch?: string;
  } = {}): GitCommit[] {
    if (!this.isGitRepo) return [];

    const format = '%H|%h|%an|%ae|%ad|%s';
    const args = ['log', `--format=${format}`, '--date=iso'];

    if (options.maxCount) args.push('-n', options.maxCount.toString());
    if (options.since) args.push(`--since=${options.since.toISOString()}`);
    if (options.until) args.push(`--until=${options.until.toISOString()}`);
    if (options.author) args.push(`--author=${options.author}`);
    if (options.grep) args.push(`--grep=${options.grep}`);
    if (options.file) args.push('--follow', '--', options.file);
    if (options.branch) args.push(options.branch);

    const output = this.execGit(args);
    if (!output) return [];

    return output.split('\n').map(line => {
      const parts = line.split('|');
      return {
        hash: parts[0],
        shortHash: parts[1],
        author: parts[2],
        email: parts[3],
        date: new Date(parts[4]),
        message: parts[5],
        filesChanged: 0,
        insertions: 0,
        deletions: 0,
      };
    });
  }

  getCommitDetails(hash: string): GitCommit | null {
    if (!this.isGitRepo) return null;

    try {
      const format = '%H|%h|%an|%ae|%ad|%s';
      const output = this.execGit(['show', hash, `--format=${format}`, '--date=iso', '--quiet', '--numstat']);
      
      const lines = output.split('\n');
      const mainInfo = lines[0].split('|');
      
      let filesChanged = 0;
      let insertions = 0;
      let deletions = 0;

      for (const line of lines.slice(1)) {
        const match = line.match(/(\d+)\s+(\d+)\s+/);
        if (match) {
          filesChanged++;
          insertions += parseInt(match[1]) || 0;
          deletions += parseInt(match[2]) || 0;
        }
      }

      return {
        hash: mainInfo[0],
        shortHash: mainInfo[1],
        author: mainInfo[2],
        email: mainInfo[3],
        date: new Date(mainInfo[4]),
        message: mainInfo[5],
        filesChanged,
        insertions,
        deletions,
      };
    } catch {
      return null;
    }
  }

  // ============================================
  // BLAME OPERATIONS
  // ============================================

  blame(filePath: string, options: {
    lineStart?: number;
    lineEnd?: number;
  } = {}): GitBlameLine[] {
    if (!this.isGitRepo) return [];

    const fullPath = path.join(this.repoPath, filePath);
    if (!fs.existsSync(fullPath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    const args = ['blame', '--line-porcelain'];
    
    if (options.lineStart && options.lineEnd) {
      args.push(`-L ${options.lineStart},${options.lineEnd}`);
    }
    
    args.push(filePath);

    const output = this.execGit(args);
    const lines = output.split('\n');
    const result: GitBlameLine[] = [];

    let currentBlame: Partial<GitBlameLine> = {};
    let currentLine = '';

    for (const line of lines) {
      if (line.match(/^[0-9a-f]{40} \d+ \d+/)) {
        // New blame entry starts
        if (currentBlame.line !== undefined) {
          result.push(currentBlame as GitBlameLine);
        }
        
        const parts = line.split(' ');
        currentBlame = {
          line: parseInt(parts[2]),
          commit: parts[0],
        };
      } else if (line.startsWith('author ')) {
        currentBlame.author = line.substring(7);
      } else if (line.startsWith('author-time ')) {
        currentBlame.date = new Date(parseInt(line.substring(12)) * 1000);
      } else if (line.startsWith('summary ')) {
        currentBlame.summary = line.substring(8);
      } else if (line.startsWith('\t')) {
        currentBlame.content = line.substring(1);
      }
    }

    // Add the last entry
    if (currentBlame.line !== undefined) {
      result.push(currentBlame as GitBlameLine);
    }

    return result;
  }

  getBlameSummary(filePath: string): { author: string; lines: number; percentage: number }[] {
    const blame = this.blame(filePath);
    const authorLines = new Map<string, number>();

    for (const line of blame) {
      const count = authorLines.get(line.author) || 0;
      authorLines.set(line.author, count + 1);
    }

    const total = blame.length;
    return Array.from(authorLines.entries())
      .map(([author, lines]) => ({
        author,
        lines,
        percentage: Math.round((lines / total) * 100),
      }))
      .sort((a, b) => b.lines - a.lines);
  }

  // ============================================
  // DIFF OPERATIONS
  // ============================================

  diff(options: {
    from?: string;
    to?: string;
    file?: string;
    staged?: boolean;
    cached?: boolean;
  } = {}): GitDiff[] {
    if (!this.isGitRepo) return [];

    const args = ['diff', '--no-ext-diff', '-p', '--diff-filter=MADCR'];

    if (options.staged || options.cached) args.push('--cached');
    if (options.from && options.to) {
      args.push(`${options.from}..${options.to}`);
    } else if (options.from) {
      args.push(options.from);
    }
    if (options.file) args.push('--', options.file);

    const output = this.execGit(args);
    return this.parseDiffOutput(output);
  }

  private parseDiffOutput(output: string): GitDiff[] {
    const diffs: GitDiff[] = [];
    const files = output.split('diff --git');

    for (const file of files.slice(1)) {
      const diff: GitDiff = {
        oldFile: '',
        newFile: '',
        hunks: [],
        isBinary: false,
      };

      const lines = file.split('\n');
      
      for (const line of lines) {
        if (line.startsWith('--- ')) {
          diff.oldFile = line.substring(4).replace(/^a\//, '');
        } else if (line.startsWith('+++ ')) {
          diff.newFile = line.substring(4).replace(/^b\//, '');
        } else if (line.includes('Binary files')) {
          diff.isBinary = true;
        } else if (line.startsWith('@@')) {
          // New hunk
          const match = line.match(/@@ -(\d+),?(\d*) \+(\d+),?(\d*) @@/);
          if (match) {
            diff.hunks.push({
              oldStart: parseInt(match[1]),
              oldCount: parseInt(match[2]) || 1,
              newStart: parseInt(match[3]),
              newCount: parseInt(match[4]) || 1,
              lines: [],
              header: line,
            });
          }
        } else if (diff.hunks.length > 0 && line.length > 0) {
          const hunk = diff.hunks[diff.hunks.length - 1];
          const type = line[0] === '+' ? 'added' : line[0] === '-' ? 'removed' : 'context';
          
          hunk.lines.push({
            type,
            content: line.substring(1),
            oldLine: type !== 'added' ? hunk.oldStart + hunk.lines.filter(l => l.type !== 'added').length - 1 : undefined,
            newLine: type !== 'removed' ? hunk.newStart + hunk.lines.filter(l => l.type !== 'removed').length - 1 : undefined,
          });
        }
      }

      diffs.push(diff);
    }

    return diffs;
  }

  getFileDiff(filePath: string, fromCommit: string, toCommit?: string): GitDiff | null {
    const diffs = this.diff({
      from: fromCommit,
      to: toCommit,
      file: filePath,
    });
    return diffs[0] || null;
  }

  // ============================================
  // BRANCH OPERATIONS
  // ============================================

  getBranches(options: {
    remote?: boolean;
    all?: boolean;
  } = {}): GitBranch[] {
    if (!this.isGitRepo) return [];

    const args = ['branch', '-v'];
    if (options.remote) args.push('-r');
    if (options.all) args.push('-a');

    const output = this.execGit(args);
    const branches: GitBranch[] = [];

    for (const line of output.split('\n')) {
      if (!line.trim()) continue;

      const isCurrent = line.startsWith('*');
      const cleanLine = line.replace(/^\*\s*/, '').trim();
      
      const match = cleanLine.match(/^(\S+)\s+(\S+)\s+\[(.+?)\]\s+(.+)/);
      if (match) {
        branches.push({
          name: match[1],
          isCurrent,
          isRemote: match[1].startsWith('remotes/'),
          upstream: match[3],
          lastCommit: match[4],
        });
      } else {
        const parts = cleanLine.split(/\s+/);
        branches.push({
          name: parts[0],
          isCurrent,
          isRemote: parts[0].startsWith('remotes/'),
          lastCommit: parts[1] || undefined,
        });
      }
    }

    return branches;
  }

  createBranch(name: string, from?: string): boolean {
    if (!this.isGitRepo) return false;

    try {
      const args = ['checkout', '-b', name];
      if (from) args.push(from);
      this.execGit(args);
      return true;
    } catch {
      return false;
    }
  }

  checkoutBranch(name: string): boolean {
    if (!this.isGitRepo) return false;

    try {
      this.execGit(['checkout', name]);
      return true;
    } catch {
      return false;
    }
  }

  deleteBranch(name: string, force: boolean = false): boolean {
    if (!this.isGitRepo) return false;

    try {
      const args = ['branch', force ? '-D' : '-d', name];
      this.execGit(args);
      return true;
    } catch {
      return false;
    }
  }

  mergeBranch(source: string, target?: string, options: {
    noFastForward?: boolean;
    squash?: boolean;
  } = {}): boolean {
    if (!this.isGitRepo) return false;

    try {
      // Checkout target if specified
      if (target) {
        this.checkoutBranch(target);
      }

      const args = ['merge'];
      if (options.noFastForward) args.push('--no-ff');
      if (options.squash) args.push('--squash');
      args.push(source);

      this.execGit(args);
      return true;
    } catch {
      return false;
    }
  }

  rebaseBranch(upstream: string, branch?: string): boolean {
    if (!this.isGitRepo) return false;

    try {
      if (branch) {
        this.checkoutBranch(branch);
      }

      this.execGit(['rebase', upstream]);
      return true;
    } catch {
      return false;
    }
  }

  // ============================================
  // STATUS OPERATIONS
  // ============================================

  getStatus(): GitFileStatus[] {
    if (!this.isGitRepo) return [];

    const output = this.execGit(['status', '--porcelain', '-u']);
    if (!output) return [];

    return output.split('\n').map(line => {
      const staged = line[0] !== ' ' && line[0] !== '?';
      const unstaged = line[1] !== ' ';
      
      const statusMap: Record<string, GitFileStatus['status']> = {
        'M': 'modified',
        'A': 'added',
        'D': 'deleted',
        'R': 'renamed',
        'C': 'copied',
        '?': 'untracked',
        '!': 'ignored',
      };

      const code = staged ? line[0] : line[1];
      let filePath = line.substring(3).trim();
      
      // Handle renamed files (R100 old -> new)
      let originalPath: string | undefined;
      if (code === 'R' && filePath.includes(' -> ')) {
        const parts = filePath.split(' -> ');
        originalPath = parts[0];
        filePath = parts[1];
      }

      return {
        path: filePath,
        status: statusMap[code] || 'modified',
        staged,
        originalPath,
      };
    });
  }

  getUntrackedFiles(): string[] {
    return this.getStatus()
      .filter(s => s.status === 'untracked')
      .map(s => s.path);
  }

  getModifiedFiles(): string[] {
    return this.getStatus()
      .filter(s => s.status === 'modified' || s.status === 'added')
      .map(s => s.path);
  }

  // ============================================
  // STASH OPERATIONS
  // ============================================

  getStashes(): GitStash[] {
    if (!this.isGitRepo) return [];

    const output = this.execGit(['stash', 'list', '--format=%H|%gd|%gs']);
    if (!output) return [];

    return output.split('\n').map((line, index) => {
      const parts = line.split('|');
      return {
        index,
        message: parts[2] || parts[1],
        branch: '',
        hash: parts[0],
      };
    });
  }

  stash(message?: string, options: {
    includeUntracked?: boolean;
    keepIndex?: boolean;
  } = {}): boolean {
    if (!this.isGitRepo) return false;

    try {
      const args = ['stash', 'push'];
      
      if (message) args.push('-m', message);
      if (options.includeUntracked) args.push('-u');
      if (options.keepIndex) args.push('--keep-index');

      this.execGit(args);
      return true;
    } catch {
      return false;
    }
  }

  stashPop(index: number = 0): boolean {
    if (!this.isGitRepo) return false;

    try {
      this.execGit(['stash', 'pop', `stash@{${index}}`]);
      return true;
    } catch {
      return false;
    }
  }

  stashApply(index: number = 0): boolean {
    if (!this.isGitRepo) return false;

    try {
      this.execGit(['stash', 'apply', `stash@{${index}}`]);
      return true;
    } catch {
      return false;
    }
  }

  stashDrop(index: number = 0): boolean {
    if (!this.isGitRepo) return false;

    try {
      this.execGit(['stash', 'drop', `stash@{${index}}`]);
      return true;
    } catch {
      return false;
    }
  }

  // ============================================
  // TAG OPERATIONS
  // ============================================

  getTags(): GitTag[] {
    if (!this.isGitRepo) return [];

    const output = this.execGit(['tag', '-l', '-n1']);
    if (!output) return [];

    return output.split('\n').map(line => {
      const parts = line.trim().split(/\s+/);
      return {
        name: parts[0],
        message: parts.slice(1).join(' ') || undefined,
        hash: '',
      };
    });
  }

  createTag(name: string, message?: string, commit?: string): boolean {
    if (!this.isGitRepo) return false;

    try {
      const args = ['tag'];
      if (message) args.push('-a', '-m', message);
      args.push(name);
      if (commit) args.push(commit);

      this.execGit(args);
      return true;
    } catch {
      return false;
    }
  }

  deleteTag(name: string): boolean {
    if (!this.isGitRepo) return false;

    try {
      this.execGit(['tag', '-d', name]);
      return true;
    } catch {
      return false;
    }
  }

  pushTag(name: string, remote: string = 'origin'): boolean {
    if (!this.isGitRepo) return false;

    try {
      this.execGit(['push', remote, name]);
      return true;
    } catch {
      return false;
    }
  }

  // ============================================
  // REMOTE OPERATIONS
  // ============================================

  getRemotes(): { name: string; url: string; fetch: string }[] {
    if (!this.isGitRepo) return [];

    try {
      const output = this.execGit(['remote', '-v']);
      const remotes: { name: string; url: string; fetch: string }[] = [];
      
      for (const line of output.split('\n')) {
        const match = line.match(/^(\S+)\s+(\S+)\s+\((\w+)\)/);
        if (match) {
          remotes.push({
            name: match[1],
            url: match[2],
            fetch: match[3],
          });
        }
      }

      return remotes;
    } catch {
      return [];
    }
  }

  fetch(remote?: string, branch?: string): boolean {
    if (!this.isGitRepo) return false;

    try {
      const args = ['fetch'];
      if (remote) args.push(remote);
      if (branch) args.push(branch);

      this.execGit(args);
      return true;
    } catch {
      return false;
    }
  }

  pull(remote?: string, branch?: string, options: {
    rebase?: boolean;
  } = {}): boolean {
    if (!this.isGitRepo) return false;

    try {
      const args = ['pull'];
      if (options.rebase) args.push('--rebase');
      if (remote) args.push(remote);
      if (branch) args.push(branch);

      this.execGit(args);
      return true;
    } catch {
      return false;
    }
  }

  push(remote?: string, branch?: string, options: {
    force?: boolean;
    setUpstream?: boolean;
  } = {}): boolean {
    if (!this.isGitRepo) return false;

    try {
      const args = ['push'];
      if (options.force) args.push('--force-with-lease');
      if (options.setUpstream) args.push('-u');
      if (remote) args.push(remote);
      if (branch) args.push(branch);

      this.execGit(args);
      return true;
    } catch {
      return false;
    }
  }

  // ============================================
  // ADVANCED ANALYSIS
  // ============================================

  getContributors(): { name: string; email: string; commits: number; linesAdded: number; linesDeleted: number }[] {
    if (!this.isGitRepo) return [];

    try {
      const output = this.execGit(['shortlog', '-sne', '--all']);
      const contributors: { name: string; email: string; commits: number; linesAdded: number; linesDeleted: number }[] = [];

      for (const line of output.split('\n')) {
        const match = line.match(/^\s*(\d+)\s+(.+?)\s+<(.+?)>$/);
        if (match) {
          contributors.push({
            name: match[2],
            email: match[3],
            commits: parseInt(match[1]),
            linesAdded: 0,
            linesDeleted: 0,
          });
        }
      }

      return contributors;
    } catch {
      return [];
    }
  }

  getCodeChurn(filePath?: string, since?: Date): { date: string; insertions: number; deletions: number }[] {
    if (!this.isGitRepo) return [];

    const args = ['log', '--format=%ad', '--date=short', '--numstat'];
    
    if (since) args.push(`--since=${since.toISOString()}`);
    if (filePath) args.push('--follow', '--', filePath);

    const output = this.execGit(args);
    const churn: Map<string, { insertions: number; deletions: number }> = new Map();

    let currentDate = '';

    for (const line of output.split('\n')) {
      if (line.match(/^\d{4}-\d{2}-\d{2}$/)) {
        currentDate = line;
      } else {
        const match = line.match(/(\d+)\s+(\d+)\s+/);
        if (match && currentDate) {
          const existing = churn.get(currentDate) || { insertions: 0, deletions: 0 };
          existing.insertions += parseInt(match[1]) || 0;
          existing.deletions += parseInt(match[2]) || 0;
          churn.set(currentDate, existing);
        }
      }
    }

    return Array.from(churn.entries())
      .map(([date, stats]) => ({ date, ...stats }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  getFileHistory(filePath: string): GitCommit[] {
    return this.getLog({ file: filePath, maxCount: 50 });
  }

  findBugs(filePath: string): GitBlameLine[] {
    const blame = this.blame(filePath);
    
    // Find lines that might contain bugs based on keywords
    const bugKeywords = ['TODO', 'FIXME', 'HACK', 'BUG', 'XXX', 'temporary', 'workaround'];
    
    return blame.filter(line => 
      bugKeywords.some(keyword => 
        line.content.toLowerCase().includes(keyword.toLowerCase())
      )
    );
  }

  getRepositoryStats(): {
    totalCommits: number;
    totalFiles: number;
    branches: number;
    tags: number;
    contributors: number;
    linesOfCode: number;
  } {
    if (!this.isGitRepo) {
      return {
        totalCommits: 0,
        totalFiles: 0,
        branches: 0,
        tags: 0,
        contributors: 0,
        linesOfCode: 0,
      };
    }

    try {
      const totalCommits = parseInt(this.execGit(['rev-list', '--count', 'HEAD'])) || 0;
      const totalFiles = this.execGit(['ls-files']).split('\n').length;
      const branches = this.getBranches({ all: true }).length;
      const tags = this.getTags().length;
      const contributors = this.getContributors().length;
      
      // Count lines of code (simplified)
      let linesOfCode = 0;
      try {
        const files = this.execGit(['ls-files']).split('\n');
        for (const file of files.slice(0, 100)) { // Sample first 100 files
          if (file.match(/\.(ts|js|py|java|go|rs|cpp|c|cs|tsx|jsx|php|rb|swift|kt)$/)) {
            linesOfCode += 100; // Rough estimate
          }
        }
        linesOfCode = Math.round(linesOfCode * (totalFiles / Math.min(totalFiles, 100)));
      } catch {
        linesOfCode = totalFiles * 50; // Fallback estimate
      }

      return {
        totalCommits,
        totalFiles,
        branches,
        tags,
        contributors,
        linesOfCode,
      };
    } catch {
      return {
        totalCommits: 0,
        totalFiles: 0,
        branches: 0,
        tags: 0,
        contributors: 0,
        linesOfCode: 0,
      };
    }
  }

  // ============================================
  // WORKTREE OPERATIONS
  // ============================================

  getWorktrees(): { path: string; branch: string; commit: string; isMain: boolean; isLocked: boolean }[] {
    if (!this.isGitRepo) return [];

    try {
      const output = this.execGit(['worktree', 'list', '--porcelain']);
      const worktrees: { path: string; branch: string; commit: string; isMain: boolean; isLocked: boolean }[] = [];
      
      let current: Partial<{ path: string; branch: string; commit: string; isMain: boolean; isLocked: boolean }> = {};

      for (const line of output.split('\n')) {
        if (line.startsWith('worktree ')) {
          if (current.path) worktrees.push(current as any);
          current = { path: line.substring(9), isMain: false, isLocked: false };
        } else if (line.startsWith('HEAD ')) {
          current.commit = line.substring(5);
        } else if (line.startsWith('branch ')) {
          current.branch = line.substring(7).replace('refs/heads/', '');
        } else if (line === 'bare') {
          current.isMain = true;
        } else if (line === 'locked') {
          current.isLocked = true;
        }
      }

      if (current.path) worktrees.push(current as any);
      return worktrees;
    } catch {
      return [];
    }
  }

  createWorktree(path: string, branch?: string): boolean {
    if (!this.isGitRepo) return false;

    try {
      const args = ['worktree', 'add'];
      if (branch) args.push('-b', branch);
      args.push(path);

      this.execGit(args);
      return true;
    } catch {
      return false;
    }
  }

  removeWorktree(path: string, force: boolean = false): boolean {
    if (!this.isGitRepo) return false;

    try {
      const args = ['worktree', 'remove'];
      if (force) args.push('--force');
      args.push(path);

      this.execGit(args);
      return true;
    } catch {
      return false;
    }
  }
}

export default GitIntegration;
