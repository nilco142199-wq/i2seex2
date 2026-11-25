/**
 * HomeworkReviewComponent – real homework deep review.
 *
 *  • A student (or the lecturer) uploads a project .zip or a public GitHub link.
 *  • The server counts real metrics, sends the code + the assignment requirements to Google Gemini and
 *    keeps only findings that point to files that really exist in the submission.
 *  • The lecturer compares two students side by side and sees which submissions have very similar code.
 *  • Without GEMINI_API_KEY only measured facts are shown – nothing is invented.
 *
 * Students see only the submissions uploaded from their own phone (ids kept in localStorage).
 */
class HomeworkReviewComponent {
  constructor(containerId, state) {
    this.container = document.getElementById(containerId);
    this.state = state;
    this.submissions = [];
    this.similarPairs = [];
    this.requirements = '';
    this.llm = null;
    this.selectedId = null;
    this.selected = null;
    this.comparison = null;
    this.compareIds = { a: '', b: '' };
    this.source = 'zip';
    this.upload = null;          // { percent, error, message }
    this.roster = [];
    this.editingRequirements = false;
    this.pollTimer = null;
  }

  // ------------------------------------------------------------------ helpers
  static esc(v) {
    return String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  get isLecturer() { return this.state.currentRole === 'lecturer'; }

  myIds() {
    try { return JSON.parse(AppState.storageGet('cs302_my_homework') || '[]'); } catch (e) { return []; }
  }
  rememberMine(id) {
    const ids = this.myIds();
    if (!ids.includes(id)) ids.push(id);
    AppState.storageSet('cs302_my_homework', JSON.stringify(ids.slice(-30)));
  }
  visibleSubmissions() {
    if (this.isLecturer) return this.submissions;
    const mine = this.myIds();
    return this.submissions.filter(s => mine.includes(s.submission_id));
  }

  // ------------------------------------------------------------------ data
  async init() {
    this.state.subscribe('role', () => { this.comparison = null; this.render(); });
    await this.fetchSubmissions();
    this.loadRoster();
    const first = this.visibleSubmissions()[0];
    if (first) await this.select(first.submission_id, false);
    this.render();
  }

  async loadRoster() {
    try {
      const res = await ApiClient.getAttendance();
      this.roster = ((res && res.students) || []).map(s => s.name).filter(Boolean);
      this.render();
    } catch (e) { /* the name field still works without suggestions */ }
  }

  async fetchSubmissions() {
    try {
      const res = await ApiClient.getReviews();
      this.submissions = res.submissions || [];
      this.similarPairs = res.similar_pairs || [];
      this.requirements = res.requirements || '';
      this.llm = res.llm || null;
    } catch (err) {
      console.error('Failed to load reviews:', err);
    }
    this.schedulePoll();
  }

  schedulePoll() {
    clearTimeout(this.pollTimer);
    const busy = this.submissions.some(s => s.status === 'processing');
    if (busy) this.pollTimer = setTimeout(() => this.refresh(), 3000);
  }

  async refresh() {
    await this.fetchSubmissions();
    if (this.selectedId) await this.select(this.selectedId, false);
    this.render();
  }

  async select(id, rerender = true) {
    try {
      const res = await ApiClient.getReviewDetail(id);
      this.selected = res.submission;
      this.selectedId = id;
    } catch (err) {
      this.selected = null;
    }
    if (rerender) this.render();
  }

  // ------------------------------------------------------------------ actions
  async submit(form) {
    const name = form.student_name.value.trim();
    const language = form.language.value;
    if (!name) return this.setUpload({ error: 'Write the student name first.' });
    this.setUpload({ percent: 0, message: 'Uploading…' });
    try {
      let res;
      if (this.source === 'zip') {
        const file = form.zip.files[0];
        if (!file) return this.setUpload({ error: 'Choose the homework .zip file.' });
        if (!/\.zip$/i.test(file.name)) return this.setUpload({ error: 'Please upload a .zip of the project folder.' });
        res = await ApiClient.uploadHomeworkZip(file, name, language, p => this.setUpload({ percent: p, message: `Uploading… ${p}%` }));
      } else {
        const url = form.repo_url.value.trim();
        if (!url) return this.setUpload({ error: 'Paste the GitHub repository link.' });
        res = await ApiClient.analyzeRepo(url, name, language);
      }
      const id = res.submission.submission_id;
      this.rememberMine(id);
      this.upload = null;
      this.clearFormOnce = true;
      await this.fetchSubmissions();
      await this.select(id, false);
      this.render();
    } catch (err) {
      this.setUpload({ error: err.message });
    }
  }

  setUpload(u) { this.upload = u; this.render(); }

  async saveRequirements(text) {
    try {
      const res = await ApiClient.setReviewRequirements(text);
      this.requirements = res.requirements;
      this.editingRequirements = false;
      this.reqMessage = 'Saved – new reviews use these requirements.';
    } catch (err) {
      this.reqMessage = err.message;
    }
    this.render();
  }

  async compare(a, b) {
    this.compareIds = { a, b };
    if (!a || !b || a === b) { this.comparison = { error: 'Choose two different submissions.' }; return this.render(); }
    this.comparison = { loading: true };
    this.render();
    try {
      this.comparison = await ApiClient.compareReviews(a, b);
    } catch (err) {
      this.comparison = { error: err.message };
    }
    this.render();
    const el = document.getElementById('hw-compare');
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // ------------------------------------------------------------------ render
  snapshotForm() {
    const f = this.container && this.container.querySelector('#hw-form');
    if (!f) return null;
    const focused = document.activeElement && f.contains(document.activeElement) ? document.activeElement.name : null;
    return { name: f.student_name.value, language: f.language.value, url: f.repo_url ? f.repo_url.value : null,
             files: f.zip && f.zip.files && f.zip.files.length ? f.zip.files : null, focused };
  }

  restoreForm(snap) {
    const f = this.container.querySelector('#hw-form');
    if (!f || !snap) return;
    f.student_name.value = snap.name;
    f.language.value = snap.language;
    if (f.repo_url && snap.url !== null) f.repo_url.value = snap.url;
    if (f.zip && snap.files) {
      try { f.zip.files = snap.files; const n = this.container.querySelector('#hw-file-name');
        if (n) n.textContent = `📎 ${snap.files[0].name} (${(snap.files[0].size / 1048576).toFixed(1)} MB)`; } catch (e) { /* old browsers */ }
    }
    if (snap.focused && f[snap.focused] && f[snap.focused].focus) f[snap.focused].focus();
  }

  render() {
    if (!this.container) return;
    const snap = this.snapshotForm();
    const E = HomeworkReviewComponent.esc;
    const subs = this.visibleSubmissions();
    const reviewed = this.submissions.filter(s => s.reviewed).length;
    const llmPill = this.llm && this.llm.enabled
      ? '<span class="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1 rounded-full bg-emerald-500/15 text-emerald-200 border border-emerald-300/30">🟢 Real AI · Google Gemini</span>'
      : '<span class="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1 rounded-full bg-amber-300/20 text-amber-100 border border-amber-200/30">⚪ No GEMINI_API_KEY – measured facts only</span>';

    this.container.innerHTML = `
      <div class="space-y-6">
        <section class="bg-gradient-to-r from-indigo-900 to-slate-900 text-white rounded-2xl p-6 sm:p-8">
          <div class="flex flex-wrap items-center gap-3 mb-4">${llmPill}
            ${this.isLecturer ? `<span class="text-xs text-indigo-200">${this.submissions.length} submitted · ${reviewed} reviewed by AI</span>` : ''}
          </div>
          <h2 class="text-2xl font-bold mb-2">Homework deep review</h2>
          <p class="text-indigo-100 text-sm leading-relaxed max-w-3xl">
            Upload the project as a <b>.zip</b> or paste a <b>public GitHub link</b>. The AI reads every file and reviews it against the
            assignment requirements: what is met or missing, SOLID, design patterns and concrete problems to fix.
            Every finding names the file and line it is based on, and findings that point to files not in the submission are removed.
            ${this.isLecturer ? 'You can compare any two students and see which submissions have very similar code.' : ''}
          </p>
        </section>

        <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div class="lg:col-span-2">${this.renderUploadForm()}</div>
          <div>${this.renderRequirements()}</div>
        </div>

        ${this.renderList(subs)}
        ${this.isLecturer ? this.renderSimilarity() : ''}
        ${this.renderDetail()}
        ${this.isLecturer ? this.renderCompare() : ''}
      </div>`;
    this.bind();
    if (!this.clearFormOnce) this.restoreForm(snap);
    this.clearFormOnce = false;
  }

  renderUploadForm() {
    const E = HomeworkReviewComponent.esc;
    const u = this.upload;
    const tab = (id, label) => `<button type="button" data-source="${id}" class="px-4 py-2 rounded-lg text-sm font-semibold ${this.source === id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'}">${label}</button>`;
    return `
      <form id="hw-form" class="bg-white rounded-2xl border border-slate-100 shadow-sm p-6 space-y-4" novalidate>
        <div class="flex flex-wrap items-center justify-between gap-3">
          <h3 class="font-bold text-slate-900">Submit homework for review</h3>
          <div class="inline-flex p-1 bg-slate-100 rounded-xl">${tab('zip', '📦 Upload .zip')}${tab('github', '🔗 GitHub link')}</div>
        </div>
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <label class="sm:col-span-2 block">
            <span class="text-sm font-semibold text-slate-700">Student name</span>
            <input name="student_name" list="hw-roster" autocomplete="off" required
                   class="mt-1 w-full px-3 py-2.5 rounded-xl border text-sm" placeholder="Start typing your name…">
            <datalist id="hw-roster">${this.roster.map(n => `<option value="${E(n)}">`).join('')}</datalist>
          </label>
          <label class="block">
            <span class="text-sm font-semibold text-slate-700">Review language</span>
            <select name="language" class="mt-1 w-full px-3 py-2.5 rounded-xl border text-sm bg-white">
              <option value="en">English</option><option value="he">עברית</option>
            </select>
          </label>
        </div>
        ${this.source === 'zip' ? `
          <label id="hw-drop" class="block border-2 border-dashed border-slate-300 rounded-xl p-6 text-center cursor-pointer hover:border-indigo-400 transition">
            <input type="file" name="zip" accept=".zip,application/zip" class="sr-only">
            <div class="text-3xl mb-1">📦</div>
            <div id="hw-file-name" class="text-sm font-semibold text-slate-700">Choose the project .zip or drop it here</div>
            <div class="text-xs text-slate-500 mt-1">Up to 30 MB · code and documents only (folders like node_modules, venv and .git are ignored)</div>
          </label>` : `
          <label class="block">
            <span class="text-sm font-semibold text-slate-700">Public GitHub repository</span>
            <input name="repo_url" type="url" inputmode="url" class="mt-1 w-full px-3 py-2.5 rounded-xl border text-sm font-mono" placeholder="https://github.com/user/repository">
          </label>`}
        ${u && u.error ? `<p class="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-xl px-3 py-2">⚠️ ${E(u.error)}</p>` : ''}
        ${u && !u.error ? `<div class="space-y-1"><div class="text-xs text-slate-600">${E(u.message || 'Uploading…')}</div>
          <div class="h-2 bg-slate-100 rounded-full overflow-hidden"><div class="h-full bg-indigo-600 bar-transition" style="width:${u.percent || 5}%"></div></div></div>` : ''}
        <div class="flex justify-end">
          <button type="submit" class="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-semibold text-sm" ${u && !u.error ? 'disabled' : ''}>
            🔍 Review my homework
          </button>
        </div>
      </form>`;
  }

  renderRequirements() {
    const E = HomeworkReviewComponent.esc;
    const msg = this.reqMessage ? `<p class="text-xs mt-2 ${/Saved/.test(this.reqMessage) ? 'text-emerald-700' : 'text-rose-700'}">${E(this.reqMessage)}</p>` : '';
    if (this.isLecturer && this.editingRequirements) {
      return `
        <div class="bg-white rounded-2xl border border-slate-100 shadow-sm p-6 h-full">
          <h3 class="font-bold text-slate-900 mb-2">Assignment requirements</h3>
          <textarea id="hw-req-text" rows="12" class="w-full px-3 py-2 rounded-xl border text-sm">${E(this.requirements)}</textarea>
          <div class="flex gap-2 justify-end mt-3">
            <button data-action="req-cancel" class="px-3 py-2 text-sm rounded-xl border">Cancel</button>
            <button data-action="req-save" class="px-4 py-2 text-sm rounded-xl bg-indigo-600 text-white font-semibold">Save requirements</button>
          </div>${msg}
        </div>`;
    }
    return `
      <div class="bg-white rounded-2xl border border-slate-100 shadow-sm p-6 h-full flex flex-col">
        <div class="flex items-center justify-between mb-2">
          <h3 class="font-bold text-slate-900">Reviewed against</h3>
          ${this.isLecturer ? '<button data-action="req-edit" class="text-xs font-semibold text-indigo-600 hover:text-indigo-800">Edit</button>' : ''}
        </div>
        <pre class="text-xs text-slate-600 whitespace-pre-wrap font-sans leading-relaxed overflow-auto max-h-64 flex-1">${E(this.requirements)}</pre>
        ${this.isLecturer ? '<p class="text-[11px] text-slate-400 mt-2">Paste the real assignment text here. Changing it is allowed only from the instructor computer (localhost).</p>' : ''}
        ${msg}
      </div>`;
  }

  statusBadge(s) {
    if (s.status === 'processing') return '<span class="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700"><span class="ai-spinner"></span> Reviewing</span>';
    if (s.status === 'failed') return '<span class="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-rose-50 text-rose-700">Failed</span>';
    if (typeof s.overall_score === 'number') {
      const c = s.overall_score >= 85 ? 'bg-emerald-50 text-emerald-700' : s.overall_score >= 70 ? 'bg-amber-50 text-amber-800' : 'bg-rose-50 text-rose-700';
      return `<span class="text-xs font-bold px-2 py-0.5 rounded-full ${c}">${s.overall_score}/100</span>`;
    }
    return '<span class="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">Metrics only</span>';
  }

  renderList(subs) {
    const E = HomeworkReviewComponent.esc;
    if (!subs.length) {
      return `<section class="bg-white rounded-2xl border border-slate-100 shadow-sm p-8 text-center text-sm text-slate-500">
        ${this.isLecturer ? 'No homework has been submitted yet. Students upload from this tab in Student Mode, or upload one yourself above.'
                          : 'You have not submitted homework from this phone yet. Upload it above to get a review.'}
      </section>`;
    }
    return `
      <section class="bg-white rounded-2xl border border-slate-100 shadow-sm p-6">
        <h3 class="font-bold text-slate-900 mb-4">${this.isLecturer ? `Submissions (${subs.length})` : 'My submissions'}</h3>
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          ${subs.map(s => `
            <button data-select="${E(s.submission_id)}" class="text-left p-4 rounded-xl border transition ${s.submission_id === this.selectedId ? 'border-indigo-500 bg-indigo-50/50' : 'border-slate-200 hover:border-indigo-300 bg-slate-50/40'}">
              <div class="flex items-start justify-between gap-2">
                <span class="font-semibold text-slate-900 text-sm">${E(s.student_name)}</span>${this.statusBadge(s)}
              </div>
              <div class="text-xs text-slate-500 font-mono mt-1 truncate">${s.source === 'github' ? '🔗' : '📦'} ${E(s.source_label)}</div>
              <div class="text-[11px] text-slate-400 mt-1">${E(s.uploaded_at)}${s.metrics && s.metrics.source_files ? ` · ${s.metrics.source_files} code files · ${s.metrics.code_lines} lines` : ''}</div>
            </button>`).join('')}
        </div>
      </section>`;
  }

  renderSimilarity() {
    const E = HomeworkReviewComponent.esc;
    if (this.submissions.length < 2) return '';
    const pairs = this.similarPairs;
    return `
      <section class="bg-white rounded-2xl border border-slate-100 shadow-sm p-6">
        <h3 class="font-bold text-slate-900">Similar code between students</h3>
        <p class="text-xs text-slate-500 mt-1 mb-4">Measured on the code itself (comments ignored, variable names don't matter). A high number is a reason to look, not proof of copying – shared starter code also counts.</p>
        ${pairs.length ? `<div class="space-y-2">${pairs.map(p => {
          const hot = p.similarity >= 60, warm = p.similarity >= 35;
          return `<button data-compare="${E(p.a)}|${E(p.b)}" class="w-full flex items-center gap-3 p-3 rounded-xl border border-slate-200 hover:border-indigo-300 text-left">
            <span class="text-sm font-semibold text-slate-800 w-56 shrink-0 truncate">${E(p.a_name)} ↔ ${E(p.b_name)}</span>
            <span class="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden"><span class="block h-full ${hot ? 'bg-rose-500' : warm ? 'bg-amber-400' : 'bg-slate-400'}" style="width:${p.similarity}%"></span></span>
            <span class="text-sm font-bold w-12 text-right ${hot ? 'text-rose-700' : 'text-slate-700'}">${p.similarity}%</span>
            <span class="text-xs text-indigo-600 font-semibold">Compare</span>
          </button>`; }).join('')}</div>`
        : '<p class="text-sm text-slate-500">No pair of submissions shares more than 15% of its code.</p>'}
      </section>`;
  }

  renderDetail() {
    const E = HomeworkReviewComponent.esc;
    const d = this.selected;
    if (!d) return '';
    const m = d.metrics || {};
    const r = d.review;
    const ev = (list) => (list || []).map(e => `<code class="text-[11px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-700">${E(e.file)}${e.line ? ':' + e.line : ''}</code>`).join(' ');
    const metric = (label, value) => `<div class="p-3 rounded-xl bg-slate-50 border border-slate-100"><div class="text-[11px] text-slate-500">${label}</div><div class="text-lg font-bold text-slate-900">${value}</div></div>`;

    let body = '';
    if (d.status === 'processing') {
      body = `<div class="flex items-center gap-3 p-4 rounded-xl bg-indigo-50 text-indigo-800 text-sm"><span class="ai-spinner"></span>${E(d.stage || 'Reviewing…')} This usually takes under a minute.</div>`;
    } else if (d.status === 'failed') {
      body = `<div class="p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-sm">⚠️ The review could not be completed. ${E(d.error)}</div>`;
    } else if (!r) {
      body = `<div class="p-4 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-sm">The AI review did not run because the server has no <code>GEMINI_API_KEY</code>. Only the measured facts above are shown – no scores or findings are made up.</div>`;
    } else {
      const scoreRow = (k, label) => {
        const v = (r.scores || {})[k];
        if (typeof v !== 'number') return '';
        return `<div><div class="flex justify-between text-xs mb-1"><span class="text-slate-600">${label}</span><span class="font-semibold">${v}</span></div>
          <div class="h-2 bg-slate-100 rounded-full overflow-hidden"><div class="h-full ${v >= 85 ? 'bg-emerald-500' : v >= 70 ? 'bg-amber-400' : 'bg-rose-500'}" style="width:${v}%"></div></div></div>`;
      };
      const reqIcon = { met: '✅', partial: '🟡', missing: '❌' };
      const solidIcon = { pass: '✅', warning: '🟡', fail: '❌', not_applicable: '➖' };
      const sev = { high: 'bg-rose-50 text-rose-700 border-rose-200', medium: 'bg-amber-50 text-amber-800 border-amber-200', low: 'bg-slate-50 text-slate-600 border-slate-200' };
      const reqs = r.requirements || [];
      const met = reqs.filter(q => q.status === 'met' && q.verified !== false).length;   // unverified "met" does not count
      body = `
        <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div class="space-y-4">
            <div class="text-center p-5 rounded-2xl bg-slate-50 border border-slate-100">
              <div class="text-xs text-slate-500">Overall</div>
              <div class="text-5xl font-extrabold text-slate-900">${r.overall_score}<span class="text-lg text-slate-400">/100</span></div>
              <div class="text-xs text-slate-500 mt-1">${met}/${reqs.length} requirements met (with evidence)</div>
            </div>
            <div class="space-y-3">
              ${scoreRow('requirements', 'Requirements')}${scoreRow('oop_design', 'OOP design')}${scoreRow('solid', 'SOLID')}
              ${scoreRow('code_quality', 'Code quality')}${scoreRow('testing', 'Testing')}${scoreRow('documentation', 'Documentation')}
            </div>
          </div>
          <div class="lg:col-span-2 space-y-4">
            <p class="text-sm text-slate-700 leading-relaxed">${E(r.summary)}</p>
            <p class="text-xs rounded-xl px-3 py-2 border ${d.removed_claims >= 3 ? 'text-amber-900 bg-amber-50 border-amber-200' : 'text-emerald-800 bg-emerald-50 border-emerald-200'}">
              ${d.removed_claims >= 3 ? '<b>Treat this review with caution:</b> the AI cited several files that are not in the submission, so its scores may be too high. ' : ''}
              🔎 Checked against the files: every finding below names a file that is in the submission.
              ${d.removed_claims ? `${d.removed_claims} AI finding${d.removed_claims === 1 ? ' was' : 's were'} removed because ${d.removed_claims === 1 ? 'it' : 'they'} pointed to files that do not exist.` : 'No finding had to be removed.'}
              ${(d.omitted_files || []).length ? ` ${d.omitted_files.length} long file(s) did not fit and were not read: ${E(d.omitted_files.slice(0, 5).join(', '))}${d.omitted_files.length > 5 ? '…' : ''}.` : ''}
            </p>
            ${(r.strengths || []).length ? `<div><h4 class="text-sm font-bold text-slate-900 mb-2">Strengths</h4><ul class="space-y-1.5">${r.strengths.map(s => `<li class="text-sm text-slate-700">✓ ${E(s.text)} ${ev(s.evidence)}</li>`).join('')}</ul></div>` : ''}
          </div>
        </div>

        <div class="mt-6">
          <h4 class="text-sm font-bold text-slate-900 mb-2">Assignment requirements</h4>
          <div class="divide-y divide-slate-100 border border-slate-100 rounded-xl">
            ${reqs.map(q => `<div class="p-3 flex gap-3">
              <span class="text-lg leading-none">${reqIcon[q.status] || '•'}</span>
              <div class="flex-1"><div class="text-sm font-semibold text-slate-800">${E(q.requirement)}
                ${q.verified === false ? '<span class="ml-1 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-amber-100 text-amber-800">not verified – cited file not found</span>' : ''}</div>
                <p class="text-xs text-slate-600 mt-0.5">${E(q.comment)}</p><div class="mt-1">${ev(q.evidence)}</div></div></div>`).join('')}
          </div>
        </div>

        <div class="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
          <div>
            <h4 class="text-sm font-bold text-slate-900 mb-2">SOLID</h4>
            <div class="space-y-2">${(r.solid || []).map(q => `<div class="p-3 rounded-xl border border-slate-100">
              <div class="text-sm font-semibold text-slate-800">${solidIcon[q.status] || '•'} ${E(q.principle)}</div>
              <p class="text-xs text-slate-600 mt-0.5">${E(q.comment)}</p><div class="mt-1">${ev(q.evidence)}</div></div>`).join('') || '<p class="text-sm text-slate-500">—</p>'}</div>
          </div>
          <div>
            <h4 class="text-sm font-bold text-slate-900 mb-2">Design patterns found in the code</h4>
            <div class="space-y-2">${(r.design_patterns || []).map(p => `<div class="p-3 rounded-xl border border-slate-100">
              <div class="text-sm font-semibold text-slate-800">${E(p.name)}</div>
              <p class="text-xs text-slate-600 mt-0.5">${E(p.explanation)}</p><div class="mt-1">${ev(p.evidence)}</div></div>`).join('') || '<p class="text-sm text-slate-500">No design pattern was found in the code.</p>'}</div>
          </div>
        </div>

        <div class="mt-6">
          <h4 class="text-sm font-bold text-slate-900 mb-2">What to fix</h4>
          <div class="space-y-2">${(r.issues || []).map(i => `<div class="p-3 rounded-xl border ${sev[i.severity] || sev.low}">
            <div class="flex flex-wrap items-center gap-2 text-sm font-semibold"><span class="uppercase text-[10px] tracking-wide">${E(i.severity)}</span>
              <code class="text-[11px] px-1.5 py-0.5 rounded bg-white/70">${E(i.file)}${i.line ? ':' + i.line : ''}</code></div>
            <p class="text-sm mt-1">${E(i.problem)}</p><p class="text-xs mt-1 opacity-90"><b>Fix:</b> ${E(i.fix)}</p></div>`).join('') || '<p class="text-sm text-slate-500">No problems were reported.</p>'}</div>
        </div>`;
    }

    const langs = Object.entries(m.languages || {}).map(([k, v]) => `${E(k)} ${v}`).join(' · ');
    return `
      <section class="bg-white rounded-2xl border border-slate-100 shadow-sm p-6">
        <div class="flex flex-wrap items-start justify-between gap-3 mb-4">
          <div>
            <h3 class="text-lg font-bold text-slate-900">${E(d.student_name)}</h3>
            <div class="text-xs text-slate-500 font-mono">${d.source === 'github' ? '🔗' : '📦'} ${E(d.source_label)} · ${E(d.uploaded_at)}</div>
          </div>
          ${d.ai_model ? `<span class="text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-full px-3 py-1">🤖 Reviewed by ${E(d.ai_model)}</span>` : ''}
        </div>
        ${m.files ? `<div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-2">
          ${metric('Code files', m.source_files)}${metric('Lines of code', m.code_lines)}${metric('Classes', m.classes)}
          ${metric('Functions', m.functions)}${metric('Test files', m.test_files)}${metric('README', m.has_readme ? 'Yes' : 'No')}
        </div>
        <p class="text-[11px] text-slate-400 mb-5">Counted from the files${langs ? ' · ' + langs + ' lines' : ''}${m.skipped_files ? ` · ${m.skipped_files} non-code or ignored files skipped` : ''}</p>` : ''}
        ${body}
      </section>`;
  }

  renderCompare() {
    const E = HomeworkReviewComponent.esc;
    const subs = this.submissions.filter(s => s.status !== 'processing');
    if (subs.length < 2) return '';
    const opts = (sel) => subs.map(s => `<option value="${E(s.submission_id)}" ${s.submission_id === sel ? 'selected' : ''}>${E(s.student_name)} – ${E(s.source_label)}</option>`).join('');
    const c = this.comparison;
    let result = '';
    if (c && c.loading) result = '<div class="flex items-center gap-2 text-sm text-indigo-700"><span class="ai-spinner"></span> Comparing…</div>';
    else if (c && c.error) result = `<p class="text-sm text-rose-700">⚠️ ${E(c.error)}</p>`;
    else if (c && c.success) {
      const a = c.submission_a, b = c.submission_b, k = c.comparison;
      const ra = a.review || {}, rb = b.review || {};
      const row = (label, va, vb, higherIsBetter = true) => {
        const na = typeof va === 'number', nb = typeof vb === 'number';
        const win = na && nb && va !== vb ? ((va > vb) === higherIsBetter ? 'a' : 'b') : '';
        const cell = (v, w) => `<td class="p-2 text-center ${w ? 'font-bold text-emerald-700 bg-emerald-50' : ''}">${v === undefined || v === null ? '—' : E(v)}</td>`;
        return `<tr class="border-t border-slate-100"><td class="p-2 text-slate-600">${label}</td>${cell(va, win === 'a')}${cell(vb, win === 'b')}</tr>`;
      };
      const metCount = (r) => r.requirements ? `${r.requirements.filter(q => q.status === 'met' && q.verified !== false).length}/${r.requirements.length}` : null;
      const sa = ra.scores || {}, sb = rb.scores || {};
      const simHot = k.similarity >= 60;
      result = `
        <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div class="lg:col-span-2 overflow-x-auto">
            <table class="w-full text-sm">
              <thead><tr><th></th><th class="p-2 text-center">${E(a.student_name)}</th><th class="p-2 text-center">${E(b.student_name)}</th></tr></thead>
              <tbody>
                ${row('Overall', ra.overall_score, rb.overall_score)}
                ${row('Requirements met', metCount(ra), metCount(rb))}
                ${row('Requirements', sa.requirements, sb.requirements)}${row('OOP design', sa.oop_design, sb.oop_design)}
                ${row('SOLID', sa.solid, sb.solid)}${row('Code quality', sa.code_quality, sb.code_quality)}
                ${row('Testing', sa.testing, sb.testing)}${row('Documentation', sa.documentation, sb.documentation)}
                ${row('Design patterns', (ra.design_patterns || []).map(p => p.name).join(', ') || (a.review ? 'none' : null), (rb.design_patterns || []).map(p => p.name).join(', ') || (b.review ? 'none' : null))}
                ${row('Code files', a.metrics.source_files, b.metrics.source_files)}${row('Lines of code', a.metrics.code_lines, b.metrics.code_lines)}
                ${row('Classes', a.metrics.classes, b.metrics.classes)}${row('Test files', a.metrics.test_files, b.metrics.test_files)}
              </tbody>
            </table>
            ${!(a.review && b.review) ? '<p class="text-xs text-slate-500 mt-2">Scores appear only for submissions the AI has reviewed.</p>' : ''}
          </div>
          <div class="space-y-4">
            <div class="p-4 rounded-xl border ${simHot ? 'border-rose-200 bg-rose-50' : 'border-slate-100 bg-slate-50'}">
              <div class="text-xs text-slate-500">Code similarity</div>
              <div class="text-3xl font-extrabold ${simHot ? 'text-rose-700' : 'text-slate-900'}">${k.similarity}%</div>
              ${(k.matching_files || []).length ? `<div class="mt-2 space-y-1">${k.matching_files.map(f => `<div class="text-[11px] font-mono text-slate-700">${E(f.file_a)} ↔ ${E(f.file_b)} <b>${f.overlap}%</b></div>`).join('')}</div>` : '<p class="text-xs text-slate-500 mt-1">No file pair shares much code.</p>'}
            </div>
            ${k.ai_comparison ? `<div class="p-4 rounded-xl border border-indigo-100 bg-indigo-50/50"><div class="text-xs font-semibold text-indigo-800 mb-1">🤖 AI comparison</div><p class="text-sm text-slate-700 leading-relaxed">${E(k.ai_comparison)}</p></div>` : ''}
            ${k.ai_error ? `<p class="text-xs text-rose-700">AI comparison failed: ${E(k.ai_error)}</p>` : ''}
          </div>
        </div>`;
    }
    return `
      <section id="hw-compare" class="bg-white rounded-2xl border border-slate-100 shadow-sm p-6">
        <h3 class="font-bold text-slate-900 mb-4">Compare two students</h3>
        <div class="flex flex-wrap items-end gap-3 mb-5">
          <select id="hw-cmp-a" class="px-3 py-2 rounded-xl border text-sm bg-white min-w-[14rem]"><option value="">Choose a student…</option>${opts(this.compareIds.a)}</select>
          <span class="text-slate-400">vs</span>
          <select id="hw-cmp-b" class="px-3 py-2 rounded-xl border text-sm bg-white min-w-[14rem]"><option value="">Choose a student…</option>${opts(this.compareIds.b)}</select>
          <button data-action="compare" class="px-4 py-2 rounded-xl bg-indigo-600 text-white text-sm font-semibold">Compare</button>
        </div>
        ${result}
      </section>`;
  }

  // ------------------------------------------------------------------ events
  bind() {
    const root = this.container;
    root.querySelectorAll('[data-source]').forEach(btn => btn.addEventListener('click', () => {
      this.source = btn.dataset.source; this.upload = null; this.render();
    }));
    const form = root.querySelector('#hw-form');
    if (form) {
      form.addEventListener('submit', (e) => { e.preventDefault(); this.submit(form); });
      const myName = this.myName();
      if (myName && !form.student_name.value) form.student_name.value = myName;
      const input = form.querySelector('input[type=file]');
      const drop = root.querySelector('#hw-drop');
      const showName = () => { const f = input.files[0]; root.querySelector('#hw-file-name').textContent = f ? `📎 ${f.name} (${(f.size / 1048576).toFixed(1)} MB)` : 'Choose the project .zip or drop it here'; };
      if (input) input.addEventListener('change', showName);
      if (drop) {
        ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('dropzone-active'); }));
        ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('dropzone-active'); }));
        drop.addEventListener('drop', (e) => { if (e.dataTransfer.files.length) { input.files = e.dataTransfer.files; showName(); } });
      }
    }
    root.querySelectorAll('[data-select]').forEach(btn => btn.addEventListener('click', () => this.select(btn.dataset.select)));
    root.querySelectorAll('[data-compare]').forEach(btn => btn.addEventListener('click', () => {
      const [a, b] = btn.dataset.compare.split('|'); this.compare(a, b);
    }));
    const on = (sel, fn) => { const el = root.querySelector(sel); if (el) el.addEventListener('click', fn); };
    on('[data-action="compare"]', () => this.compare(root.querySelector('#hw-cmp-a').value, root.querySelector('#hw-cmp-b').value));
    on('[data-action="req-edit"]', () => { this.editingRequirements = true; this.reqMessage = ''; this.render(); });
    on('[data-action="req-cancel"]', () => { this.editingRequirements = false; this.render(); });
    on('[data-action="req-save"]', () => this.saveRequirements(root.querySelector('#hw-req-text').value));
  }

  /** Student mode: pre-fill the name of the student this phone checked in as. */
  myName() {
    if (this.isLecturer) return '';
    const id = AppState.storageGet('cs302_student_id');
    const a = (typeof app !== 'undefined' && app) ? app : null;
    if (!id || !a || !a.attendanceComp || !a.attendanceComp.data) return '';
    const st = (a.attendanceComp.data.students || []).find(s => s.student_id === id);
    return st ? st.name : '';
  }
}
