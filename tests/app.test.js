import { screen, within, fireEvent, waitFor } from '@testing-library/dom';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { AttendanceApp } from '../assets/app.js';
import { Repository, uid, today, hashCredential, verifyCredential } from '../assets/data.js';

let app;
afterEach(() => app?.destroy());
async function mount(seed = false) {
  const repo = await new Repository(`ui-${uid()}`).open();
  if (seed) {
    await repo.setup({ id: 'admin', name: 'Admin', pinHash: await hashCredential('123456'), recoveryCodeHash: await hashCredential('RECOVERY'), isFirstAdmin: true, createdAt: new Date().toISOString() });
    sessionStorage.setItem('tams_session', JSON.stringify({ role: 'admin', userId: 'admin', name: 'Admin' }));
  }
  const root = document.createElement('div'); root.id = 'test-app'; document.body.append(root);
  app = new AttendanceApp(root, repo); await app.start(); return repo;
}
async function idle() { await waitFor(() => expect(document.getElementById('test-app')).not.toHaveAttribute('aria-busy')); }
async function readBlob(blob) { return new Promise(resolve => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.readAsText(blob); }); }

test('complete HTML workflow: setup, registration, PIN change, attendance, reports and export', async () => {
  const user = userEvent.setup(); const repo = await mount();
  await user.type(screen.getByLabelText('Admin name'), 'Admin');
  await user.type(screen.getByLabelText('PIN', { exact: true }), '123456');
  await user.type(screen.getByLabelText('Confirm PIN'), '123456');
  await user.click(screen.getByRole('button', { name: 'Create admin account' }));
  const recovery = await screen.findByRole('dialog', { name: 'Save your recovery code' });
  expect(within(recovery).getByText(/^[A-HJ-NP-Z2-9]{8}$/)).toBeInTheDocument();
  await idle(); await user.click(within(recovery).getByRole('button', { name: /complete setup/ }));
  await screen.findByRole('heading', { name: 'A clear view of your day.' }); await idle();
  await user.click(screen.getByRole('link', { name: /Trainers/ }));
  await screen.findByRole('heading', { name: 'Your trainers' });
  await user.click(screen.getByRole('button', { name: '+ Add trainer' }));
  let dialog = screen.getByRole('dialog');
  await user.type(within(dialog).getByLabelText('Trainer name'), 'Trainer, "One"');
  await user.click(within(dialog).getByRole('button', { name: 'Save trainer' }));
  await screen.findByRole('heading', { name: 'Trainer, "One"' }); await idle();
  const trainer = (await repo.all('trainers'))[0];
  await user.click(screen.getByRole('link', { name: /Trainees/ }));
  await screen.findByRole('heading', { name: 'Your trainees' });
  await user.click(screen.getByRole('button', { name: '+ Register trainee' }));
  dialog = screen.getByRole('dialog');
  await user.type(within(dialog).getByLabelText('Trainee name'), 'Trainee, "One"');
  await user.selectOptions(within(dialog).getByLabelText('Assign trainer'), trainer.id);
  await user.click(within(dialog).getByRole('button', { name: 'Register trainee' }));
  dialog = await screen.findByRole('dialog', { name: 'Trainee registered' });
  const pin = within(dialog).getByText(/^\d{6}$/).textContent;
  const trainee = (await repo.all('trainees'))[0];
  expect(await verifyCredential(pin, trainee.pinHash)).toBe(true);
  await idle(); await user.click(within(dialog).getByRole('button', { name: 'Done' }));
  await idle(); await user.click(screen.getByRole('button', { name: 'Sign out' }));
  await idle(); await user.type(screen.getByLabelText('Name'), trainee.name);
  await user.type(screen.getByLabelText('PIN'), pin);
  await user.click(screen.getByRole('button', { name: 'Sign in' }));
  await screen.findByRole('heading', { name: 'Choose your own PIN' }); await idle();
  await user.type(screen.getByLabelText('New PIN'), pin);
  await user.type(screen.getByLabelText('Confirm new PIN'), pin);
  await user.click(screen.getByRole('button', { name: 'Set new PIN' }));
  await screen.findByText('Choose a PIN different from your temporary PIN.'); await idle();
  const newPin = pin === '987654' ? '876543' : '987654';
  await user.clear(screen.getByLabelText('New PIN')); await user.type(screen.getByLabelText('New PIN'), newPin);
  await user.clear(screen.getByLabelText('Confirm new PIN')); await user.type(screen.getByLabelText('Confirm new PIN'), newPin);
  await user.click(screen.getByRole('button', { name: 'Set new PIN' }));
  await screen.findByRole('heading', { name: 'Today’s attendance' }); await idle();
  fireEvent.change(screen.getByLabelText('IN time'), { target: { value: '09:00' } });
  await user.click(screen.getByRole('button', { name: 'Mark IN' }));
  await screen.findByRole('button', { name: 'Mark OUT' }); await idle();
  fireEvent.change(screen.getByLabelText('OUT time'), { target: { value: '08:00' } });
  await user.click(screen.getByRole('button', { name: 'Mark OUT' }));
  await screen.findByText('OUT time must be after IN time.'); await idle();
  fireEvent.change(screen.getByLabelText('OUT time'), { target: { value: '17:30' } });
  await user.click(screen.getByRole('button', { name: 'Mark OUT' }));
  await screen.findByText('✓ Attendance complete for today.'); await idle();
  expect((await repo.all('attendance'))[0]).toMatchObject({ workingHours: 8.5, inMarkedBy: 'trainee', outMarkedBy: 'trainee' });
  await user.click(screen.getByRole('button', { name: 'Sign out' })); await idle();
  await user.click(screen.getByRole('button', { name: 'Admin', exact: true })); await idle();
  await user.type(screen.getByLabelText('Name'), 'Admin'); await user.type(screen.getByLabelText('PIN'), '123456');
  await user.click(screen.getByRole('button', { name: 'Sign in' }));
  await screen.findByRole('heading', { name: 'A clear view of your day.' }); await idle();
  await user.click(screen.getByRole('link', { name: /Reports/ }));
  await screen.findByRole('heading', { name: 'Your attendance reports' });
  const createUrl = vi.fn(() => 'blob:test');
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createUrl });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  await user.click(screen.getByRole('button', { name: 'Export monthly CSV' }));
  const csv = await readBlob(createUrl.mock.calls[0][0]);
  expect(csv).toContain('"Trainee, ""One""","Trainer, ""One""",1,1,0,8.50');
  expect((await repo.all('attendance'))[0].date).toBe(today());
});

