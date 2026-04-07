/**
 * Notes Plugin - Persistent notes management with tags and search
 */
const fs = require('fs');
const path = require('path');

class NotesPlugin {
  constructor() {
    this.NAME = 'notes';
    this.VERSION = '1.0.0';
    this.DESCRIPTION = 'Create, search, and manage persistent notes';
    this.AUTHOR = 'LinguClaw';
    this.DEPENDENCIES = [];
    this.initialized = false;
    this.notesFile = path.join(process.env.HOME || '~', '.linguclaw', 'notes.json');
    this.notes = [];
  }

  async initialize(context) {
    this.context = context;
    this.load();
    this.initialized = true;
    return true;
  }

  async shutdown() {
    this.save();
    this.initialized = false;
  }

  getInfo() {
    return { name: this.NAME, version: this.VERSION, description: this.DESCRIPTION, author: this.AUTHOR, dependencies: this.DEPENDENCIES };
  }

  _defineTools() {
    return {
      addNote: (title, content, tags) => this.addNote(title, content, tags),
      searchNotes: (query) => this.searchNotes(query),
      listNotes: (tag) => this.listNotes(tag),
      deleteNote: (id) => this.deleteNote(id),
      editNote: (id, content) => this.editNote(id, content),
    };
  }

  getTools() {
    return this._defineTools();
  }

  load() {
    try {
      if (fs.existsSync(this.notesFile)) {
        this.notes = JSON.parse(fs.readFileSync(this.notesFile, 'utf-8'));
      }
    } catch { this.notes = []; }
  }

  save() {
    try {
      const dir = path.dirname(this.notesFile);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(this.notesFile, JSON.stringify(this.notes, null, 2));
    } catch (e) { /* ignore */ }
  }

  addNote(title, content, tags) {
    const note = {
      id: 'note-' + Date.now().toString(36),
      title: title || 'Untitled',
      content: content || '',
      tags: Array.isArray(tags) ? tags : (tags ? tags.split(',').map(t => t.trim()) : []),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.notes.push(note);
    this.save();
    return { success: true, note, text: `Note created: "${note.title}" (${note.id})` };
  }

  searchNotes(query) {
    if (!query) return { success: true, notes: this.notes, text: `${this.notes.length} notes total` };
    const q = query.toLowerCase();
    const results = this.notes.filter(n =>
      n.title.toLowerCase().includes(q) ||
      n.content.toLowerCase().includes(q) ||
      n.tags.some(t => t.toLowerCase().includes(q))
    );
    return {
      success: true,
      notes: results,
      text: results.length > 0
        ? results.map(n => `[${n.id}] ${n.title} (${n.tags.join(', ')})`).join('\n')
        : `No notes matching "${query}"`,
    };
  }

  listNotes(tag) {
    let filtered = this.notes;
    if (tag) {
      filtered = this.notes.filter(n => n.tags.some(t => t.toLowerCase() === tag.toLowerCase()));
    }
    return {
      success: true,
      notes: filtered,
      text: filtered.length > 0
        ? filtered.map(n => `[${n.id}] ${n.title} - ${n.content.substring(0, 50)}...`).join('\n')
        : 'No notes found',
    };
  }

  deleteNote(id) {
    const idx = this.notes.findIndex(n => n.id === id);
    if (idx === -1) return { success: false, error: `Note not found: ${id}` };
    const removed = this.notes.splice(idx, 1)[0];
    this.save();
    return { success: true, text: `Deleted note: "${removed.title}"` };
  }

  editNote(id, content) {
    const note = this.notes.find(n => n.id === id);
    if (!note) return { success: false, error: `Note not found: ${id}` };
    note.content = content;
    note.updatedAt = new Date().toISOString();
    this.save();
    return { success: true, note, text: `Updated note: "${note.title}"` };
  }
}

module.exports = NotesPlugin;
module.exports.default = NotesPlugin;
