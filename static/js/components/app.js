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
    this.state.subscribe('role', (role) => this.updateRoleUI(role));

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
    const roleBadge = document.getElementById('current-role-badge');
    if (roleBadge) {
      if (role === 'lecturer') {
        roleBadge.textContent = '👨‍🏫 Lecturer Mode';
        roleBadge.className = 'px-3 py-1 text-xs font-bold rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200';
      } else {
        roleBadge.textContent = '👨‍🎓 Student Mode (David Kim)';
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
            ${reviews ? reviews.length : 0} Repos
          </div>
          <div class="mt-1 text-xs text-emerald-600 font-medium">
            Avg Score: 84/100
          </div>
        </div>
      </div>
    `;
  }

  startLiveSync() {
    // Light background sync every 8 seconds
    this.pollInterval = setInterval(async () => {
      try {
        await Promise.all([
          this.attendanceComp.fetchData(),
          this.commentsComp.fetchComments(),
          this.pollComp.fetchPoll()
        ]);
        if (this.state.activeTab === 'dashboard') {
          this.renderDashboardSummary();
        }
      } catch (err) {
        console.warn('Background sync:', err);
      }
    }, 8000);
  }
}

// Global instance
let app;
document.addEventListener('DOMContentLoaded', () => {
  app = new App();
  app.init();
});
