/**
 * HomeworkReviewComponent
 * Provides mock LLM code review, OOP metric evaluation, SOLID rubric, and multi-repo comparison.
 */
class HomeworkReviewComponent {
  constructor(containerId, state) {
    this.container = document.getElementById(containerId);
    this.state = state;
    this.submissions = [];
    this.selectedSubmission = null;
    this.comparisonResult = null;
  }

  async init() {
    this.state.subscribe('role', () => this.render());
    await this.fetchSubmissions();
    if (this.submissions.length > 0) {
      await this.selectSubmission(this.submissions[0].submission_id);
    }
  }

  async fetchSubmissions() {
    try {
      const res = await ApiClient.getReviews();
      this.submissions = res.submissions || [];
    } catch (err) {
      console.error('Failed to load reviews:', err);
    }
  }

  async selectSubmission(submissionId) {
    try {
      const res = await ApiClient.getReviewDetail(submissionId);
      this.selectedSubmission = res.submission;
      this.render();
    } catch (err) {
      console.error('Failed to load review detail:', err);
    }
  }

  async handleCompare(idA, idB) {
    if (idA === idB) {
      alert('Please select two different student submissions to compare.');
      return;
    }
    try {
      this.comparisonResult = await ApiClient.compareReviews(idA, idB);
      this.render();
    } catch (err) {
      alert('Comparison failed: ' + err.message);
    }
  }

  async handleAnalyzeNew(e) {
    e.preventDefault();
    const form = e.target;
    const name = form.student_name.value.trim();
    const url = form.repo_url.value.trim();

    if (!url) return;

    try {
      const res = await ApiClient.analyzeRepo(url, name);
      await this.fetchSubmissions();
      await this.selectSubmission(res.submission.submission_id);
      form.reset();
      alert(`🚀 LLM Repository Review completed for ${name}! Overall score: ${res.submission.overall_score}/100`);
    } catch (err) {
      alert('Analysis error: ' + err.message);
    }
  }

