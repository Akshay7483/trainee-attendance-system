import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { Repository, uid, today, hours, validTime, csv, escapeHtml, hashCredential, verifyCredential, temporaryPin, recoveryCode, validateBackup } from '../assets/data.js';

let repo;
beforeEach(async () => { repo = await new Repository(`test-${uid()}`).open(); });
afterEach(() => repo.close());
function backup() {
  const stamp = new Date().toISOString();
  return { version: 1, exportedAt: stamp, admins: [{ id: 'admin', name: 'Admin', pinHash: 'a'.repeat(64), recoveryCodeHash: 'b'.repeat(64), createdAt: stamp, isFirstAdmin: true }], trainers: [{ id: 'trainer', name: 'Trainer', createdAt: stamp }], trainees: [{ id: 'trainee', name: 'Trainee', pinHash: 'c'.repeat(64), trainerId: 'trainer', mustChangePin: false, pinResetRequested: false, createdAt: stamp }], attendance: [{ id: 'record', traineeId: 'trainee', date: today(), inTime: '09:00', outTime: '17:30', inMarkedBy: 'admin', outMarkedBy: 'trainee', workingHours: 8.5, updatedAt: stamp }], appSettings: { theme: 'dark', isSetupComplete: true } };
}
test('credentials are salted, verifiable, and generated codes have the expected formats', async () => {
  const hash = await hashCredential('123456');
  expect(hash).toMatch(/^pbkdf2\$210000\$/);
  expect(await verifyCredential('123456', hash)).toBe(true);
  expect(await verifyCredential('wrong', hash)).toBe(false);
  expect(await hashCredential('123456')).not.toBe(hash);
  expect(temporaryPin()).toMatch(/^\d{6}$/);
  expect(recoveryCode()).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
});
test('validates times, computes hours, escapes HTML and spreadsheet cells', () => {
  expect(validTime('23:59')).toBe(true); expect(validTime('24:00')).toBe(false);
  expect(hours('09:00', '17:30')).toBe(8.5); expect(hours('09:00', '08:00')).toBeNull();
  expect(escapeHtml('<img onerror="x">')).toBe('&lt;img onerror=&quot;x&quot;&gt;');
  expect(csv([['Name', 'Trainer'], ['One, "Two"', '=SUM(A1)']])).toBe('Name,Trainer\r\n"One, ""Two""",\'=SUM(A1)');
});
test('backs up and restores every store without dropping historical attendance', async () => {
  const data = backup(); data.attendance.push({ ...data.attendance[0], id: 'old', traineeId: 'deleted-trainee' });
  await repo.restore(data);
  expect(validateBackup(await repo.backup())).toBe(true);
  const exported = await repo.backup();
  expect(exported).toEqual({ ...data, attendance: expect.arrayContaining(data.attendance), exportedAt: expect.any(String) });
  expect(exported.attendance).toHaveLength(data.attendance.length);
});
test.each([
  ['version', data => { data.version = 2; }],
  ['credentials', data => { data.admins[0].pinHash = 'bad'; }],
  ['missing admin', data => { data.admins = []; }],
  ['duplicate names', data => { data.trainees.push({ ...data.trainees[0], id: 'second', name: 'TRAINEE' }); }],
  ['invalid date', data => { data.attendance[0].date = '2026-02-30'; }],
  ['invalid OUT', data => { data.attendance[0].outTime = '08:00'; }],
  ['incorrect hours', data => { data.attendance[0].workingHours = 100; }],
  ['duplicate day', data => { data.attendance.push({ ...data.attendance[0], id: 'second' }); }],
])('rejects a backup with %s before changing data', async (_name, mutate) => {
  await repo.restore(backup()); const before = await repo.backup();
  const invalid = backup(); mutate(invalid);
  expect(validateBackup(invalid)).toBe(false);
  await expect(repo.restore(invalid)).rejects.toThrow('valid, supported');
  expect(await repo.backup()).toEqual({ ...before, exportedAt: expect.any(String) });
});
test('rolls back clearing and writes if storage fails during restore', async () => {
  await repo.restore(backup()); const before = await repo.backup();
  const original = IDBObjectStore.prototype.add;
  vi.spyOn(IDBObjectStore.prototype, 'add').mockImplementation(function (value, key) {
    if (this.name === 'attendance') throw new DOMException('Simulated failure', 'QuotaExceededError');
    return original.call(this, value, key);
  });
  await expect(repo.restore(backup())).rejects.toThrow('Simulated failure');
  expect(await repo.backup()).toEqual({ ...before, exportedAt: expect.any(String) });
});
test('concurrent marks cannot create duplicates or overwrite completed attendance', async () => {
  const result = await Promise.allSettled([repo.mark('trainee', today(), '09:00', 'in'), repo.mark('trainee', today(), '10:00', 'in')]);
  expect(result.filter(value => value.status === 'fulfilled')).toHaveLength(1);
  await expect(repo.mark('trainee', today(), '08:00', 'out')).rejects.toThrow('after IN');
  await repo.mark('trainee', today(), '17:00', 'out');
  await expect(repo.mark('trainee', today(), '18:00', 'out')).rejects.toThrow('already marked');
  expect(await repo.all('attendance')).toHaveLength(1);
});
test('duplicate registration and deleting an assigned trainer are rejected', async () => {
  await repo.restore(backup());
  await expect(repo.addNamed('trainees', { ...backup().trainees[0], id: 'new', name: 'TRAINEE' })).rejects.toThrow('already exists');
  await expect(repo.remove('trainers', 'trainer')).rejects.toThrow('Reassign');
  expect(await repo.all('trainers')).toHaveLength(1);
});
test('initial setup cannot replace an existing administrator', async () => {
  const admin = backup().admins[0];
  await repo.setup(admin);
  await expect(repo.setup({ ...admin, id: 'other' })).rejects.toThrow('already exists');
  expect(await repo.all('admins')).toHaveLength(1);
});
