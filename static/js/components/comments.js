/**
 * CommentsComponent
 * Manages live classroom feedback, questions, offline suggestions, and upvoting.
 */
class CommentsComponent {
  constructor(containerId, state) {
    this.container = document.getElementById(containerId);
    this.state = state;
    this.comments = [];
    this.currentFilter = 'all';
  }

  async init() {
    this.state.subscribe('role', () => this.render());
    await this.fetchComments();
    this.render();
  }

  async fetchComments() {
    try {
      const res = await ApiClient.getFeedback(this.currentFilter);
      this.comments = res.comments || [];
    } catch (err) {
      console.error('Failed to load comments:', err);
    }
  }

  async handlePostComment(e) {
    e.preventDefault();
    const form = e.target;
    const content = form.content.value.trim();
    const category = form.category.value;
    const isAnonymous = form.is_anonymous.checked;

    if (!content) return;

    try {
      await ApiClient.postFeedback({
        content,
        authorName: isAnonymous ? 'Anonymous' : 'Student Contributor',
        isAnonymous,
        category
      });
      form.reset();
      await this.fetchComments();
      this.render();
    } catch (err) {
      alert('Error posting feedback: ' + err.message);
    }
  }

  async handleUpvote(commentId) {
    try {
      await ApiClient.upvoteFeedback(commentId);
      await this.fetchComments();
      this.render();
    } catch (err) {
      console.error('Error upvoting:', err);
    }
  }

  async handleToggleResolve(commentId) {
    try {
      await ApiClient.resolveFeedback(commentId);
      await this.fetchComments();
      this.render();
    } catch (err) {
      console.error('Error toggling resolve:', err);
    }
  }

  render() {
    if (!this.container) return;

    const isLecturer = this.state.currentRole === 'lecturer';

    this.container.innerHTML = `
      <div class="space-y-6">
        <!-- New Comment Input Box -->
        <div class="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm">
          <h3 class="font-bold text-slate-800 text-sm mb-3 flex items-center gap-2">
            <svg class="w-4 h-4 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"></path></svg>
            Ask a Question or Leave Live / Offline Feedback
          </h3>
          <form id="comment-form" class="space-y-4">
            <div>
              <textarea name="content" rows="3" required placeholder="Type your question or suggestion here (e.g. 'Can we review the Strategy pattern UML diagram again?')..." class="w-full text-xs p-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition"></textarea>
            </div>
            <div class="flex flex-wrap items-center justify-between gap-3">
              <div class="flex items-center gap-4">
                <select name="category" class="text-xs bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 font-medium text-slate-700 focus:outline-none">
                  <option value="question">❓ Live Question</option>
                  <option value="feedback">💡 Lecture Feedback</option>
                  <option value="suggestion">🚀 Course Suggestion</option>
                  <option value="offline">📝 Offline Homework Inquiry</option>
                </select>
                <label class="inline-flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer">
                  <input type="checkbox" name="is_anonymous" class="rounded text-indigo-600 focus:ring-indigo-500">
                  <span>Post Anonymously</span>
                </label>
              </div>
              <button type="submit" class="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-semibold text-xs transition shadow-sm inline-flex items-center gap-1.5">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"></path></svg>
                Submit Feedback
              </button>
            </div>
          </form>
        </div>

        <!-- Filter Bar -->
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-2">
            ${['all', 'question', 'feedback', 'offline'].map(cat => `
              <button data-cat="${cat}" class="btn-filter-cat px-3 py-1.5 rounded-xl text-xs font-medium transition ${this.currentFilter === cat ? 'bg-indigo-600 text-white shadow-sm' : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'}">
                ${cat === 'all' ? 'All Comments' : cat === 'question' ? 'Questions' : cat === 'feedback' ? 'Feedback' : 'Offline'}
              </button>
            `).join('')}
          </div>
          <button id="btn-refresh-comments" class="text-xs text-indigo-600 hover:text-indigo-800 font-semibold inline-flex items-center gap-1">
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path></svg>
            Refresh Stream
          </button>
        </div>

        <!-- Comments Feed -->
        <div class="space-y-3">
          ${this.comments.length === 0 ? `
            <div class="bg-white p-12 text-center rounded-2xl border border-slate-100 text-slate-400 text-xs">
              No comments found in this category. Be the first to share your thoughts!
            </div>
          ` : this.comments.map(c => `
            <div class="bg-white p-5 rounded-2xl border ${c.is_resolved ? 'border-emerald-100 bg-emerald-50/20' : 'border-slate-100'} shadow-sm transition hover:border-slate-200">
              <div class="flex items-start justify-between gap-4">
                <div class="space-y-2 flex-1">
                  <div class="flex items-center gap-2 flex-wrap">
                    <span class="font-bold text-slate-800 text-xs">${c.author_name}</span>
                    <span class="text-[11px] text-slate-400 font-mono">${c.timestamp}</span>
                    <span class="px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider ${
                      c.category === 'question' ? 'bg-amber-50 text-amber-700 border border-amber-100' :
                      c.category === 'feedback' ? 'bg-sky-50 text-sky-700 border border-sky-100' :
                      c.category === 'offline' ? 'bg-purple-50 text-purple-700 border border-purple-100' :
                      'bg-slate-50 text-slate-700 border border-slate-100'
                    }">${c.category}</span>
                    ${c.is_resolved ? `
                      <span class="px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-100 text-emerald-800">
                        ✓ Resolved / Answered
                      </span>
                    ` : ''}
                  </div>
                  <p class="text-xs text-slate-700 leading-relaxed font-normal">${c.content}</p>
                </div>

                <div class="flex flex-col items-end gap-2">
                  <button data-id="${c.id}" class="btn-upvote inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-200 hover:border-indigo-300 hover:bg-indigo-50 text-slate-600 hover:text-indigo-600 text-xs font-semibold transition">
                    <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 15l7-7 7 7"></path></svg>
                    <span>${c.upvotes}</span>
                  </button>

                  <button data-id="${c.id}" class="btn-resolve text-[11px] font-medium text-slate-400 hover:text-emerald-600 transition">
                    ${c.is_resolved ? 'Re-open' : 'Mark Resolved'}
                  </button>
                </div>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `;

    this.attachEventListeners();
  }

  attachEventListeners() {
    const form = this.container.querySelector('#comment-form');
    if (form) {
      form.addEventListener('submit', (e) => this.handlePostComment(e));
    }

    const refreshBtn = this.container.querySelector('#btn-refresh-comments');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', async () => {
        await this.fetchComments();
        this.render();
      });
    }

    this.container.querySelectorAll('.btn-filter-cat').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        this.currentFilter = e.currentTarget.getAttribute('data-cat');
        await this.fetchComments();
        this.render();
      });
    });

    this.container.querySelectorAll('.btn-upvote').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const id = e.currentTarget.getAttribute('data-id');
        this.handleUpvote(id);
      });
    });

    this.container.querySelectorAll('.btn-resolve').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const id = e.currentTarget.getAttribute('data-id');
        this.handleToggleResolve(id);
      });
    });
  }
}
