/**
 * AppState (Observer Pattern)
 * Central reactive store managing client-side view state, roles, and subscribers.
 */
class AppState {
  constructor() {
    this.currentRole = 'lecturer'; // 'lecturer' | 'student'
    this.activeTab = 'dashboard';
    this.currentStudentId = 's103'; // David Kim (default student perspective)
    this.listeners = new Map();
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
    if (this.currentRole !== role) {
      this.currentRole = role;
      this.notify('role', role);
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
    this.notify('student', studentId);
  }
}
