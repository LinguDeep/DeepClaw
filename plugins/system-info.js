/**
 * System Info Plugin - Monitor system resources, uptime, and diagnostics
 */
const os = require('os');
const fs = require('fs');

class SystemInfoPlugin {
  constructor() {
    this.NAME = 'system_info';
    this.VERSION = '1.0.0';
    this.DESCRIPTION = 'Get system information, CPU, memory, disk usage';
    this.AUTHOR = 'LinguClaw';
    this.DEPENDENCIES = [];
    this.initialized = false;
  }

  async initialize(context) {
    this.context = context;
    this.initialized = true;
    return true;
  }

  async shutdown() {
    this.initialized = false;
  }

  getInfo() {
    return { name: this.NAME, version: this.VERSION, description: this.DESCRIPTION, author: this.AUTHOR, dependencies: this.DEPENDENCIES };
  }

  _defineTools() {
    return {
      getSystemInfo: () => this.getSystemInfo(),
      getCpuUsage: () => this.getCpuUsage(),
      getMemoryUsage: () => this.getMemoryUsage(),
      getDiskUsage: () => this.getDiskUsage(),
      getProcessInfo: () => this.getProcessInfo(),
    };
  }

  getTools() {
    return this._defineTools();
  }

  getSystemInfo() {
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    const uptime = os.uptime();

    const info = {
      hostname: os.hostname(),
      platform: os.platform(),
      arch: os.arch(),
      release: os.release(),
      cpus: os.cpus().length,
      cpuModel: os.cpus()[0]?.model || 'Unknown',
      totalMemory: this.formatBytes(totalMem),
      usedMemory: this.formatBytes(usedMem),
      freeMemory: this.formatBytes(freeMem),
      memoryUsage: ((usedMem / totalMem) * 100).toFixed(1) + '%',
      uptime: this.formatUptime(uptime),
      loadAvg: os.loadavg().map(l => l.toFixed(2)),
      nodeVersion: process.version,
    };

    return {
      success: true,
      data: info,
      text: [
        `Host: ${info.hostname} (${info.platform} ${info.arch})`,
        `CPU: ${info.cpus}x ${info.cpuModel}`,
        `Memory: ${info.usedMemory} / ${info.totalMemory} (${info.memoryUsage})`,
        `Uptime: ${info.uptime}`,
        `Load: ${info.loadAvg.join(', ')}`,
        `Node.js: ${info.nodeVersion}`,
      ].join('\n'),
    };
  }

  async getCpuUsage() {
    const cpus1 = os.cpus();
    await new Promise(r => setTimeout(r, 500));
    const cpus2 = os.cpus();

    const usage = cpus2.map((cpu, i) => {
      const prev = cpus1[i];
      const prevTotal = Object.values(prev.times).reduce((a, b) => a + b, 0);
      const currTotal = Object.values(cpu.times).reduce((a, b) => a + b, 0);
      const prevIdle = prev.times.idle;
      const currIdle = cpu.times.idle;
      const totalDiff = currTotal - prevTotal;
      const idleDiff = currIdle - prevIdle;
      return totalDiff > 0 ? ((1 - idleDiff / totalDiff) * 100).toFixed(1) : '0.0';
    });

    const avg = (usage.reduce((a, b) => a + parseFloat(b), 0) / usage.length).toFixed(1);

    return {
      success: true,
      data: { cores: usage, average: avg },
      text: `CPU Usage: ${avg}% average (${usage.map((u, i) => `Core ${i}: ${u}%`).join(', ')})`,
    };
  }

  getMemoryUsage() {
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    const procMem = process.memoryUsage();

    return {
      success: true,
      data: {
        total: this.formatBytes(totalMem),
        used: this.formatBytes(usedMem),
        free: this.formatBytes(freeMem),
        percentage: ((usedMem / totalMem) * 100).toFixed(1) + '%',
        process: {
          rss: this.formatBytes(procMem.rss),
          heapUsed: this.formatBytes(procMem.heapUsed),
          heapTotal: this.formatBytes(procMem.heapTotal),
          external: this.formatBytes(procMem.external),
        },
      },
      text: `System: ${this.formatBytes(usedMem)}/${this.formatBytes(totalMem)} (${((usedMem / totalMem) * 100).toFixed(1)}%) | Process: ${this.formatBytes(procMem.rss)} RSS`,
    };
  }

  getDiskUsage() {
    try {
      const { execSync } = require('child_process');
      const output = execSync('df -h / --output=size,used,avail,pcent 2>/dev/null || df -h / 2>/dev/null', { encoding: 'utf-8' });
      const lines = output.trim().split('\n');
      return {
        success: true,
        data: { raw: output.trim() },
        text: lines.join('\n'),
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  getProcessInfo() {
    const mem = process.memoryUsage();
    return {
      success: true,
      data: {
        pid: process.pid,
        uptime: this.formatUptime(process.uptime()),
        memoryRSS: this.formatBytes(mem.rss),
        heapUsed: this.formatBytes(mem.heapUsed),
        heapTotal: this.formatBytes(mem.heapTotal),
        nodeVersion: process.version,
        platform: process.platform,
        cwd: process.cwd(),
      },
      text: `PID: ${process.pid} | Uptime: ${this.formatUptime(process.uptime())} | Memory: ${this.formatBytes(mem.rss)}`,
    };
  }

  formatBytes(bytes) {
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let i = 0;
    let val = bytes;
    while (val >= 1024 && i < units.length - 1) { val /= 1024; i++; }
    return val.toFixed(1) + ' ' + units[i];
  }

  formatUptime(seconds) {
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const parts = [];
    if (d > 0) parts.push(`${d}d`);
    if (h > 0) parts.push(`${h}h`);
    parts.push(`${m}m`);
    return parts.join(' ');
  }
}

module.exports = SystemInfoPlugin;
module.exports.default = SystemInfoPlugin;
