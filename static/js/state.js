/**
 * AppState (Observer Pattern)
 * Central reactive store managing client-side view state, roles, and subscribers.
 */
class AppState {
  constructor() {
    this.listeners = new Map();

    // Role comes from the URL (?role=student / ?role=instructor) so that two browser tabs
    // (or a laptop + a phone) can run Instructor Mode and Student Mode side by side.
    // sessionStorage is per-tab, so tabs never overwrite each other's role.
    const params = new URLSearchParams(window.location.search);
    const urlRole = AppState.normalizeRole(params.get('role'));
    const storedRole = AppState.normalizeRole(AppState.storageGet('cs302_role'));
    this.currentRole = urlRole || storedRole || 'lecturer'; // 'lecturer' | 'student'
    this.roleChosen = Boolean(urlRole || storedRole);

    // A token arriving via the QR deep link (phone camera app) is handed to Student Mode
    this.pendingQrToken = params.get('token') || params.get('code') || '';

    this.activeTab = this.currentRole === 'student' ? 'attendance' : 'dashboard';
    this.currentStudentId = AppState.storageGet('cs302_student_id') || 's103';
    if (this.roleChosen) this.persistRole();
  }

  static normalizeRole(value) {
    if (!value) return null;
    const v = String(value).toLowerCase();
    if (v === 'student') return 'student';
    if (v === 'instructor' || v === 'lecturer' || v === 'teacher') return 'lecturer';
    return null;
  }

  static storageGet(key) {
    try { return window.sessionStorage.getItem(key); } catch (e) { return null; }
  }

  static storageSet(key, value) {
    try { window.sessionStorage.setItem(key, value); } catch (e) { /* storage unavailable */ }
  }

  persistRole() {
    AppState.storageSet('cs302_role', this.currentRole);
    try {
      const url = new URL(window.location.href);
      url.searchParams.set('role', this.currentRole === 'student' ? 'student' : 'instructor');
      url.searchParams.delete('token');
      url.searchParams.delete('code');
      window.history.replaceState(null, '', url.toString());
    } catch (e) { /* ignore */ }
  }

  static getInstance() {
    if (!AppState.instance) {
      AppState.instance = new AppState();
    }
    return AppState.instance;
  }

  // Subscribe to changes: event can be 'role', 'tab', or '*'
  subscribe(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event).push(callback);
    return () => {
      const list = this.listeners.get(event).filter(cb => cb !== callback);
      this.listeners.set(event, list);
    };
  }

  notify(event, data) {
    if (this.listeners.has(event)) {
      this.listeners.get(event).forEach(cb => cb(data));
    }
    if (this.listeners.has('*')) {
      this.listeners.get('*').forEach(cb => cb({ event, data }));
    }
  }

  setRole(role) {
    role = AppState.normalizeRole(role) || role;
    this.roleChosen = true;
    if (this.currentRole !== role) {
      this.currentRole = role;
      this.persistRole();
      this.notify('role', role);
    } else {
      this.persistRole();
    }
  }

  setActiveTab(tabName) {
    if (this.activeTab !== tabName) {
      this.activeTab = tabName;
      this.notify('tab', tabName);
    }
  }

  setCurrentStudent(studentId) {
    this.currentStudentId = studentId;
    AppState.storageSet('cs302_student_id', studentId);
    this.notify('student', studentId);
  }
}
