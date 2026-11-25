/**
 * App Coordinator
 * Coordinates all tabs, role switcher, dashboard summary, and real-time polling updates.
 */
class App {
  constructor() {
    this.state = AppState.getInstance();
    this.attendanceComp = new AttendanceComponent('tab-attendance-content', this.state);
    this.commentsComp = new CommentsComponent('tab-comments-content', this.state);
    this.pollComp = new PollComponent('tab-polls-content', this.state);
    this.summaryComp = new SummaryComponent('tab-summary-content', this.state);
    this.reviewComp = new HomeworkReviewComponent('tab-review-content', this.state);
    this.pollInterval = null;
  }

  async init() {
    this.bindNavigation();
    this.bindRoleSwitcher();
    this.state.subscribe('tab', (tab) => this.switchTab(tab));
    this.state.subscribe('role', (role) => {
      this.updateRoleUI(role);
      // Students land directly on the attendance screen
      this.state.setActiveTab(role === 'student' ? 'attendance' : 'dashboard');
      this.switchTab(this.state.activeTab);
    });
    this.bindRoleChooser();
    this.updateRoleUI(this.state.currentRole);
    this.switchTab(this.state.activeTab);

    // Initialize all components
    await Promise.all([
      this.attendanceComp.init(),
      this.commentsComp.init(),
      this.pollComp.init(),
      this.summaryComp.init(),
      this.reviewComp.init()
    ]);

    this.renderDashboardSummary();
    this.startLiveSync();
  }

