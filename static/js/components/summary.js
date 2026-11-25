/**
 * SummaryComponent
 * Class Video Upload & Multi-Modal AI Summarization Suite.
 * - Allows instructors to upload lecture recordings (.mp4, .webm, .mov).
 * - Real pipeline: the recording is uploaded to the server, which sends it to Google Gemini
 *   (audio + picture) and stores the structured summary. Without GEMINI_API_KEY the server runs
 *   in clearly-labelled demo mode (simulated text, recording not analysed).
 * - Extracts timeline chapters, executive summaries, takeaways, action items, and transcripts.
 * - Interactive timestamped Q&A assistant for students and instructors.
 */
class SummaryComponent {
  constructor(containerId, state) {
    this.container = document.getElementById(containerId);
    this.state = state;
    this.videos = [];
    this.selectedVideo = null;
    this.isProcessing = false;
    this.qaHistory = [];
    this.llm = null;              // { enabled, provider, models, hint } from the server
    this.upload = null;           // { phase: uploading|processing|failed, percent, stage, error, videoId }
    this.localVideoUrls = {};     // video_id -> blob URL of a file uploaded in this tab (real player)
  }

  /** Escapes every string in an object – model output is shown as text, never as HTML. */
  static escapeDeep(value) {
    if (typeof value === 'string') {
      return value.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
    }
    if (Array.isArray(value)) return value.map(v => SummaryComponent.escapeDeep(v));
    if (value && typeof value === 'object') {
      const out = {};
      for (const [k, v] of Object.entries(value)) out[k] = SummaryComponent.escapeDeep(v);
      return out;
    }
    return value;
  }

  /** "1:02:03" / "12:45" → seconds */
  static toSeconds(ts) {
    const parts = String(ts || '').split(':').map(n => parseInt(n, 10));
    if (!parts.length || parts.some(isNaN)) return 0;
    return parts.reduce((acc, n) => acc * 60 + n, 0);
  }

  async init() {
    this.state.subscribe('role', () => this.render());
    await this.fetchVideos();
    if (this.videos.length > 0) {
      this.selectedVideo = this.videos[0];
    }
    this.render();
  }

  async fetchVideos() {
    try {
      const res = await ApiClient.getVideoList();
      this.videos = SummaryComponent.escapeDeep(res.videos || []);
      this.llm = res.llm || null;
    } catch (err) {
      console.error('Failed to load videos:', err);
    }
  }

  async selectVideo(videoId) {
    try {
      const res = await ApiClient.getVideoDetail(videoId);
      this.selectedVideo = SummaryComponent.escapeDeep(res.video);
      this.qaHistory = [];
      this.render();
    } catch (err) {
      console.error('Failed to load video detail:', err);
    }
  }

  /** Demo without a file (only offered when no API key is set): clearly-labelled simulated summary. */
  async handleDemoUpload() {
    try {
      const res = await ApiClient.uploadVideo({
        filename: 'Demo_Lecture.mp4', fileSizeMb: 0, title: 'Demo lecture (simulated)', topic: ''
      });
      await this.fetchVideos();
      this.selectedVideo = SummaryComponent.escapeDeep(res.video);
      this.render();
    } catch (err) {
      alert('Demo failed: ' + err.message);
    }
  }

  /** Real upload: file → server → Gemini. Shows upload %, then the server's live processing stage. */
  async handleRealUpload(file, title, topic, language) {
    if (!file) {
      this.upload = { phase: 'failed', error: 'Choose a video file first (MP4, WebM or MOV).' };
      this.render();
      return;
    }
    if (file.size > 2 * 1024 ** 3) {
      this.upload = { phase: 'failed', error: 'The file is larger than 2 GB (Gemini free-tier limit). Compress or cut it first.' };
      this.render();
      return;
    }
    this.isProcessing = true;
    this.upload = { phase: 'uploading', percent: 0, stage: `Uploading ${file.name} to the server…` };
    this.render();
    try {
      const res = await ApiClient.uploadVideoFile(file, { title, topic, language }, (pct) => {
        this.upload = { ...this.upload, percent: pct };
        const bar = this.container.querySelector('#upload-progress-bar');
        const label = this.container.querySelector('#upload-progress-label');
        if (bar) bar.style.width = pct + '%';
        if (label) label.textContent = pct + '%';
      });
      const video = res.video;
      this.localVideoUrls[video.video_id] = URL.createObjectURL(file); // play the real file in this tab
      if (video.status !== 'processing') { // demo mode (no key) – finished immediately
        this.isProcessing = false;
        this.upload = null;
        await this.fetchVideos();
        this.selectedVideo = SummaryComponent.escapeDeep(video);
        this.render();
        return;
      }
      this.upload = { phase: 'processing', videoId: video.video_id, stage: video.stage, startedAt: Date.now() };
      await this.fetchVideos();
      this.render();
      this.pollJob(video.video_id);
    } catch (err) {
      this.isProcessing = false;
      this.upload = { phase: 'failed', error: err.message };
      this.render();
    }
  }

