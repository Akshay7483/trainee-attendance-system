const STORES = ['admins', 'trainers', 'trainees', 'attendance', 'settings'];
export const uid = () => crypto.randomUUID();
export const today = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
export const validPin = value => /^\d{4,6}$/.test(value);
export const validTime = value => /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
export const hours = (start, end) => start && end && validTime(start) && validTime(end) && end > start ? Math.round(((Number(end.slice(0, 2)) * 60 + Number(end.slice(3))) - (Number(start.slice(0, 2)) * 60 + Number(start.slice(3)))) / 60 * 100) / 100 : null;
export const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
export const csvCell = value => {
  let text = String(value ?? '');
  if (/^[=+@\-\t\r]/.test(text)) text = `'${text}`;
  return /[,"\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};
export const csv = rows => rows.map(row => row.map(csvCell).join(',')).join('\r\n');

function hex(bytes) { return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join(''); }
async function sha(value) { return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))); }
async function stretch(value, salt) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', encoder.encode(await sha(value)), 'PBKDF2', false, ['deriveBits']);
  return hex(new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', iterations: 210000, salt: encoder.encode(salt) }, key, 256)));
}
export async function hashCredential(value) {
  const salt = hex(crypto.getRandomValues(new Uint8Array(16)));
  return `pbkdf2$210000$${salt}$${await stretch(value, salt)}`;
}
export async function verifyCredential(value, stored) {
  if (/^[a-f0-9]{64}$/i.test(stored)) return (await sha(value)) === stored.toLowerCase();
  if (!/^pbkdf2\$210000\$[a-f0-9]{32}\$[a-f0-9]{64}$/.test(stored)) return false;
  const [, , salt, expected] = stored.split('$');
  return (await stretch(value, salt)) === expected;
}
export function temporaryPin() {
  const random = new Uint32Array(1);
  do { crypto.getRandomValues(random); } while (random[0] >= Math.floor(2 ** 32 / 900000) * 900000);
  return String(100000 + random[0] % 900000);
}
export function recoveryCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from(crypto.getRandomValues(new Uint8Array(8)), value => alphabet[value % alphabet.length]).join('');
}

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = value => typeof value === 'string' && !!value.trim();
const timestamp = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value));
const credential = value => typeof value === 'string' && (/^[a-f0-9]{64}$/i.test(value) || /^pbkdf2\$210000\$[a-f0-9]{32}\$[a-f0-9]{64}$/.test(value));
const named = value => object(value) && text(value.id) && text(value.name) && timestamp(value.createdAt);
const unique = (records, names = false) => new Set(records.map(record => record.id)).size === records.length && (!names || new Set(records.map(record => record.name.trim().toLowerCase())).size === records.length);
export function validateBackup(data) {
  if (!object(data) || data.version !== 1 || !timestamp(data.exportedAt)) return false;
  if (!object(data.appSettings) || data.appSettings.isSetupComplete !== true || !['light', 'dark', 'system'].includes(data.appSettings.theme)) return false;
  if (!Array.isArray(data.admins) || !data.admins.length || !data.admins.every(value => named(value) && credential(value.pinHash) && credential(value.recoveryCodeHash) && typeof value.isFirstAdmin === 'boolean')) return false;
  if (!Array.isArray(data.trainers) || !data.trainers.every(named)) return false;
  if (!Array.isArray(data.trainees) || !data.trainees.every(value => named(value) && credential(value.pinHash) && (value.trainerId === null || text(value.trainerId)) && typeof value.mustChangePin === 'boolean' && typeof value.pinResetRequested === 'boolean')) return false;
  if (!Array.isArray(data.attendance) || !data.attendance.every(value => {
    if (!object(value) || !text(value.id) || !text(value.traineeId) || !timestamp(value.updatedAt) || typeof value.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value.date)) return false;
    const date = new Date(`${value.date}T00:00:00Z`);
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value.date) return false;
    if (![value.inTime, value.outTime].every(time => time === null || (typeof time === 'string' && validTime(time)))) return false;
    if (value.outTime && (!value.inTime || value.outTime <= value.inTime)) return false;
    if (value.inTime ? !['admin', 'trainee'].includes(value.inMarkedBy) : value.inMarkedBy !== null) return false;
    if (value.outTime ? !['admin', 'trainee'].includes(value.outMarkedBy) : value.outMarkedBy !== null) return false;
    return value.workingHours === hours(value.inTime, value.outTime);
  })) return false;
  if (!unique(data.admins, true) || !unique(data.trainers, true) || !unique(data.trainees, true) || !unique(data.attendance)) return false;
  return new Set(data.attendance.map(value => JSON.stringify([value.traineeId, value.date]))).size === data.attendance.length;
}

const request = value => new Promise((resolve, reject) => { value.onsuccess = () => resolve(value.result); value.onerror = () => reject(value.error); });
const complete = transaction => new Promise((resolve, reject) => { transaction.oncomplete = resolve; transaction.onerror = transaction.onabort = () => reject(transaction.error ?? new Error('Storage operation was cancelled.')); });

