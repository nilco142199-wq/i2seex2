/**
 * PollComponent
 * Manages live on-the-spot polls, real-time voting tally, and lecturer toggle controls.
 */
class PollComponent {
  constructor(containerId, state) {
    this.container = document.getElementById(containerId);
    this.state = state;
    this.poll = null;
    this.hasVoted = false;
    this.selectedOption = null;
  }

  async init() {
    this.state.subscribe('role', () => this.render());
    await this.fetchPoll();
    this.render();
  }

  async fetchPoll() {
    try {
      const res = await ApiClient.getPoll();
      this.poll = res.poll;
    } catch (err) {
      console.error('Failed to load poll:', err);
    }
  }

  async handleVote(optionId) {
    if (!this.poll || !this.poll.is_active) return;
    try {
      const res = await ApiClient.votePoll(optionId, `voter_${this.state.currentStudentId}`);
      this.poll = res.poll;
      this.hasVoted = true;
      this.selectedOption = optionId;
      this.render();
    } catch (err) {
      alert('Vote failed: ' + err.message);
    }
  }

  async handleToggleActive() {
    try {
      const res = await ApiClient.togglePoll();
      this.poll = res.poll;
      this.render();
    } catch (err) {
      alert('Error toggling poll state: ' + err.message);
    }
  }

  async handleCreatePoll(e) {
    e.preventDefault();
    const form = e.target;
    const question = form.question.value.trim();
    const optInputs = form.querySelectorAll('.poll-opt-input');
    const options = Array.from(optInputs).map(i => i.value.trim()).filter(v => v.length > 0);

    if (!question || options.length < 2) {
      alert('Please enter a question and at least 2 options.');
      return;
    }

    try {
      const res = await ApiClient.createPoll(question, options);
      this.poll = res.poll;
      this.hasVoted = false;
      this.selectedOption = null;
      form.reset();
      this.render();
      alert('🎉 New on-the-spot poll launched live!');
    } catch (err) {
      alert('Failed to create poll: ' + err.message);
    }
  }

  render() {
    if (!this.container) return;

    const isLecturer = this.state.currentRole === 'lecturer';

    this.container.innerHTML = `
      <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <!-- Main Live Poll Widget -->
        <div class="lg:col-span-2 space-y-6">
          <div class="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm space-y-5">
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-2">
                <span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold ${
                  this.poll && this.poll.is_active
                    ? 'bg-emerald-50 text-emerald-700 border border-emerald-100'
                    : 'bg-rose-50 text-rose-700 border border-rose-100'
                }">
                  <span class="w-2 h-2 rounded-full ${this.poll && this.poll.is_active ? 'bg-emerald-500 pulse-dot' : 'bg-rose-500'}"></span>
                  ${this.poll && this.poll.is_active ? 'LIVE & ACCEPTING VOTES' : 'POLL CLOSED'}
                </span>
                <span class="text-xs text-slate-400">Total Votes: <strong class="text-slate-700">${this.poll ? this.poll.total_votes : 0}</strong></span>
              </div>

              <!-- Lecturer Toggle -->
              <div class="flex items-center gap-2">
                <button id="btn-toggle-poll" class="px-3.5 py-1.5 text-xs font-semibold rounded-xl border transition ${
                  this.poll && this.poll.is_active
                    ? 'border-rose-200 text-rose-600 hover:bg-rose-50'
                    : 'border-emerald-200 text-emerald-600 hover:bg-emerald-50'
                }">
                  ${this.poll && this.poll.is_active ? '⏸ Close Poll' : '▶ Reopen Poll'}
                </button>
              </div>
            </div>

            <!-- Poll Question -->
            <div>
              <h2 class="text-lg font-bold text-slate-800 tracking-tight">
                ${this.poll ? this.poll.question : 'No active poll right now.'}
              </h2>
              <p class="text-xs text-slate-500 mt-1">Select an option to cast your vote or watch dynamic live tallies.</p>
            </div>

            <!-- Options & Live Percentage Bars -->
            <div class="space-y-3 pt-2">
              ${this.poll && this.poll.options ? this.poll.options.map(opt => `
                <div class="relative overflow-hidden rounded-xl border border-slate-200 hover:border-indigo-300 transition bg-slate-50/50 p-4">
                  <!-- Progress Bar Fill -->
                  <div class="absolute inset-y-0 left-0 bg-indigo-50 border-r border-indigo-200 bar-transition z-0" style="width: ${opt.percentage}%"></div>
                  
                  <div class="relative z-10 flex items-center justify-between">
                    <div class="flex items-center gap-3">
                      <button data-opt-id="${opt.id}" class="btn-vote-option w-7 h-7 rounded-lg border flex items-center justify-center font-bold text-xs transition ${
                        this.selectedOption === opt.id
                          ? 'bg-indigo-600 text-white border-indigo-600'
                          : 'bg-white text-slate-700 border-slate-300 hover:bg-indigo-600 hover:text-white hover:border-indigo-600'
                      }" ${!this.poll.is_active ? 'disabled' : ''}>
                        ${opt.id}
                      </button>
                      <span class="font-medium text-slate-800 text-xs">${opt.text}</span>
                    </div>