  /** Polls the server every 3 s until Gemini has finished (or failed). */
  async pollJob(videoId) {
    try {
      const res = await ApiClient.getVideoDetail(videoId);
      const v = res.video;
      if (v.status === 'processing') {
        this.upload = { ...this.upload, stage: v.stage };
        const stageEl = this.container.querySelector('#upload-stage');
        const timeEl = this.container.querySelector('#upload-elapsed');
        if (stageEl) stageEl.textContent = v.stage;
        if (timeEl) timeEl.textContent = Math.round((Date.now() - this.upload.startedAt) / 1000) + 's';
        setTimeout(() => this.pollJob(videoId), 3000);
        return;
      }
      this.isProcessing = false;
      if (v.status === 'failed') {
        this.upload = { phase: 'failed', error: v.error || 'Processing failed.' };
      } else {
        this.upload = null;
        this.selectedVideo = SummaryComponent.escapeDeep(v);
      }
      await this.fetchVideos();
      this.render();
    } catch (err) {
      setTimeout(() => this.pollJob(videoId), 5000); // transient network error – keep trying
    }
  }

  /** Seeks the real player (if this tab has the file) to a chapter timestamp. */
  seekTo(ts) {
    const player = this.container.querySelector('#lecture-player');
    if (player) {
      player.currentTime = SummaryComponent.toSeconds(ts);
      player.play().catch(() => {});
      player.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  async handleAskQuestion(e) {
    e.preventDefault();
    if (!this.selectedVideo) return;
    const input = e.target.question;
    const q = input.value.trim();
    if (!q) return;

    try {
      this.qaPending = true;
      this.render();
      const res = await ApiClient.askVideoQuestion(this.selectedVideo.video_id, q);
      this.qaPending = false;
      this.qaHistory.unshift(SummaryComponent.escapeDeep(res));
      input.value = '';
      this.render();
    } catch (err) {
      this.qaPending = false;
      alert('Q&A error: ' + err.message);
    }
  }

  render() {
    if (!this.container) return;

    const vid = this.selectedVideo;

    this.container.innerHTML = `
      <div class="space-y-6">
        <!-- Top Banner -->
        <div class="bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 text-white p-7 rounded-3xl shadow-lg relative overflow-hidden">
          <div class="absolute -right-10 -bottom-10 w-48 h-48 bg-indigo-500/10 rounded-full blur-2xl"></div>

          <div class="flex flex-wrap items-center justify-between gap-4 border-b border-white/10 pb-5">
            <div class="flex items-center gap-3">
              <span class="px-3 py-1 rounded-full text-xs font-semibold bg-indigo-500/20 text-indigo-300 border border-indigo-400/30 flex items-center gap-1.5">
                <span class="w-2 h-2 rounded-full bg-emerald-400 pulse-dot"></span>
                Multi-Modal Video LLM Suite
              </span>
              ${this.llm && this.llm.enabled
                ? `<span class="text-xs font-semibold px-2.5 py-1 rounded-full bg-emerald-500/20 text-emerald-200 border border-emerald-400/30">🟢 Real AI · ${this.llm.provider}</span>`
                : `<span class="text-xs font-semibold px-2.5 py-1 rounded-full bg-amber-500/20 text-amber-200 border border-amber-400/30">⚪ Demo mode – no GEMINI_API_KEY</span>`}
            </div>
            <div class="flex items-center gap-4 text-xs text-slate-300">
              <span>📹 Total Processed: <strong>${this.videos.length} Lectures</strong></span>
              ${vid && typeof vid.engagement_score === 'number' && vid.simulated ? `<span class="bg-emerald-500/20 text-emerald-300 px-2.5 py-1 rounded-full font-bold">Engagement: ${vid.engagement_score}%</span>` : ''}
            </div>
          </div>

          <div class="mt-5">
            <h1 class="text-xl md:text-2xl font-bold tracking-tight text-white mb-2">
              Class Video Upload & AI Summarization
            </h1>
            <p class="text-xs md:text-sm text-slate-300 leading-relaxed max-w-4xl font-normal">
              Upload a lecture recording (.mp4, .webm, .mov). The server sends it to <strong>Google Gemini</strong>, which watches <em>and</em> listens to the whole lecture and returns an executive summary, timestamped chapters, key takeaways, action items and quotes — then answers questions about the lecture.
              ${this.llm && !this.llm.enabled ? `<br><span class="text-amber-200">${this.llm.hint}</span>` : ''}
            </p>
          </div>
        </div>

        <!-- Video Upload & Processing Section -->
        <div class="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm space-y-5">
          <div class="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
            <div>
              <h3 class="font-bold text-slate-800 text-sm flex items-center gap-2">
                <svg class="w-4 h-4 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"></path></svg>
                Upload Class Recording (.mp4, .webm, .mov)
              </h3>
              <p class="text-xs text-slate-500">Choose or drop a recording — it is analysed by the AI model and summarised.</p>
            </div>
            ${this.llm && !this.llm.enabled ? `
            <button id="btn-quick-demo-upload" class="px-4 py-2 bg-amber-50 hover:bg-amber-100 text-amber-800 font-bold text-xs rounded-xl transition inline-flex items-center gap-1.5">
              <span>🧪</span> Demo without a file (simulated)
            </button>` : ''}
          </div>

          <!-- Upload Form / Dropzone -->
          <form id="video-upload-form" class="space-y-4">
            <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label class="block text-xs font-semibold text-slate-700 mb-1">Lecture Title (Optional)</label>
                <input type="text" name="title" placeholder="e.g. Lecture 09: Architectural Patterns & Decoupled Event Loops" class="w-full p-2.5 border rounded-xl text-xs font-medium focus:ring-2 focus:ring-indigo-500">
              </div>
              <div>
                <label class="block text-xs font-semibold text-slate-700 mb-1">Primary Lecture Topic</label>
                <input type="text" name="topic" placeholder="e.g. Observer Pattern & Loose Coupling" class="w-full p-2.5 border rounded-xl text-xs font-medium focus:ring-2 focus:ring-indigo-500">
              </div>
              <div>
                <label class="block text-xs font-semibold text-slate-700 mb-1">Summary language</label>
                <select name="language" class="w-full p-2.5 border rounded-xl text-xs font-medium focus:ring-2 focus:ring-indigo-500">
                  <option value="auto">Same as the lecture</option>
                  <option value="he">עברית (Hebrew)</option>
                  <option value="en">English</option>
                </select>
              </div>
            </div>

            <!-- Drag & Drop Zone -->
            <div id="video-dropzone" class="border-2 border-dashed border-slate-200 hover:border-indigo-400 rounded-2xl p-6 text-center cursor-pointer transition bg-slate-50/50">
              <input type="file" id="video-file-input" accept="video/mp4,video/webm,video/quicktime,video/*" class="hidden">
              <div class="space-y-2">
                <span class="text-3xl block">🎥</span>
                <div class="text-xs font-bold text-slate-700" id="selected-file-label">
                  Click to select a video file or drag and drop here
                </div>
                <div class="text-[11px] text-slate-400">
                  MP4, WebM, MOV · up to 2 GB · large files: open the instructor page on <code>localhost</code> (the public tunnel limits upload size)
                </div>
              </div>
            </div>

            <div class="flex justify-end">
              <button type="submit" class="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold text-xs transition shadow-sm flex items-center gap-2">
                <span>🚀</span> Upload &amp; Summarise with AI
              </button>
            </div>
          </form>

          <!-- Real upload / processing status -->
          ${this.upload ? (this.upload.phase === 'failed' ? `
            <div class="p-4 rounded-2xl bg-rose-50 border border-rose-200 text-xs text-rose-900">
              <strong>⚠️ Could not summarise the recording.</strong> ${SummaryComponent.escapeDeep(this.upload.error || '')}
            </div>
          ` : `
            <div class="p-5 rounded-2xl bg-indigo-50 border border-indigo-200 space-y-3 text-xs">
              <div class="flex items-center justify-between font-bold text-indigo-900">
                <span class="flex items-center gap-2"><span class="ai-spinner"></span>
                  ${this.upload.phase === 'uploading' ? '1 / 2 · Uploading the recording' : '2 / 2 · AI is analysing the lecture'}
                </span>
                <span id="${this.upload.phase === 'uploading' ? 'upload-progress-label' : 'upload-elapsed'}" class="font-mono">${this.upload.phase === 'uploading' ? (this.upload.percent || 0) + '%' : ''}</span>
              </div>
              <div class="w-full bg-indigo-200 rounded-full h-2 overflow-hidden">
                ${this.upload.phase === 'uploading'
                  ? `<div id="upload-progress-bar" class="bg-indigo-600 h-2 rounded-full bar-transition" style="width:${this.upload.percent || 0}%"></div>`
                  : `<div class="h-2 w-1/3 bg-indigo-600 rounded-full indeterminate-bar"></div>`}
              </div>
              <div id="upload-stage" class="text-indigo-800">${SummaryComponent.escapeDeep(this.upload.stage || '')}</div>
              ${this.upload.phase === 'processing' ? '<div class="text-[11px] text-indigo-700/70">A one-hour lecture usually takes a few minutes. You can keep using the other tabs.</div>' : ''}
            </div>
          `) : ''}
        </div>

        <!-- Available Processed Videos Shelf -->
        <div class="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm space-y-3">
          <div class="flex items-center justify-between">
            <h4 class="font-bold text-slate-800 text-xs uppercase tracking-wider">Processed Lecture Library (${this.videos.length})</h4>
            <span class="text-xs text-slate-400">Select a video to view AI synthesis & chapters</span>
          </div>
          <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
            ${this.videos.map(v => `
              <div data-id="${v.video_id}" class="btn-select-video cursor-pointer p-4 rounded-xl border transition ${
                vid && vid.video_id === v.video_id
                  ? 'border-indigo-600 bg-indigo-50/40 shadow-sm'
                  : 'border-slate-200 hover:border-slate-300 bg-slate-50/50'
              }">
                <div class="flex items-start justify-between">
                  <div class="space-y-1">
                    <span class="font-bold text-slate-900 text-xs line-clamp-1">${v.title}</span>
                    <div class="text-[11px] text-slate-500 font-mono flex items-center gap-2">
                      <span>⏱️ ${v.duration}</span>
                      <span>💾 ${v.filesize_mb} MB</span>
                    </div>
                  </div>
                  ${v.status === 'processing'
                    ? '<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-indigo-100 text-indigo-800">⏳ Processing</span>'
                    : v.status === 'failed'
                      ? '<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-100 text-rose-800">Failed</span>'
                      : v.simulated
                        ? '<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800">DEMO</span>'
                        : '<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800">🤖 AI summary</span>'}
                </div>
              </div>
            `).join('')}
          </div>
        </div>

        ${vid && vid.status === 'completed' ? this.renderVideoDetail(vid) : ''}
      </div>
    `;

    this.attachEventListeners();
  }

  renderVideoDetail(vid) {
    const localUrl = this.localVideoUrls[vid.video_id];
    return `
      ${vid.simulated ? `
        <div class="p-4 rounded-2xl bg-amber-50 border border-amber-200 text-xs text-amber-900">
          ⚠️ <strong>Simulated demo content</strong> — this summary was not produced by an AI model. Set <code>GEMINI_API_KEY</code> and upload a recording for a real summary.
        </div>` : `
        <div class="p-3 rounded-2xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-900">
          🤖 Summary generated by <strong>${vid.ai_model}</strong> from the actual recording (audio + video).
        </div>`}
      <!-- Video Player & Timeline Chapters Grid -->
      <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <!-- Left: Video Player Mockup -->
        <div class="lg:col-span-2 space-y-6">
          <div class="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm space-y-4">
            <div class="flex items-center justify-between">
              <div>
                <h2 class="font-bold text-slate-900 text-base">${vid.title}</h2>
                <div class="text-xs text-slate-400 font-mono mt-0.5">File: ${vid.filename} • Uploaded: ${vid.upload_time}</div>
              </div>
              <span class="px-3 py-1 rounded-full text-xs font-bold bg-indigo-50 text-indigo-700 border border-indigo-200 font-mono">
                Duration: ${vid.duration}
              </span>
            </div>

            <!-- Video player: the real file when it was uploaded from this tab -->
            ${localUrl ? `
              <video id="lecture-player" src="${localUrl}" controls playsinline class="w-full rounded-2xl bg-black aspect-video"></video>
            ` : `
              <div class="relative bg-slate-950 rounded-2xl overflow-hidden aspect-[16/9] flex items-center justify-center border border-slate-900">
                <div class="text-center space-y-2 px-6">
                  <div class="text-3xl">🎬</div>
                  <div class="text-xs text-slate-300">${vid.title}</div>
                  <div class="text-[11px] text-slate-500">The recording plays here when it is uploaded from this browser tab.</div>
                </div>
              </div>
            `}

            <!-- Executive Summary Card -->
            <div class="p-5 rounded-2xl bg-slate-50 border border-slate-100 space-y-2">
              <h4 class="font-bold text-slate-800 text-xs flex items-center gap-2">
                <span class="w-2 h-2 rounded-full bg-indigo-600"></span>
                AI Executive Summary
              </h4>
              <p class="text-xs text-slate-700 leading-relaxed font-normal">
                ${vid.executive_summary}
              </p>
              <div class="flex flex-wrap gap-1.5 pt-1">
                ${vid.topics.map(t => `<span class="px-2.5 py-1 rounded-lg text-xs bg-indigo-50 text-indigo-700 font-medium">#${t}</span>`).join('')}
              </div>
            </div>
          </div>

          <!-- Key Takeaways & Action Items 2-Column -->
          <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
            <!-- Key Takeaways -->
            <div class="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm space-y-4">
              <h3 class="font-bold text-slate-800 text-sm flex items-center gap-2">
                <span>✓</span> Key Lecture Takeaways
              </h3>
              <ul class="space-y-2.5">
                ${vid.key_takeaways.map(t => `
                  <li class="flex items-start gap-2.5 text-xs text-slate-700 bg-slate-50 p-3 rounded-xl border border-slate-100">
                    <span class="text-emerald-500 font-bold mt-0.5">✓</span>
                    <span>${t}</span>
                  </li>
                `).join('')}
              </ul>
            </div>

            <!-- Extracted Action Items -->
            <div class="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm space-y-4">
              <h3 class="font-bold text-slate-800 text-sm flex items-center gap-2">
                <span>📋</span> Action Items & Homework
              </h3>
              <div class="space-y-2.5">
                ${vid.action_items.map(a => `
                  <div class="p-3 rounded-xl border border-slate-100 bg-white flex items-center justify-between text-xs gap-3">
                    <div>
                      <div class="font-semibold text-slate-800">${a.task}</div>
                      <div class="text-[11px] text-slate-400">Assigned: ${a.assignee} • Due: <span class="font-mono text-indigo-600">${a.due_date}</span></div>
                    </div>
                    <span class="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                      a.status === 'completed' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'
                    }">
                      ${a.status}
                    </span>
                  </div>
                `).join('')}
              </div>
            </div>
          </div>
        </div>

        <!-- Right: Interactive Timeline Chapters & AI Q&A -->
        <div class="space-y-6">
          <!-- Timeline Chapters Navigator -->
          <div class="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm space-y-4">
            <div class="flex items-center justify-between">
              <h3 class="font-bold text-slate-800 text-sm flex items-center gap-2">
                <span>⏱️</span> Timeline Chapters
              </h3>
              <span class="text-[11px] font-semibold text-indigo-600 bg-indigo-50 px-2.5 py-0.5 rounded-full">
                ${vid.chapters.length} Indexed
              </span>
            </div>
            <p class="text-xs text-slate-500">${localUrl ? 'Click a chapter to jump to it in the video.' : 'Chapters with start times in the recording.'}</p>

            <div class="space-y-2.5">
              ${vid.chapters.map(c => `
                <div class="chapter-item p-3 rounded-xl border border-slate-200 hover:border-indigo-400 hover:bg-indigo-50/30 transition cursor-pointer text-xs space-y-1" data-ts="${c.timestamp}">
                  <div class="flex items-center justify-between">
                    <span class="font-bold text-slate-900">${c.title}</span>
                    <span class="font-mono text-[11px] font-bold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded">${c.timestamp}</span>
                  </div>
                  <p class="text-[11px] text-slate-500 leading-normal">${c.description}</p>
                </div>
              `).join('')}
            </div>
          </div>

          <!-- Ask AI About Video Assistant -->
          <div class="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm space-y-4">
            <div class="flex items-center justify-between">
              <h3 class="font-bold text-slate-800 text-sm flex items-center gap-2">
                <span>🤖</span> Ask AI About This Video
              </h3>
              <span class="text-[10px] font-bold px-2 py-0.5 rounded ${vid.qa_available ? 'text-emerald-700 bg-emerald-50' : 'text-amber-700 bg-amber-50'}">${vid.qa_available ? 'Gemini · real answers' : 'Demo answers'}</span>
            </div>
            <p class="text-xs text-slate-500">${vid.qa_available ? 'Gemini answers from the recording itself, with the timestamp.' : 'Answers are simulated for demo videos.'}</p>

            <form id="video-qa-form" class="space-y-2">
              <input type="text" name="question" required placeholder="e.g. When is the homework deadline?" class="w-full text-xs p-2.5 border rounded-xl focus:ring-2 focus:ring-indigo-500">
              <button type="submit" ${this.qaPending ? 'disabled' : ''} class="w-full py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white font-bold text-xs rounded-xl transition shadow-2xs">
                ${this.qaPending ? 'Thinking…' : 'Ask Video AI Assistant'}
              </button>
            </form>

            <!-- Q&A Conversation History -->
            <div class="space-y-3 pt-2">
              ${this.qaHistory.map(qa => `
                <div class="p-3.5 rounded-xl border border-indigo-100 bg-indigo-50/40 text-xs space-y-1.5">
                  <div class="font-bold text-indigo-900 flex items-center justify-between">
                    <span>Q: "${qa.question}"</span>
                    ${qa.timestamp ? `<span data-ts="${qa.timestamp}" class="chapter-item cursor-pointer font-mono text-[10px] text-indigo-600 bg-white px-2 py-0.5 rounded border border-indigo-200">⏱ ${qa.timestamp}</span>` : ''}
                  </div>
                  <p class="text-slate-700 leading-relaxed font-normal">${qa.answer}</p>
                </div>
              `).join('')}
            </div>
          </div>
        </div>
      </div>
    `;
  }

  attachEventListeners() {
    // 1-Click Demo Upload Button
    const btnQuick = this.container.querySelector('#btn-quick-demo-upload');
    if (btnQuick) btnQuick.addEventListener('click', () => this.handleDemoUpload());

    // Chapters / Q&A timestamps → seek the real player
    this.container.querySelectorAll('.chapter-item').forEach(el => {
      el.addEventListener('click', () => this.seekTo(el.getAttribute('data-ts')));
    });

    // Video Selection Cards
    this.container.querySelectorAll('.btn-select-video').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const id = e.currentTarget.getAttribute('data-id');
        this.selectVideo(id);
      });
    });

    // Dropzone File Select
    const dropzone = this.container.querySelector('#video-dropzone');
    const fileInput = this.container.querySelector('#video-file-input');
    const label = this.container.querySelector('#selected-file-label');

    if (dropzone && fileInput) {
      dropzone.addEventListener('click', () => fileInput.click());
      // real drag & drop
      ['dragenter', 'dragover'].forEach(ev => dropzone.addEventListener(ev, (e) => {
        e.preventDefault(); dropzone.classList.add('dropzone-active');
      }));
      ['dragleave', 'drop'].forEach(ev => dropzone.addEventListener(ev, (e) => {
        e.preventDefault(); dropzone.classList.remove('dropzone-active');
      }));
      dropzone.addEventListener('drop', (e) => {
        const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
        if (!f) return;
        const dt = new DataTransfer();
        dt.items.add(f);
        fileInput.files = dt.files;
        fileInput.dispatchEvent(new Event('change'));
      });
      fileInput.addEventListener('change', (e) => {
        if (e.target.files && e.target.files[0]) {
          const file = e.target.files[0];
          const mb = (file.size / (1024 * 1024)).toFixed(1);
          if (label) label.textContent = `Selected: ${file.name} (${mb} MB)`;
        }
      });
    }

    // Custom Upload Form
    const uploadForm = this.container.querySelector('#video-upload-form');
    if (uploadForm) {
      uploadForm.addEventListener('submit', (e) => {
        e.preventDefault();
        if (this.isProcessing) return;
        const title = uploadForm.title.value.trim();
        const topic = uploadForm.topic.value.trim();
        const language = uploadForm.language.value;
        const file = fileInput && fileInput.files ? fileInput.files[0] : null;
        this.handleRealUpload(file, title, topic, language);
      });
    }

    // Q&A Form
    const qaForm = this.container.querySelector('#video-qa-form');
    if (qaForm) {
      qaForm.addEventListener('submit', (e) => this.handleAskQuestion(e));
    }
  }
}