  render() {
    if (!this.container) return;
    if (this.submissions.length === 0) {
      this.container.innerHTML = '<div class="p-8 text-center text-slate-500">Loading homework submissions...</div>';
      return;
    }

    const sub = this.selectedSubmission || this.submissions[0];

    this.container.innerHTML = `
      <div class="space-y-6">
        <!-- Submissions Leaderboard Bar -->
        <div class="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm">
          <div class="flex items-center justify-between mb-3">
            <h3 class="font-bold text-slate-800 text-sm flex items-center gap-2">
              <svg class="w-4 h-4 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4"></path></svg>
              Student Assignment Repositories (Ex2: OOP Architecture)
            </h3>
            <span class="text-xs text-slate-400">Click a student to view deep audit report</span>
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
            ${this.submissions.map(s => `
              <div data-id="${s.submission_id}" class="btn-select-sub cursor-pointer p-4 rounded-xl border transition ${
                sub.submission_id === s.submission_id
                  ? 'border-indigo-600 bg-indigo-50/40 shadow-sm'
                  : 'border-slate-200 hover:border-slate-300 bg-slate-50/50'
              }">
                <div class="flex items-start justify-between">
                  <div>
                    <h4 class="font-bold text-slate-800 text-xs">${s.student_name}</h4>
                    <span class="text-[11px] font-mono text-slate-500 truncate block max-w-[170px]">${s.repo_name}</span>
                  </div>
                  <span class="px-2.5 py-1 rounded-lg text-xs font-bold ${
                    s.overall_score >= 90 ? 'bg-emerald-100 text-emerald-800' :
                    s.overall_score >= 80 ? 'bg-indigo-100 text-indigo-800' :
                    'bg-amber-100 text-amber-800'
                  }">
                    ${s.overall_score}/100
                  </span>
                </div>
              </div>
            `).join('')}
          </div>
        </div>

        <!-- Selected Submission Deep Dive -->
        <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <!-- Left Column: Metrics & Score Card -->
          <div class="space-y-6">
            <div class="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm space-y-5">
              <div class="text-center pb-4 border-b border-slate-100">
                <span class="text-xs uppercase font-bold text-slate-400 tracking-wider">Overall OOP Grade</span>
                <div class="text-5xl font-extrabold mt-2 ${
                  sub.overall_score >= 90 ? 'text-emerald-600' :
                  sub.overall_score >= 80 ? 'text-indigo-600' :
                  'text-amber-500'
                }">
                  ${sub.overall_score}<span class="text-xl text-slate-400 font-semibold">/100</span>
                </div>
                <div class="text-xs text-slate-500 mt-1 font-medium">Commit SHA: <code class="font-mono bg-slate-100 px-1.5 py-0.5 rounded text-slate-700">${sub.commit_hash}</code> (${sub.branch})</div>
              </div>

              <!-- Sub-Score Sliders -->
              <div class="space-y-3">
                <h4 class="text-xs font-bold text-slate-700">Sub-Metric Breakdown</h4>
                ${Object.entries(sub.scores).map(([metric, val]) => `
                  <div class="space-y-1">
                    <div class="flex justify-between text-xs">
                      <span class="text-slate-600 capitalize">${metric.replace('_', ' ')}</span>
                      <span class="font-bold text-slate-800">${val}%</span>
                    </div>
                    <div class="w-full bg-slate-100 rounded-full h-2">
                      <div class="bg-indigo-600 h-2 rounded-full bar-transition" style="width: ${val}%"></div>
                    </div>
                  </div>
                `).join('')}
              </div>

              <!-- Detected Patterns -->
              <div>
                <h4 class="text-xs font-bold text-slate-700 mb-2">Detected GoF Design Patterns</h4>
                <div class="flex flex-wrap gap-1.5">
                  ${sub.design_patterns.map(p => `
                    <span class="px-2.5 py-1 rounded-lg text-xs bg-emerald-50 text-emerald-700 border border-emerald-100 font-medium">
                      ✓ ${p}
                    </span>
                  `).join('')}
                </div>
              </div>

              <!-- Code Smells -->
              <div>
                <h4 class="text-xs font-bold text-slate-700 mb-2">Architectural Flags & Smells</h4>
                <div class="space-y-1.5">
                  ${sub.code_smells.map(s => `
                    <div class="text-xs p-2.5 rounded-lg bg-rose-50/60 border border-rose-100 text-rose-800 flex items-start gap-2">
                      <span class="text-rose-500 font-bold">⚠️</span>
                      <span>${s}</span>
                    </div>
                  `).join('')}
                </div>
              </div>
            </div>

            <!-- Audit New Repo Box -->
            <div class="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm space-y-3">
              <h4 class="font-bold text-slate-800 text-xs flex items-center gap-2">
                <svg class="w-4 h-4 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg>
                Audit Another Student Repository
              </h4>
              <form id="analyze-repo-form" class="space-y-2.5">
                <input type="text" name="student_name" required placeholder="Student Name (e.g. Grace Hopper)" class="w-full text-xs p-2 rounded-xl border border-slate-200 focus:outline-none">
                <input type="url" name="repo_url" required placeholder="https://github.com/student/ex2-oop" class="w-full text-xs p-2 rounded-xl border border-slate-200 focus:outline-none">
                <button type="submit" class="w-full py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-xl font-semibold text-xs transition shadow-sm">
                  Run Simulated LLM Audit
                </button>
              </form>
            </div>
          </div>

          <!-- Right Column: SOLID Rubric & AI Critique -->
          <div class="lg:col-span-2 space-y-6">
            <!-- AI Comprehensive Critique -->
            <div class="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm space-y-3">
              <div class="flex items-center justify-between">
                <h3 class="font-bold text-slate-800 text-sm flex items-center gap-2">
                  <span class="w-2 h-2 rounded-full bg-indigo-600"></span>
                  AI Architectural Critique & Feedback
                </h3>
                <span class="text-[10px] uppercase font-bold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded">Ex2 Rubric Engine</span>
              </div>
              <p class="text-xs text-slate-700 leading-relaxed bg-slate-50 p-4 rounded-xl border border-slate-100 font-normal">
                ${sub.ai_summary}
              </p>
            </div>

            <!-- SOLID Compliance Checklist -->
            <div class="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm space-y-4">
              <h3 class="font-bold text-slate-800 text-sm">SOLID Principles Rubric Audit</h3>
              <div class="space-y-2.5">
                ${sub.solid_compliance.map(sc => `
                  <div class="p-3.5 rounded-xl border border-slate-100 bg-slate-50/50 flex flex-col md:flex-row md:items-center justify-between gap-2 text-xs">
                    <div class="space-y-0.5">
                      <div class="font-bold text-slate-800">${sc.principle}</div>
                      <div class="text-slate-500 text-[11px]">${sc.critique}</div>
                    </div>
                    <div>
                      <span class="px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                        sc.status === 'pass' ? 'bg-emerald-50 text-emerald-700 border border-emerald-100' :
                        sc.status === 'warning' ? 'bg-amber-50 text-amber-700 border border-amber-100' :
                        'bg-rose-50 text-rose-700 border border-rose-100'
                      }">
                        ${sc.status === 'pass' ? '✓ Passed' : sc.status === 'warning' ? '⚠ Warning' : '✕ Failed'}
                      </span>
                    </div>
                  </div>
                `).join('')}
              </div>
            </div>

            <!-- Refactoring Suggestions -->
            <div class="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm space-y-3">
              <h3 class="font-bold text-slate-800 text-sm flex items-center gap-2">
                <svg class="w-4 h-4 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"></path></svg>
                Actionable Refactoring Advice for Student
              </h3>
              <ul class="space-y-2">
                ${sub.refactoring_suggestions.map(sug => `
                  <li class="flex items-start gap-2.5 text-xs text-slate-700 bg-emerald-50/40 p-3 rounded-xl border border-emerald-100">
                    <span class="text-emerald-600 font-bold">💡</span>
                    <span>${sug}</span>
                  </li>
                `).join('')}
              </ul>
            </div>
          </div>
        </div>

        <!-- Multi-Repository Side-by-Side Comparison Section -->
        <div class="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm space-y-5">
          <div class="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h3 class="font-bold text-slate-800 text-sm flex items-center gap-2">
                <svg class="w-4 h-4 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"></path></svg>
                Side-by-Side Multi-Repository Comparison
              </h3>
              <p class="text-xs text-slate-500">Compare OOP architectural trade-offs between two student submissions.</p>
            </div>

            <!-- Compare Form Selectors -->
            <form id="compare-repos-form" class="flex flex-wrap items-center gap-3">
              <select name="id_a" class="text-xs bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 font-medium text-slate-700">
                ${this.submissions.map(s => `
                  <option value="${s.submission_id}">${s.student_name} (${s.overall_score})</option>
                `).join('')}
              </select>

              <span class="text-xs font-bold text-slate-400">vs</span>

              <select name="id_b" class="text-xs bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 font-medium text-slate-700">
                ${this.submissions.map((s, idx) => `
                  <option value="${s.submission_id}" ${idx === 1 ? 'selected' : ''}>${s.student_name} (${s.overall_score})</option>
                `).join('')}
              </select>

              <button type="submit" class="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-semibold text-xs transition shadow-sm">
                Compare Repos
              </button>
            </form>
          </div>

          <!-- Comparison Results Table if active -->
          ${this.comparisonResult ? `
            <div class="pt-3 border-t border-slate-100 space-y-4">
              <div class="p-3 bg-indigo-50 border border-indigo-100 rounded-xl text-indigo-900 text-xs">
                🏆 <strong>Comparative Leader: ${this.comparisonResult.comparison.leader}</strong> (Score Difference: +${this.comparisonResult.comparison.score_difference} pts).
                ${this.comparisonResult.comparison.comparative_summary}
              </div>

              <div class="overflow-x-auto">
                <table class="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr class="bg-slate-50 text-slate-600 font-semibold border-b border-slate-100">
                      <th class="p-3">Metric / Principle</th>
                      <th class="p-3 text-indigo-700">${this.comparisonResult.submission_a.student_name}</th>
                      <th class="p-3 text-purple-700">${this.comparisonResult.submission_b.student_name}</th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-slate-100">
                    <tr>
                      <td class="p-3 font-semibold text-slate-700">Overall Grade</td>
                      <td class="p-3 font-bold text-indigo-700">${this.comparisonResult.submission_a.overall_score}/100</td>
                      <td class="p-3 font-bold text-purple-700">${this.comparisonResult.submission_b.overall_score}/100</td>
                    </tr>
                    <tr>
                      <td class="p-3 font-semibold text-slate-700">Architecture</td>
                      <td class="p-3">${this.comparisonResult.submission_a.scores.architecture}%</td>
                      <td class="p-3">${this.comparisonResult.submission_b.scores.architecture}%</td>
                    </tr>
                    <tr>
                      <td class="p-3 font-semibold text-slate-700">SOLID Adherence</td>
                      <td class="p-3">${this.comparisonResult.submission_a.scores.solid_compliance}%</td>
                      <td class="p-3">${this.comparisonResult.submission_b.scores.solid_compliance}%</td>
                    </tr>
                    <tr>
                      <td class="p-3 font-semibold text-slate-700">Detected Patterns</td>
                      <td class="p-3">${this.comparisonResult.submission_a.design_patterns.join(', ')}</td>
                      <td class="p-3">${this.comparisonResult.submission_b.design_patterns.join(', ')}</td>
                    </tr>
                    <tr>
                      <td class="p-3 font-semibold text-slate-700">Code Smells</td>
                      <td class="p-3 text-rose-600">${this.comparisonResult.submission_a.code_smells.join('; ')}</td>
                      <td class="p-3 text-rose-600">${this.comparisonResult.submission_b.code_smells.join('; ')}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          ` : ''}
        </div>
      </div>
    `;

    this.attachEventListeners();
  }

  attachEventListeners() {
    this.container.querySelectorAll('.btn-select-sub').forEach(el => {
      el.addEventListener('click', (e) => {
        const id = e.currentTarget.getAttribute('data-id');
        this.selectSubmission(id);
      });
    });

    const compareForm = this.container.querySelector('#compare-repos-form');
    if (compareForm) {
      compareForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const idA = compareForm.id_a.value;
        const idB = compareForm.id_b.value;
        this.handleCompare(idA, idB);
      });
    }

    const analyzeForm = this.container.querySelector('#analyze-repo-form');
    if (analyzeForm) {
      analyzeForm.addEventListener('submit', (e) => this.handleAnalyzeNew(e));
    }
  }
}