                    <div class="text-right flex items-center gap-2">
                      <span class="text-xs text-slate-400 font-mono">(${opt.votes} votes)</span>
                      <span class="text-xs font-bold text-indigo-700 w-12 text-right">${opt.percentage}%</span>
                    </div>
                  </div>
                </div>
              `).join('') : ''}
            </div>

            ${this.hasVoted ? `
              <div class="p-3 bg-emerald-50 border border-emerald-100 rounded-xl text-emerald-800 text-xs font-medium flex items-center gap-2">
                <svg class="w-4 h-4 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>
                Your vote has been counted in real time!
              </div>
            ` : ''}
          </div>
        </div>

        <!-- Lecturer On-The-Spot Poll Creator -->
        <div class="space-y-6">
          <div class="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm space-y-4">
            <div class="flex items-center justify-between">
              <h3 class="font-bold text-slate-800 text-sm flex items-center gap-2">
                <svg class="w-4 h-4 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6"></path></svg>
                Create Instant Poll
              </h3>
              <span class="text-[10px] uppercase font-bold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded">Lecturer Quick Tool</span>
            </div>
            <p class="text-xs text-slate-500">Pose a question to check understanding during the lecture.</p>

            <form id="create-poll-form" class="space-y-3">
              <div>
                <label class="block text-xs font-semibold text-slate-700 mb-1">Question Prompt</label>
                <textarea name="question" rows="2" required placeholder="e.g., Which SOLID principle does this violate?" class="w-full text-xs p-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500"></textarea>
              </div>

              <div id="poll-options-container" class="space-y-2">
                <label class="block text-xs font-semibold text-slate-700">Answer Choices</label>
                <input type="text" class="poll-opt-input w-full text-xs p-2 rounded-xl border border-slate-200 focus:outline-none" placeholder="Choice 1 (e.g. Single Responsibility Principle)" required>
                <input type="text" class="poll-opt-input w-full text-xs p-2 rounded-xl border border-slate-200 focus:outline-none" placeholder="Choice 2 (e.g. Open/Closed Principle)" required>
                <input type="text" class="poll-opt-input w-full text-xs p-2 rounded-xl border border-slate-200 focus:outline-none" placeholder="Choice 3 (e.g. Dependency Inversion)">
                <input type="text" class="poll-opt-input w-full text-xs p-2 rounded-xl border border-slate-200 focus:outline-none" placeholder="Choice 4 (e.g. None of the above)">
              </div>

              <button type="submit" class="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-semibold text-xs transition shadow-sm flex items-center justify-center gap-1.5 mt-2">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg>
                Launch Live Poll Now
              </button>
            </form>
          </div>
        </div>
      </div>
    `;

    this.attachEventListeners();
  }

  attachEventListeners() {
    const btnToggle = this.container.querySelector('#btn-toggle-poll');
    if (btnToggle) {
      btnToggle.addEventListener('click', () => this.handleToggleActive());
    }

    const form = this.container.querySelector('#create-poll-form');
    if (form) {
      form.addEventListener('submit', (e) => this.handleCreatePoll(e));
    }

    this.container.querySelectorAll('.btn-vote-option').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const optId = e.currentTarget.getAttribute('data-opt-id');
        this.handleVote(optId);
      });
    });
  }
}
