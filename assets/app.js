import { Repository, uid, today, validPin, hours, validTime, escapeHtml as esc, csv, hashCredential, verifyCredential, temporaryPin, recoveryCode, validateBackup } from './data.js';

const SESSION = 'tams_session';
const nav = [['dashboard', 'Overview', '◈'], ['attendance', 'Attendance', '✓'], ['trainees', 'Trainees', '♙'], ['trainers', 'Trainers', '▣'], ['reports', 'Reports', '▥'], ['settings', 'Settings', '⚙']];
const field = (label, name, value = '', type = 'text', extra = '') => `<label class="field" for="${name}"><span>${label}</span><input id="${name}" name="${name}" type="${type}" value="${esc(value)}" ${extra}></label>`;
const button = (label, action, id = '', secondary = false) => `<button type="button" class="${secondary ? 'secondary' : ''}" data-action="${action}" data-id="${esc(id)}">${label}</button>`;
const select = (label, name, value, options) => `<label class="field" for="${name}"><span>${label}</span><select name="${name}" id="${name}">${options.map(([id, text]) => `<option value="${esc(id)}" ${value === id ? 'selected' : ''}>${esc(text)}</option>`).join('')}</select></label>`;
const status = value => value?.outTime ? ['Present', 'green'] : value?.inTime ? ['In only', 'amber'] : ['Not marked', 'muted'];
const badge = value => { const [label, color] = status(value); return `<span class="badge ${color}">${label}</span>`; };
const timeLabel = time => {
  if (!time) return '—';
  const [hour, minute] = time.split(':').map(Number);
  return `${hour % 12 || 12}:${String(minute).padStart(2, '0')} ${hour >= 12 ? 'PM' : 'AM'}`;
};
const hourLabel = value => value === null || value === undefined ? '—' : `${Math.floor(Math.round(value * 60) / 60)}h ${Math.round(value * 60) % 60}m`;
const empty = (title, text) => `<div class="empty"><span aria-hidden="true">◇</span><h3>${title}</h3><p>${text}</p></div>`;
function download(content, filename, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename;
  document.body.append(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export class AttendanceApp {
  constructor(root, repository = new Repository()) {
    this.root = root; this.repo = repository; this.role = 'trainee'; this.date = today(); this.month = today().slice(0, 7); this.trainerFilter = ''; this.search = ''; this.busy = false;
    root.addEventListener('submit', event => { event.preventDefault(); void this.perform(() => this.submit(event.target.dataset.form, new FormData(event.target))); });
    root.addEventListener('click', event => {
      const target = event.target.closest('[data-action]');
      if (target) void this.perform(() => this.action(target.dataset.action, target.dataset.id, target));
    });
    root.addEventListener('change', event => {
      if (event.target.name === 'filterDate') { this.date = event.target.value || today(); this.render(); }
      if (event.target.name === 'filterTrainer') { this.trainerFilter = event.target.value; this.render(); }
      if (event.target.name === 'reportMonth') { this.month = event.target.value || today().slice(0, 7); this.render(); }
      if (event.target.name === 'theme') void this.perform(() => this.setTheme(event.target.value));
      if (event.target.name === 'backupFile' && event.target.files[0]) { const file = event.target.files[0]; event.target.value = ''; void this.perform(() => this.readBackup(file)); }
    });
    this.onHash = () => { if (this.renderedHash !== location.hash) { this.closeModal(); this.render(); } };
    window.addEventListener('hashchange', this.onHash);
    this.onTheme = () => this.applyTheme();
    this.media = window.matchMedia?.('(prefers-color-scheme: dark)'); this.media?.addEventListener('change', this.onTheme);
    this.onKey = event => { if (event.key === 'Escape' && !this.busy) this.closeModal(); };
    root.addEventListener('keydown', this.onKey);
  }
  async start() {
    try {
      await this.repo.open();
      try { const saved = JSON.parse(sessionStorage.getItem(SESSION) ?? 'null'); if (saved && ['admin', 'trainee'].includes(saved.role) && typeof saved.userId === 'string') this.session = saved; } catch { this.session = null; }
      await this.reload(); this.render();
    } catch { this.root.innerHTML = '<main class="auth"><section class="card"><h1>Browser storage is unavailable</h1><p>Allow browser storage, open this site using HTTPS or localhost, and reload.</p><button data-action="reload">Try again</button></section></main>'; }
  }
  destroy() { window.removeEventListener('hashchange', this.onHash); this.media?.removeEventListener('change', this.onTheme); this.repo.close(); }
  async reload() {
    this.data = await this.repo.backup();
    if (this.session) {
      const user = this.data[this.session.role === 'admin' ? 'admins' : 'trainees'].find(value => value.id === this.session.userId);
      if (!user) this.setSession(null); else this.session.name = user.name;
    }
    this.applyTheme();
  }
  applyTheme() { document.documentElement.dataset.theme = this.data?.appSettings.theme === 'dark' || (this.data?.appSettings.theme === 'system' && this.media?.matches) ? 'dark' : 'light'; }
  async setTheme(theme) { await this.repo.saveSettings({ ...this.data.appSettings, theme }); await this.reload(); this.render(); }
  setSession(session) { this.session = session; try { if (session) sessionStorage.setItem(SESSION, JSON.stringify(session)); else sessionStorage.removeItem(SESSION); } catch { /* Continue in memory if session storage is disabled. */ } }
  get user() { return this.session ? this.data[this.session.role === 'admin' ? 'admins' : 'trainees'].find(value => value.id === this.session.userId) : null; }
  notice(message, error = false) {
    document.getElementById('toast')?.remove();
    const toast = document.createElement('div'); toast.id = 'toast'; toast.className = `toast${error ? ' error' : ''}`; toast.role = error ? 'alert' : 'status'; toast.textContent = message; this.root.append(toast);
    clearTimeout(this.toastTimer); this.toastTimer = setTimeout(() => toast.remove(), 7000);
  }
  async perform(task) {
    if (this.busy) return;
    this.busy = true; this.root.setAttribute('aria-busy', 'true');
    const buttons = [...this.root.querySelectorAll('button:not(:disabled)')]; buttons.forEach(value => { value.disabled = true; });
    try { await task(); } catch (error) { this.notice(error.message || 'Unable to complete this action.', true); }
    finally { this.busy = false; this.root.removeAttribute('aria-busy'); buttons.forEach(value => { value.disabled = false; }); }
  }
  closeModal() { this.root.querySelector('dialog')?.remove(); this.pendingBackup = null; if (this.returnFocus?.isConnected) this.returnFocus.focus(); }
  modal(title, content, keepPending = false) {
    const pending = this.pendingBackup;
    this.closeModal(); if (keepPending) this.pendingBackup = pending;
    this.returnFocus = document.activeElement;
    const dialog = document.createElement('dialog'); dialog.setAttribute('aria-modal', 'true'); dialog.setAttribute('aria-labelledby', 'modal-title');
    dialog.innerHTML = `<div class="modal-head"><h2 id="modal-title">${esc(title)}</h2><button type="button" class="icon-button secondary" data-action="close" aria-label="Close dialog">×</button></div>${content}`;
    this.root.append(dialog);
    if (typeof dialog.showModal === 'function') dialog.showModal(); else dialog.open = true;
    dialog.addEventListener('cancel', event => { event.preventDefault(); if (!this.busy) this.closeModal(); });
    dialog.querySelector('input,select,button[type="submit"],button')?.focus();
  }
  render() {
    if (!this.data) return;
    this.renderedHash = location.hash;
    if (!this.data.appSettings.isSetupComplete) { this.renderAuth(true); return; }
    if (!this.user) { this.renderAuth(false); return; }
    if (this.session.role === 'trainee' && this.user.mustChangePin) {
      this.root.innerHTML = `<main class="auth"><a class="brand" href="#"><img src="./assets/icon.svg" alt="">Trainee Attendance</a><section class="card"><span class="eyebrow">ACCOUNT SETUP</span><h1>Choose your own PIN</h1><p>Replace your temporary PIN before marking attendance.</p><form data-form="changePin">${field('New PIN', 'newPin', '', 'password', 'required pattern="[0-9]{4,6}" minlength="4" maxlength="6" inputmode="numeric" autocomplete="new-password"')}${field('Confirm new PIN', 'confirmPin', '', 'password', 'required maxlength="6" inputmode="numeric" autocomplete="new-password"')}<button type="submit">Set new PIN</button></form>${button('Sign out', 'logout', '', true)}</section></main>`;
      return;
    }
    const admin = this.session.role === 'admin';
    const route = location.hash.slice(1) || (admin ? 'dashboard' : 'my-attendance');
    const page = admin && nav.some(([id]) => id === route) ? route : admin ? 'dashboard' : 'my-attendance';
    const item = nav.find(([id]) => id === page);
    this.root.innerHTML = `<div class="shell"><aside class="sidebar"><a class="brand" href="#${admin ? 'dashboard' : 'my-attendance'}"><img src="./assets/icon.svg" alt="">Trainee<span>Attendance</span></a><div class="workspace-label">${admin ? 'ADMIN WORKSPACE' : 'TRAINEE WORKSPACE'}</div><nav aria-label="Main navigation">${admin ? nav.map(([id, label, icon]) => `<a href="#${id}" ${page === id ? 'aria-current="page"' : ''}><span aria-hidden="true">${icon}</span>${label}</a>`).join('') : '<a href="#my-attendance" aria-current="page"><span aria-hidden="true">✓</span>My attendance</a>'}</nav><div class="sidebar-note"><span class="dot"></span>Browser storage active<small>Back up your records regularly</small></div><div class="profile"><span class="avatar">${esc(this.user.name[0].toUpperCase())}</span><div><strong>${esc(this.user.name)}</strong><small>${admin ? 'Administrator' : 'Trainee'}</small></div></div></aside><div class="workspace"><header class="topbar"><span>${admin ? item?.[1] ?? 'Overview' : 'My attendance'}</span><div>${button(document.documentElement.dataset.theme === 'dark' ? 'Light mode' : 'Dark mode', 'toggleTheme', '', true)}${button('Sign out', 'logout', '', true)}</div></header><main class="content">${admin ? this.adminPage(page) : this.traineePage()}</main><footer>© ${new Date().getFullYear()} Trainee Attendance System <span>Stored on this browser · <a href="https://github.com/Akshay7483/trainee-attendance-system">View source</a></span></footer></div></div>`;
  }
  renderAuth(setup) {
    this.root.innerHTML = `<main class="auth"><a class="brand" href="#"><img src="./assets/icon.svg" alt="">Trainee Attendance</a><section class="card"><span class="eyebrow">${setup ? 'LET’S GET STARTED' : 'WELCOME BACK'}</span><h1>${setup ? 'Create your workspace' : 'Sign in to attendance'}</h1><p>${setup ? 'Set up your first administrator account.' : 'Choose your role and enter your name and PIN.'}</p>${!setup ? `<div class="role-tabs">${button('Trainee', 'role', 'trainee', this.role !== 'trainee')}${button('Admin', 'role', 'admin', this.role !== 'admin')}</div>` : ''}<form data-form="${setup ? 'setup' : 'login'}">${field(setup ? 'Admin name' : 'Name', 'name', '', 'text', 'required autocomplete="username" maxlength="100"')}${field('PIN', 'pin', '', 'password', 'required pattern="[0-9]{4,6}" minlength="4" maxlength="6" inputmode="numeric" autocomplete="current-password"')}${setup ? field('Confirm PIN', 'confirmPin', '', 'password', 'required maxlength="6" inputmode="numeric" autocomplete="new-password"') : ''}<button type="submit">${setup ? 'Create admin account' : 'Sign in'}</button></form>${!setup && this.role === 'admin' ? button('Forgot PIN? Use recovery code', 'recover', '', true) : ''}<div class="callout">This GitHub Pages edition saves records in this browser. Other devices have their own data. Download backups regularly.</div></section><p class="auth-footer">No installation. No subscription. Your attendance workspace.</p></main>`;
  }
  heading(kicker, title, description, actions = '') { return `<div class="page-heading"><div><span class="eyebrow">${kicker}</span><h1>${title}</h1><p>${description}</p></div><div class="actions">${actions}</div></div>`; }
  get filtered() { return this.data.trainees.filter(value => (!this.trainerFilter || value.trainerId === this.trainerFilter) && (!this.search || value.name.toLowerCase().includes(this.search.toLowerCase()))).sort((a, b) => a.name.localeCompare(b.name)); }
  trainerName(id) { return this.data.trainers.find(value => value.id === id)?.name ?? 'Unassigned'; }
  filters(withDate = false) { return `<div class="filters card">${withDate ? field('Attendance date', 'filterDate', this.date, 'date') : ''}${select('Trainer', 'filterTrainer', this.trainerFilter, [['', 'All trainers'], ...this.data.trainers.map(value => [value.id, value.name])])}${button('Clear filters', 'clearFilters', '', true)}</div>`; }
  attendanceTable(trainees, date, editable = false) {
    if (!trainees.length) return empty('No trainees to display', 'Register trainees or adjust your filters to get started.');
    return `<div class="table-wrap"><table><thead><tr><th>Trainee</th><th>Trainer</th><th>IN time</th><th>OUT time</th><th>Hours</th><th>Status</th>${editable ? '<th>Action</th>' : ''}</tr></thead><tbody>${trainees.map(value => { const attendance = this.data.attendance.find(record => record.traineeId === value.id && record.date === date); return `<tr><td><strong>${esc(value.name)}</strong></td><td>${esc(this.trainerName(value.trainerId))}</td><td>${timeLabel(attendance?.inTime)}</td><td>${timeLabel(attendance?.outTime)}</td><td>${hourLabel(attendance?.workingHours)}</td><td>${badge(attendance)}</td>${editable ? `<td>${button('Edit', 'editAttendance', value.id, true)}</td>` : ''}</tr>`; }).join('')}</tbody></table></div>`;
  }
  adminPage(page) {
    if (page === 'dashboard') {
      const marked = this.data.attendance.filter(value => value.date === this.date && value.inTime);
      const stats = [['Registered trainees', this.data.trainees.length, 'All trainees in your workspace'], ['Marked IN', marked.length, 'Attendance started'], ['Marked OUT', marked.filter(value => value.outTime).length, 'Attendance completed'], ['Not marked', this.data.trainees.length - marked.filter(value => this.data.trainees.some(trainee => trainee.id === value.traineeId)).length, 'Waiting for check-in']];
      return this.heading('WORKSPACE OVERVIEW', 'A clear view of your day.', 'Track your trainees, attendance, and working hours in one place.', '<a class="button" href="#attendance">Manage attendance ↗</a>') + `<div class="stats">${stats.map(([label, number, note]) => `<article class="card stat"><span>${label}</span><strong>${number}</strong><small>${note}</small></article>`).join('')}</div>${this.filters(true)}<section class="card"><div class="section-heading"><div><h2>Attendance overview</h2><p>${esc(this.date)} · ${this.filtered.length} trainees</p></div><a href="#reports">View reports →</a></div>${this.attendanceTable(this.filtered, this.date)}</section>`;
    }
    if (page === 'trainers') return this.heading('PEOPLE', 'Your trainers', 'Organize trainees by the people who guide them.', button('+ Add trainer', 'trainer')) + (this.data.trainers.length ? `<div class="trainer-grid">${this.data.trainers.map(value => `<article class="card trainer"><span class="trainer-avatar">${esc(value.name[0].toUpperCase())}</span><h2>${esc(value.name)}</h2><p>${this.data.trainees.filter(trainee => trainee.trainerId === value.id).length} trainees assigned</p><div class="actions">${button('Edit', 'trainer', value.id, true)}${button('Delete', 'deleteTrainer', value.id, true)}</div></article>`).join('')}</div>` : `<section class="card">${empty('Meet your first trainer', 'Add trainers to organize your training team.')}</section>`);
    if (page === 'trainees') return this.heading('PEOPLE', 'Your trainees', `${this.data.trainees.length} registered trainees. Manage assignments and account access.`, button('+ Register trainee', 'trainee')) + this.filters() + `<section class="card"><form class="search" data-form="search">${field('Search trainees', 'search', this.search, 'search')}<button type="submit" class="secondary">Search</button></form>${this.filtered.length ? `<div class="table-wrap"><table><thead><tr><th>Name</th><th>Trainer</th><th>Account status</th><th>Actions</th></tr></thead><tbody>${this.filtered.map(value => `<tr><td><strong>${esc(value.name)}</strong></td><td>${esc(this.trainerName(value.trainerId))}</td><td><span class="badge ${value.pinResetRequested || value.mustChangePin ? 'amber' : 'green'}">${value.pinResetRequested ? 'PIN reset requested' : value.mustChangePin ? 'Change PIN on login' : 'Active'}</span></td><td><div class="actions">${button('Edit', 'trainee', value.id, true)}${button('Reset PIN', 'resetPin', value.id, true)}${button('Delete', 'deleteTrainee', value.id, true)}</div></td></tr>`).join('')}</tbody></table></div>` : empty('No trainees found', 'Register a trainee or adjust your filters.')}</section>`;
    if (page === 'attendance') return this.heading('DAILY REGISTER', 'Attendance, made simple.', 'Review the day, correct entries, or mark a group at once.', button('Bulk mark', 'bulk')) + this.filters(true) + `<section class="card">${this.attendanceTable(this.filtered, this.date, true)}</section>`;
    if (page === 'reports') {
      const reports = this.monthly();
      return this.heading('INSIGHTS & EXPORTS', 'Your attendance reports', 'Explore daily entries and monthly totals. Export either view as CSV.') + this.filters(true) + `<section class="card"><div class="section-heading"><h2>Daily report</h2>${button('Export daily CSV', 'exportDaily', '', true)}</div>${this.attendanceTable(this.filtered, this.date)}</section><section class="card"><div class="section-heading"><h2>Monthly summary</h2>${button('Export monthly CSV', 'exportMonthly', '', true)}</div>${field('Report month', 'reportMonth', this.month, 'month')}<div class="table-wrap"><table><thead><tr><th>Trainee</th><th>Trainer</th><th>Days IN</th><th>Completed</th><th>Missing OUT</th><th>Total hours</th></tr></thead><tbody>${reports.map(value => `<tr><td>${esc(value.name)}</td><td>${esc(value.trainer)}</td><td>${value.daysIn}</td><td>${value.complete}</td><td>${value.missing}</td><td>${hourLabel(value.total)}</td></tr>`).join('')}</tbody></table></div>${!reports.length ? empty('No report data', 'Register trainees to start building attendance reports.') : ''}</section>`;
    }
    return this.heading('YOUR WORKSPACE', 'Settings & backups', 'Personalize the workspace and keep a safe copy of your records.') + `<section class="card"><h2>Appearance</h2><p>Choose the theme that works best for you.</p>${select('Theme', 'theme', this.data.appSettings.theme, [['light', 'Light'], ['dark', 'Dark'], ['system', 'Use device setting']])}</section><section class="card"><h2>Download a backup</h2><p>Save accounts, trainers, trainees, and attendance as a JSON file. Keep it private: it includes account credential hashes.</p>${button('Download backup', 'backup')}</section><section class="card"><h2>Restore a backup</h2><p>Import a version 1 backup from this app or the earlier project. Restoration replaces this browser’s records and signs you out. Download a current backup first.</p>${field('Backup file', 'backupFile', '', 'file', 'accept=".json,application/json"')}</section><div class="callout">GitHub Pages edition: records belong to this browser and website address. PIN checks here are a convenience for a trusted shared device; they are not server-side authentication.</div>`;
  }
  monthly() { return this.filtered.map(value => { const records = this.data.attendance.filter(record => record.traineeId === value.id && record.date.startsWith(this.month) && record.inTime); return { ...value, trainer: this.trainerName(value.trainerId), daysIn: records.length, complete: records.filter(record => record.outTime).length, missing: records.filter(record => !record.outTime).length, total: records.reduce((sum, record) => sum + (record.workingHours ?? 0), 0) }; }); }
  traineePage() {
    const date = today(); const record = this.data.attendance.find(value => value.traineeId === this.user.id && value.date === date);
    const history = this.data.attendance.filter(value => value.traineeId === this.user.id).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 10);
    return this.heading('MY ATTENDANCE', `Welcome, ${esc(this.user.name)}.`, `Trainer: ${esc(this.trainerName(this.user.trainerId))}`) + `<section class="card"><div class="section-heading"><div><h2>Today’s attendance</h2><p>${date}</p></div>${badge(record)}</div><div class="time-grid"><div><span>IN time</span><strong>${timeLabel(record?.inTime)}</strong></div><div><span>OUT time</span><strong>${timeLabel(record?.outTime)}</strong></div><div><span>Working hours</span><strong>${hourLabel(record?.workingHours)}</strong></div></div>${record?.outTime ? '<div class="success-panel">✓ Attendance complete for today.</div>' : `<form data-form="mark" class="mark-form"><input type="hidden" name="kind" value="${record?.inTime ? 'out' : 'in'}">${field(record?.inTime ? 'OUT time' : 'IN time', 'time', '', 'time', 'required')}<button type="submit">Mark ${record?.inTime ? 'OUT' : 'IN'}</button></form>`}</section><section class="card"><h2>Recent attendance</h2><p>Your last 10 attendance records.</p>${history.length ? `<div class="table-wrap"><table><thead><tr><th>Date</th><th>IN time</th><th>OUT time</th><th>Hours</th><th>Status</th></tr></thead><tbody>${history.map(value => `<tr><td>${esc(value.date)}</td><td>${timeLabel(value.inTime)}</td><td>${timeLabel(value.outTime)}</td><td>${hourLabel(value.workingHours)}</td><td>${badge(value)}</td></tr>`).join('')}</tbody></table></div>` : empty('Your history starts here', 'Mark IN to record your first day.')}</section><div class="reset-note">${this.user.pinResetRequested ? '<p>Your PIN reset request is pending. Contact your administrator.</p>' : button('Request a PIN reset', 'requestReset', '', true)}</div>`;
  }
  requireAdmin() { if (this.session?.role !== 'admin' || !this.user) throw new Error('Sign in as an administrator to do this.'); }
  async submit(form, values) {
    const value = Object.fromEntries(values.entries());
    if (form === 'setup') {
      if (!value.name.trim() || !validPin(value.pin)) throw new Error('Enter a name and a 4–6 digit PIN.');
      if (value.pin !== value.confirmPin) throw new Error('PINs do not match.');
      const code = recoveryCode();
      this.pendingAdmin = { id: uid(), name: value.name.trim(), pinHash: await hashCredential(value.pin), recoveryCodeHash: await hashCredential(code), createdAt: new Date().toISOString(), isFirstAdmin: true };
      this.modal('Save your recovery code', `<p>Keep this code somewhere private. You need it if you forget your admin PIN.</p><div class="secret-code">${code}</div><p>This code will not be shown again.</p>${button('I saved it — complete setup', 'completeSetup')}`); return;
    }
    if (form === 'login') {
      const data = await this.repo.backup(); const user = data[this.role === 'admin' ? 'admins' : 'trainees'].find(record => record.name.toLowerCase() === value.name.trim().toLowerCase());
      if (!user || !await verifyCredential(value.pin, user.pinHash)) throw new Error('Invalid name or PIN.');
      if (user.pinResetRequested) throw new Error('Your PIN reset is pending. Contact your administrator.');
      this.setSession({ userId: user.id, role: this.role, name: user.name }); await this.reload(); location.hash = this.role === 'admin' ? 'dashboard' : 'my-attendance'; this.render(); return;
    }
    if (form === 'recover') {
      const user = this.data.admins.find(record => record.name.toLowerCase() === value.name.trim().toLowerCase());
      if (!user || !await verifyCredential(value.code.trim().toUpperCase(), user.recoveryCodeHash)) throw new Error('Invalid name or recovery code.');
      if (!validPin(value.pin)) throw new Error('Choose a 4–6 digit PIN.');
      await this.repo.put('admins', { ...user, pinHash: await hashCredential(value.pin) }); this.closeModal(); await this.reload(); this.render(); this.notice('PIN reset. You can now sign in.'); return;
    }
    if (!this.user) throw new Error('Please sign in first.');
    if (form === 'changePin') {
      if (this.session.role !== 'trainee' || !this.user.mustChangePin) throw new Error('A PIN change is not required.');
      if (!validPin(value.newPin) || value.newPin !== value.confirmPin) throw new Error('Enter matching 4–6 digit PINs.');
      if (await verifyCredential(value.newPin, this.user.pinHash)) throw new Error('Choose a PIN different from your temporary PIN.');
      await this.repo.put('trainees', { ...this.user, pinHash: await hashCredential(value.newPin), mustChangePin: false }); await this.reload(); this.render(); this.notice('Your new PIN is ready.'); return;
    }
    if (this.session.role === 'trainee' && this.user.mustChangePin) throw new Error('Change your temporary PIN first.');
    if (form === 'mark') {
      if (this.session.role !== 'trainee') throw new Error('Use the admin attendance register.');
      await this.repo.mark(this.user.id, today(), value.time, value.kind); await this.reload(); this.render(); this.notice(`Marked ${value.kind.toUpperCase()} successfully.`); return;
    }
    this.requireAdmin();
    if (form === 'search') { this.search = value.search; this.render(); return; }
    if (form === 'trainer') {
      if (!value.name.trim()) throw new Error('Enter a trainer name.');
      const existing = this.data.trainers.find(record => record.id === value.id);
      await this.repo.addNamed('trainers', { id: value.id || uid(), name: value.name.trim(), createdAt: existing?.createdAt ?? new Date().toISOString() });
    }
    if (form === 'trainee') {
      if (!value.name.trim()) throw new Error('Enter a trainee name.');
      if (value.trainerId && !this.data.trainers.some(record => record.id === value.trainerId)) throw new Error('Choose an existing trainer.');
      const existing = this.data.trainees.find(record => record.id === value.id);
      const pin = existing ? null : temporaryPin();
      await this.repo.addNamed('trainees', existing ? { ...existing, name: value.name.trim(), trainerId: value.trainerId || null } : { id: uid(), name: value.name.trim(), trainerId: value.trainerId || null, pinHash: await hashCredential(pin), mustChangePin: true, pinResetRequested: false, createdAt: new Date().toISOString() });
      this.closeModal(); await this.reload(); this.render();
      if (pin) this.modal('Trainee registered', `<p>Share this temporary PIN with <strong>${esc(value.name)}</strong>. They must change it on first login.</p><div class="secret-code">${pin}</div>${button('Done', 'close')}`);
      else this.notice('Trainee updated.'); return;
    }
    if (form === 'editAttendance') {
      if (value.inTime && !validTime(value.inTime) || value.outTime && !validTime(value.outTime)) throw new Error('Enter valid attendance times.');
      if (value.outTime && (!value.inTime || value.outTime <= value.inTime)) throw new Error('OUT time must be after IN time.');
      const existing = this.data.attendance.find(record => record.traineeId === value.traineeId && record.date === this.date);
      const record = { id: existing?.id ?? uid(), traineeId: value.traineeId, date: this.date, inTime: value.inTime || null, outTime: value.outTime || null, inMarkedBy: value.inTime ? existing?.inTime === value.inTime ? existing.inMarkedBy : 'admin' : null, outMarkedBy: value.outTime ? existing?.outTime === value.outTime ? existing.outMarkedBy : 'admin' : null, workingHours: hours(value.inTime, value.outTime), updatedAt: new Date().toISOString() };
      await this.repo.put('attendance', record);
    }
    if (form === 'bulk') {
      const ids = values.getAll('selected');
      if (!ids.length) throw new Error('Select at least one trainee.');
      if (!validTime(value.time)) throw new Error('Choose a valid time.');
      let count = 0;
      for (const id of ids) {
        const existing = this.data.attendance.find(record => record.traineeId === id && record.date === this.date);
        if (value.kind === 'in' && existing?.inTime || value.kind === 'out' && (!existing?.inTime || existing.outTime || value.time <= existing.inTime)) continue;
        await this.repo.mark(id, this.date, value.time, value.kind, 'admin'); count++;
      }
      this.closeModal(); await this.reload(); this.render(); this.notice(`Marked ${value.kind.toUpperCase()} for ${count} trainee(s). Existing or invalid entries were skipped.`); return;
    }
    this.closeModal(); await this.reload(); this.render(); this.notice('Saved successfully.');
  }
  async readBackup(file) {
    this.requireAdmin();
    if (file.size > 20 * 1024 * 1024) throw new Error('Choose a backup smaller than 20 MB.');
    let data;
    try { data = JSON.parse(await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(reader.error); reader.readAsText(file); })); } catch { throw new Error('This file is not valid JSON. Your data has not changed.'); }
    if (!validateBackup(data)) throw new Error('This file is not a supported attendance backup. Your data has not changed.');
    this.pendingBackup = data;
    this.modal('Replace local data?', `<p>Restore <strong>${esc(file.name)}</strong> from ${esc(new Date(data.exportedAt).toLocaleString())}?</p><ul><li>${data.admins.length} administrator(s)</li><li>${data.trainers.length} trainer(s)</li><li>${data.trainees.length} trainee(s)</li><li>${data.attendance.length} attendance record(s)</li></ul><div class="callout">This replaces all records in this browser and signs you out. You will need a PIN from the backup.</div><div class="actions">${button('Cancel', 'close', '', true)}${button('Replace data and restore', 'restore')}</div>`, true);
  }
  async action(action, id, target) {
    if (action === 'reload') { location.reload(); return; }
    if (action === 'close') { this.closeModal(); return; }
    if (action === 'role') { this.role = id; this.renderAuth(false); return; }
    if (action === 'logout') { this.closeModal(); this.setSession(null); this.render(); return; }
    if (action === 'recover') { this.modal('Recover admin PIN', `<form data-form="recover">${field('Admin name', 'name', '', 'text', 'required')}${field('Recovery code', 'code', '', 'text', 'required autocomplete="off"')}${field('New PIN', 'pin', '', 'password', 'required pattern="[0-9]{4,6}" maxlength="6" inputmode="numeric"')}<button type="submit">Reset PIN</button></form>`); return; }
    if (action === 'completeSetup') {
      if (!this.pendingAdmin) throw new Error('Please create the admin account first.');
      const data = await this.repo.backup(); if (data.appSettings.isSetupComplete || data.admins.length) throw new Error('Setup is already complete. Reload to sign in.');
      await this.repo.setup(this.pendingAdmin);
      this.setSession({ userId: this.pendingAdmin.id, name: this.pendingAdmin.name, role: 'admin' }); this.pendingAdmin = null; this.closeModal(); location.hash = 'dashboard'; await this.reload(); this.render(); return;
    }
    if (!this.user) throw new Error('Please sign in first.');
    if (action === 'toggleTheme') { await this.setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'); return; }
    if (action === 'requestReset') {
      if (this.session.role !== 'trainee') throw new Error('Only trainees can request a PIN reset.');
      this.modal('Request PIN reset?', `<p>Your administrator will issue a new temporary PIN. You will not be able to sign in again until it is reset.</p>${button('Request reset', 'confirmResetRequest')}`); return;
    }
    if (action === 'confirmResetRequest') { if (this.session.role !== 'trainee') throw new Error('Access denied.'); await this.repo.put('trainees', { ...this.user, pinResetRequested: true }); this.closeModal(); await this.reload(); this.render(); this.notice('PIN reset requested. Contact your administrator.'); return; }
    this.requireAdmin();
    if (action === 'clearFilters') { this.trainerFilter = ''; this.search = ''; this.date = today(); this.render(); return; }
    if (action === 'trainer') {
      const value = this.data.trainers.find(record => record.id === id);
      this.modal(value ? 'Edit trainer' : 'Add trainer', `<form data-form="trainer"><input type="hidden" name="id" value="${esc(id)}">${field('Trainer name', 'name', value?.name, 'text', 'required maxlength="100"')}<button type="submit">Save trainer</button></form>`); return;
    }
    if (action === 'trainee') {
      const value = this.data.trainees.find(record => record.id === id);
      this.modal(value ? 'Edit trainee' : 'Register trainee', `<form data-form="trainee"><input type="hidden" name="id" value="${esc(id)}">${field('Trainee name', 'name', value?.name, 'text', 'required maxlength="100"')}${select('Assign trainer', 'trainerId', value?.trainerId ?? '', [['', 'Unassigned'], ...this.data.trainers.map(record => [record.id, record.name])])}<button type="submit">${value ? 'Save trainee' : 'Register trainee'}</button></form>`); return;
    }
    if (action === 'editAttendance') {
      const value = this.data.trainees.find(record => record.id === id); if (!value) throw new Error('Trainee not found.');
      const record = this.data.attendance.find(record => record.traineeId === id && record.date === this.date);
      this.modal('Edit attendance', `<p>${esc(value.name)} · ${esc(this.date)}</p><form data-form="editAttendance"><input type="hidden" name="traineeId" value="${esc(id)}">${field('IN time', 'inTime', record?.inTime, 'time')}${field('OUT time', 'outTime', record?.outTime, 'time')}<button type="submit">Save attendance</button></form>`); return;
    }
    if (action === 'bulk') { this.modal('Bulk mark attendance', `<p>${esc(this.date)} · Only eligible entries will be marked.</p><form data-form="bulk">${select('Entry', 'kind', 'in', [['in', 'Mark IN'], ['out', 'Mark OUT']])}${field('Time', 'time', '', 'time', 'required')}<div class="checklist">${this.filtered.map(value => `<label><input type="checkbox" name="selected" value="${esc(value.id)}">${esc(value.name)}</label>`).join('')}</div><button type="submit">Mark selected trainees</button></form>`); return; }
    if (action === 'deleteTrainer' || action === 'deleteTrainee') {
      const store = action === 'deleteTrainer' ? 'trainers' : 'trainees'; const value = this.data[store].find(record => record.id === id);
      if (!value) throw new Error('This record no longer exists.');
      this.modal('Delete this record?', `<p>Delete <strong>${esc(value.name)}</strong>? ${store === 'trainees' ? 'Historical attendance will be retained.' : 'Trainers with assigned trainees must be reassigned first.'}</p><div class="actions">${button('Cancel', 'close', '', true)}${button('Delete', store === 'trainers' ? 'confirmDeleteTrainer' : 'confirmDeleteTrainee', id)}</div>`); return;
    }
    if (action === 'confirmDeleteTrainer' || action === 'confirmDeleteTrainee') { await this.repo.remove(action === 'confirmDeleteTrainer' ? 'trainers' : 'trainees', id); this.closeModal(); await this.reload(); this.render(); this.notice('Record deleted.'); return; }
    if (action === 'resetPin') { const user = this.data.trainees.find(value => value.id === id); this.modal('Reset trainee PIN?', `<p>Create a new temporary PIN for ${esc(user?.name)}?</p>${button('Generate temporary PIN', 'confirmResetPin', id)}`); return; }
    if (action === 'confirmResetPin') {
      const user = this.data.trainees.find(value => value.id === id); if (!user) throw new Error('Trainee not found.');
      const pin = temporaryPin(); await this.repo.put('trainees', { ...user, pinHash: await hashCredential(pin), mustChangePin: true, pinResetRequested: false });
      this.closeModal(); await this.reload(); this.render(); this.modal('New temporary PIN', `<p>Share this PIN privately with ${esc(user.name)}.</p><div class="secret-code">${pin}</div>${button('Done', 'close')}`); return;
    }
    if (action === 'backup') { download(JSON.stringify(await this.repo.backup(), null, 2), `tams-backup-${today()}.json`, 'application/json'); this.notice('Backup downloaded. Keep it private.'); return; }
    if (action === 'restore') { if (!this.pendingBackup) throw new Error('Choose a backup first.'); await this.repo.restore(this.pendingBackup); this.closeModal(); this.setSession(null); await this.reload(); this.render(); this.notice('Backup restored. Sign in with an account from the backup.'); return; }
    if (action === 'exportDaily') {
      const rows = [['Date', 'Trainee', 'Trainer', 'IN time', 'OUT time', 'Hours', 'Status'], ...this.filtered.map(value => { const record = this.data.attendance.find(record => record.traineeId === value.id && record.date === this.date); return [this.date, value.name, this.trainerName(value.trainerId), record?.inTime ?? '', record?.outTime ?? '', record?.workingHours?.toFixed(2) ?? '', status(record)[0]]; })];
      download(csv(rows), `attendance-${this.date}.csv`, 'text/csv;charset=utf-8'); this.notice('Daily report downloaded.'); return;
    }
    if (action === 'exportMonthly') { download(csv([['Trainee', 'Trainer', 'Days IN', 'Completed', 'Missing OUT', 'Total hours'], ...this.monthly().map(value => [value.name, value.trainer, value.daysIn, value.complete, value.missing, value.total.toFixed(2)])]), `monthly-report-${this.month}.csv`, 'text/csv;charset=utf-8'); this.notice('Monthly report downloaded.'); return; }
    if (target) throw new Error('Unknown action.');
  }
}

const root = document.getElementById('app');
if (root) { const app = new AttendanceApp(root); void app.start(); }