export class Repository {
  constructor(name = 'TraineeAttendanceDB') { this.name = name; }
  async open() {
    if (this.db) return this;
    const opening = indexedDB.open(this.name, 1);
    opening.onupgradeneeded = () => {
      const db = opening.result;
      for (const name of STORES) if (!db.objectStoreNames.contains(name)) {
        const store = db.createObjectStore(name, { keyPath: name === 'settings' ? 'key' : 'id' });
        if (name === 'attendance') { store.createIndex('traineeDate', ['traineeId', 'date'], { unique: true }); store.createIndex('date', 'date'); store.createIndex('traineeId', 'traineeId'); }
        if (name === 'trainees') { store.createIndex('name', 'name'); store.createIndex('trainerId', 'trainerId'); }
      }
    };
    this.db = await request(opening);
    this.db.onversionchange = () => this.db.close();
    return this;
  }
  async all(store) { return request(this.db.transaction(store).objectStore(store).getAll()); }
  async get(store, id) { return request(this.db.transaction(store).objectStore(store).get(id)); }
  async put(store, value) {
    const transaction = this.db.transaction(store, 'readwrite');
    const done = complete(transaction);
    transaction.objectStore(store).put(value);
    await done;
  }
  async settings() { return (await this.get('settings', 'appSettings'))?.value ?? { theme: 'light', isSetupComplete: false }; }
  async saveSettings(settings) { await this.put('settings', { key: 'appSettings', value: settings }); }
  async setup(admin) {
    const transaction = this.db.transaction(['admins', 'settings'], 'readwrite');
    const done = complete(transaction);
    let error;
    const query = transaction.objectStore('admins').getAll();
    query.onsuccess = () => {
      if (query.result.length) { error = new Error('An administrator already exists. Reload to sign in.'); transaction.abort(); return; }
      transaction.objectStore('admins').add(admin);
      transaction.objectStore('settings').put({ key: 'appSettings', value: { theme: 'light', isSetupComplete: true } });
    };
    try { await done; } catch (failure) { throw error ?? failure; }
  }
  async backup() {
    const transaction = this.db.transaction(STORES);
    const done = complete(transaction);
    const [admins, trainers, trainees, attendance, settings] = await Promise.all(STORES.map(name => request(transaction.objectStore(name).getAll())));
    await done;
    return { version: 1, exportedAt: new Date().toISOString(), admins, trainers, trainees, attendance, appSettings: settings.find(value => value.key === 'appSettings')?.value ?? { theme: 'light', isSetupComplete: false } };
  }
  async restore(input) {
    const data = structuredClone(input);
    if (!validateBackup(data)) throw new Error('This is not a valid, supported attendance backup.');
    const transaction = this.db.transaction(STORES, 'readwrite');
    const done = complete(transaction);
    try {
      for (const name of STORES) transaction.objectStore(name).clear();
      for (const name of STORES.slice(0, 4)) for (const record of data[name]) transaction.objectStore(name).add(record);
      transaction.objectStore('settings').add({ key: 'appSettings', value: data.appSettings });
    } catch (error) { transaction.abort(); await done.catch(() => {}); throw error; }
    await done;
  }
  async addNamed(store, record) {
    const transaction = this.db.transaction(store, 'readwrite');
    const done = complete(transaction);
    const reading = transaction.objectStore(store).getAll();
    let error;
    reading.onsuccess = () => {
      if (reading.result.some(value => value.name.trim().toLowerCase() === record.name.trim().toLowerCase() && value.id !== record.id)) { error = new Error('An account or trainer with this name already exists.'); transaction.abort(); }
      else transaction.objectStore(store).put(record);
    };
    try { await done; } catch (failure) { throw error ?? failure; }
  }
  async remove(store, id) {
    const transaction = this.db.transaction(store === 'trainers' ? ['trainers', 'trainees'] : [store], 'readwrite');
    const done = complete(transaction);
    let error;
    if (store === 'trainers') {
      const query = transaction.objectStore('trainees').getAll();
      query.onsuccess = () => {
        if (query.result.some(value => value.trainerId === id)) { error = new Error('Reassign this trainer’s trainees before deleting the trainer.'); transaction.abort(); }
        else transaction.objectStore(store).delete(id);
      };
    } else transaction.objectStore(store).delete(id);
    try { await done; } catch (failure) { throw error ?? failure; }
  }
  async mark(traineeId, date, time, kind, source = 'trainee') {
    if (!validTime(time)) throw new Error('Choose a valid time.');
    if (source === 'trainee' && date !== today()) throw new Error('You can only mark attendance for today.');
    const transaction = this.db.transaction('attendance', 'readwrite');
    const done = complete(transaction);
    const store = transaction.objectStore('attendance');
    const reading = store.index('traineeDate').get([traineeId, date]);
    let error;
    reading.onsuccess = () => {
      const value = reading.result ?? { id: uid(), traineeId, date, inTime: null, outTime: null, inMarkedBy: null, outMarkedBy: null, workingHours: null };
      try {
        if (kind === 'in') {
          if (value.inTime) throw new Error('IN time is already marked.');
          value.inTime = time; value.inMarkedBy = source;
        } else {
          if (!value.inTime) throw new Error('Mark IN before marking OUT.');
          if (value.outTime) throw new Error('OUT time is already marked.');
          if (time <= value.inTime) throw new Error('OUT time must be after IN time.');
          value.outTime = time; value.outMarkedBy = source;
        }
        value.workingHours = hours(value.inTime, value.outTime);
        value.updatedAt = new Date().toISOString();
        store.put(value);
      } catch (failure) { error = failure; transaction.abort(); }
    };
    try { await done; } catch (failure) { throw error ?? failure; }
  }
  close() { this.db?.close(); }
}