test('restore validates JSON, permits cancellation, and signs out after replacement', async () => {
  const user = userEvent.setup(); const repo = await mount(true);
  await user.click(screen.getByRole('link', { name: /Settings/ }));
  await screen.findByRole('heading', { name: 'Settings & backups' });
  const input = screen.getByLabelText('Backup file');
  await user.upload(input, new File(['bad json'], 'bad.json', { type: 'application/json' }));
  await screen.findByText('This file is not valid JSON. Your data has not changed.'); await idle();
  const data = await repo.backup(); data.admins[0].name = 'Restored Admin';
  const file = new File([JSON.stringify(data)], 'backup.json', { type: 'application/json' });
  await user.upload(input, file);
  let dialog = await screen.findByRole('dialog', { name: 'Replace local data?' });
  await idle(); await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
  expect((await repo.all('admins'))[0].name).toBe('Admin'); await idle();
  await user.upload(input, file);
  dialog = await screen.findByRole('dialog', { name: 'Replace local data?' }); await idle();
  await user.click(within(dialog).getByRole('button', { name: 'Replace data and restore' }));
  await screen.findByRole('heading', { name: 'Sign in to attendance' });
  expect(sessionStorage.getItem('tams_session')).toBeNull();
  expect((await repo.all('admins'))[0].name).toBe('Restored Admin');
});

test('trainee sessions cannot enter admin pages or bypass temporary PIN changes', async () => {
  const repo = await mount(true);
  await repo.put('trainees', { id: 'trainee', name: 'Trainee', pinHash: await hashCredential('123456'), trainerId: null, mustChangePin: true, pinResetRequested: false, createdAt: new Date().toISOString() });
  app.setSession({ userId: 'trainee', role: 'trainee', name: 'Trainee' });
  location.hash = 'settings'; await app.reload(); app.render();
  expect(screen.getByRole('heading', { name: 'Choose your own PIN' })).toBeInTheDocument();
  await expect(app.action('backup')).rejects.toThrow('administrator');
  expect(screen.queryByRole('button', { name: 'Download backup' })).not.toBeInTheDocument();
});