  bindNavigation() {
    document.querySelectorAll('.nav-tab').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const tab = e.currentTarget.getAttribute('data-tab');
        this.state.setActiveTab(tab);
      });
    });
  }

  bindRoleSwitcher() {
    const roleSelect = document.getElementById('role-select');
    if (roleSelect) {
      roleSelect.value = this.state.currentRole;
      roleSelect.addEventListener('change', (e) => {
        this.state.setRole(e.target.value);
      });
    }
  }

  /** Landing screen: shown once per tab until a role is picked. */
  bindRoleChooser() {
    const chooser = document.getElementById('role-chooser');
    if (!chooser) return;
    if (!this.state.roleChosen) chooser.style.display = 'flex';
    chooser.querySelectorAll('[data-choose-role]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const role = e.currentTarget.getAttribute('data-choose-role');
        chooser.style.display = 'none';
        this.state.setRole(role);
        this.updateRoleUI(role);
        this.state.setActiveTab(role === 'student' ? 'attendance' : 'dashboard');
        this.switchTab(this.state.activeTab);
      });
    });
  }

  switchTab(tabName) {
    // Hide all tab panes
    document.querySelectorAll('.tab-pane').forEach(el => el.classList.add('hidden'));

    // Show active pane
    const target = document.getElementById(`tab-${tabName}`);
    if (target) target.classList.remove('hidden');

    // Update nav styling
    document.querySelectorAll('.nav-tab').forEach(btn => {
      if (btn.getAttribute('data-tab') === tabName) {
        btn.classList.add('tab-active', 'text-indigo-600', 'border-indigo-600');
        btn.classList.remove('text-slate-500', 'border-transparent');
      } else {
        btn.classList.remove('tab-active', 'text-indigo-600', 'border-indigo-600');
        btn.classList.add('text-slate-500', 'border-transparent');
      }
    });

    if (tabName === 'dashboard') {
      this.renderDashboardSummary();
    }
  }

  updateRoleUI(role) {
    const roleSelect = document.getElementById('role-select');
    if (roleSelect && roleSelect.value !== role) roleSelect.value = role;
    document.body.setAttribute('data-role', role);
    const roleBadge = document.getElementById('current-role-badge');
    if (roleBadge) {
      if (role === 'lecturer') {
        roleBadge.textContent = '👨‍🏫 Instructor Mode';
        roleBadge.className = 'px-3 py-1 text-xs font-bold rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200';
      } else {
        roleBadge.textContent = '👨‍🎓 Student Mode';
        roleBadge.className = 'px-3 py-1 text-xs font-bold rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200';
      }
    }
  }

  renderDashboardSummary() {
    const container = document.getElementById('dashboard-metrics-summary');
    if (!container) return;

    const att = this.attendanceComp.data;
    const poll = this.pollComp.poll;
    const comments = this.commentsComp.comments;
    const reviews = this.reviewComp.submissions;

    container.innerHTML = `
      <div class="grid grid-cols-1 md:grid-cols-4 gap-4">
        <!-- Metric 1 -->
        <div class="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm cursor-pointer hover:border-indigo-300 transition" onclick="app.state.setActiveTab('attendance')">
          <div class="flex items-center justify-between text-xs text-slate-400 font-semibold uppercase">
            <span>Attendance Status</span>
            <span>📸</span>
          </div>
          <div class="mt-2 text-2xl font-bold text-slate-800">
            ${att ? `${att.present_count} / ${att.total_enrolled}` : '—'}
          </div>
          <div class="mt-1 text-xs text-indigo-600 font-medium">
            ${att ? `${att.attendance_rate}% verified presence` : ''}
          </div>
        </div>

        <!-- Metric 2 -->
        <div class="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm cursor-pointer hover:border-indigo-300 transition" onclick="app.state.setActiveTab('polls')">
          <div class="flex items-center justify-between text-xs text-slate-400 font-semibold uppercase">
            <span>Live Class Poll</span>
            <span>🗳️</span>
          </div>
          <div class="mt-2 text-2xl font-bold ${poll && poll.is_active ? 'text-emerald-600' : 'text-slate-800'}">
            ${poll && poll.is_active ? 'Active' : 'Closed'}
          </div>
          <div class="mt-1 text-xs text-slate-500 font-medium">
            ${poll ? `${poll.total_votes} votes recorded` : '0 votes'}
          </div>
        </div>

        <!-- Metric 3 -->
        <div class="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm cursor-pointer hover:border-indigo-300 transition" onclick="app.state.setActiveTab('comments')">
          <div class="flex items-center justify-between text-xs text-slate-400 font-semibold uppercase">
            <span>Questions & Feedback</span>
            <span>💬</span>
          </div>
          <div class="mt-2 text-2xl font-bold text-slate-800">
            ${comments ? comments.length : 0}
          </div>
          <div class="mt-1 text-xs text-amber-600 font-medium">
            ${comments ? comments.filter(c => !c.is_resolved).length : 0} open inquiries
          </div>
        </div>

        <!-- Metric 4 -->
        <div class="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm cursor-pointer hover:border-indigo-300 transition" onclick="app.state.setActiveTab('review')">
          <div class="flex items-center justify-between text-xs text-slate-400 font-semibold uppercase">
            <span>Homework Deep Review</span>
            <span>🔍</span>
          </div>
          <div class="mt-2 text-2xl font-bold text-slate-800">
            ${reviews ? reviews.length : 0} ${reviews && reviews.length === 1 ? 'submission' : 'submissions'}
          </div>
          <div class="mt-1 text-xs text-emerald-600 font-medium">
            ${(() => {
              const scored = (reviews || []).filter(r => typeof r.overall_score === 'number');
              if (!scored.length) return 'Upload a homework zip or GitHub link';
              const avg = Math.round(scored.reduce((t, r) => t + r.overall_score, 0) / scored.length);
              return `Average AI score: ${avg}/100 (${scored.length} reviewed)`;
            })()}
          </div>
        </div>
      </div>
    `;
  }

  /**
   * Background sync, designed for a lecture hall of 100+ phones:
   * - Instructor: every 5 s; roster requests carry a version, so "nothing changed" costs a few bytes.
   * - Student: every 10 s, and only the data for the tab that is open
   *   (attendance → own status only, not the whole class list).
   */
  startLiveSync() {
    if (this.pollTimer) clearTimeout(this.pollTimer);
    const tick = async () => {
      const isLecturer = this.state.currentRole === 'lecturer';
      const tab = this.state.activeTab;
      if (!document.hidden) {
        try {
          const jobs = [];
          let attendanceChanged = false;
          if (isLecturer || tab === 'attendance') {
            jobs.push(this.attendanceComp.fetchData().then(c => { attendanceChanged = c; }));
          }
          if (isLecturer || tab === 'comments') jobs.push(this.commentsComp.fetchComments());
          if (isLecturer || tab === 'polls') jobs.push(this.pollComp.fetchPoll());
          await Promise.all(jobs);

          if (tab === 'dashboard' && isLecturer) this.renderDashboardSummary();
          if (tab === 'attendance') this.attendanceComp.onBackgroundRefresh(attendanceChanged);
        } catch (err) {
          console.warn('Background sync:', err);
        }
      }
      this.pollTimer = setTimeout(tick, isLecturer ? 5000 : 10000);
    };
    this.pollTimer = setTimeout(tick, 5000);
  }
}

// Global instance
let app;
document.addEventListener('DOMContentLoaded', () => {
  app = new App();
  app.init();
});
