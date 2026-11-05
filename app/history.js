/* Undo, redo and saving-as-you-go for a record being edited (used by the plan builder).
   commit() keeps up to 200 earlier versions; typing in one field merges into one step (coalesce). */
export class History {
  constructor(value, { onChange, save, max = 200, delay = 500 }) {
    this.value = value; this.past = []; this.future = []; this.max = max; this.delay = delay;
    this.onChange = onChange; this.saveFn = save; this.status = 'Saved'; this.timer = 0; this.saving = Promise.resolve();
    this.key = null; this.at = 0;
  }
  commit(next, { coalesce = null, quiet = false } = {}) {
    if (next === this.value) return;
    const now = Date.now();
    if (!(coalesce && coalesce === this.key && now - this.at < 1500)) {
      this.past.push(JSON.stringify(this.value)); if (this.past.length > this.max) this.past.shift(); this.future = [];
    }
    this.key = coalesce; this.at = now; this.value = next;
    this.changed(quiet);
  }
  undo() { if (!this.past.length) return; this.future.push(JSON.stringify(this.value)); this.value = JSON.parse(this.past.pop()); this.key = null; this.changed(false); }
  redo() { if (!this.future.length) return; this.past.push(JSON.stringify(this.value)); this.value = JSON.parse(this.future.pop()); this.key = null; this.changed(false); }
  changed(quiet) {
    this.status = 'Saving…';
    this.onChange(this.value, { quiet });
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.save(), this.delay);
  }
  save() {
    clearTimeout(this.timer); this.timer = 0;
    const snap = this.value;
    this.saving = this.saving.then(async () => {
      try { await this.saveFn(snap); if (this.value === snap) this.status = 'Saved'; }
      catch (e) { this.status = 'Not saved'; this.error = e; }
      this.onChange(this.value, { quiet: true, statusOnly: true });
    });
    return this.saving;
  }
  flush() { return this.timer ? this.save() : this.saving; }
}
