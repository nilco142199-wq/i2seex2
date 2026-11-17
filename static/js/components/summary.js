/**
 * SummaryComponent
 * Class Video Upload & Multi-Modal AI Summarization Suite.
 * - Allows instructors to upload lecture recordings (.mp4, .webm, .mov).
 * - Simulates Whisper speech-to-text + Gemini multi-modal video LLM pipeline.
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
    this.processingStep = 0;
    this.qaHistory = [];
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
      this.videos = res.videos || [];
    } catch (err) {
      console.error('Failed to load videos:', err);
    }
  }

  async selectVideo(videoId) {
    try {
      const res = await ApiClient.getVideoDetail(videoId);
      this.selectedVideo = res.video;
      this.qaHistory = [];
      this.render();
    } catch (err) {
      console.error('Failed to load video detail:', err);
    }
  }

  async handleVideoUpload(filename, filesizeMb, title, topic) {
    this.isProcessing = true;
    this.processingStep = 1;
    this.render();

    // Step 2: Speech-to-text
    setTimeout(() => {
      this.processingStep = 2;
      this.render();
    }, 900);

    // Step 3: Keyframe & OCR analysis
    setTimeout(() => {
      this.processingStep = 3;
      this.render();
    }, 1800);

    // Step 4: LLM synthesis
    setTimeout(() => {
      this.processingStep = 4;
      this.render();
    }, 2700);

    try {
      // Dispatch API upload request
      const res = await ApiClient.uploadVideo({
        filename: filename || 'Lecture_Recording.mp4',
        fileSizeMb: filesizeMb || 650.0,
        title: title || '',
        topic: topic || ''
      });

      setTimeout(async () => {
        this.isProcessing = false;
        this.processingStep = 0;
        await this.fetchVideos();
        this.selectedVideo = res.video;
        this.render();
        alert(`🎉 Multi-Modal AI Lecture Processing Complete!\n\nSynthesized: "${res.video.title}"\n• Extracted ${res.video.chapters.length} chapters\n• Generated executive summary and action items.`);
      }, 3600);
    } catch (err) {
      this.isProcessing = false;
      alert('Upload processing failed: ' + err.message);
      this.render();
    }
  }

  async handleAskQuestion(e) {
    e.preventDefault();
    if (!this.selectedVideo) return;
    const input = e.target.question;
    const q = input.value.trim();
    if (!q) return;

    try {
      const res = await ApiClient.askVideoQuestion(this.selectedVideo.video_id, q);
      this.qaHistory.unshift(res);
      input.value = '';
      this.render();
    } catch (err) {
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
              <span class="text-xs text-slate-300 font-mono">Whisper ASR + Gemini 1.5</span>
            </div>
            <div class="flex items-center gap-4 text-xs text-slate-300">
              <span>📹 Total Processed: <strong>${this.videos.length} Lectures</strong></span>
              ${vid ? `<span class="bg-emerald-500/20 text-emerald-300 px-2.5 py-1 rounded-full font-bold">Engagement: ${vid.engagement_score}%</span>` : ''}
            </div>
          </div>

          <div class="mt-5">
            <h1 class="text-xl md:text-2xl font-bold tracking-tight text-white mb-2">
              Class Video Upload & AI Summarization
            </h1>
            <p class="text-xs md:text-sm text-slate-300 leading-relaxed max-w-4xl font-normal">
              Instructors can upload lecture recordings (.mp4, .webm, .mov). The integrated AI pipeline automatically extracts audio, transcribes speech with Whisper ASR, detects slide chapters, and generates executive summaries and actionable homework takeaways.
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
              <p class="text-xs text-slate-500">Drop a lecture recording to trigger automated multi-modal analysis.</p>
            </div>
            <button id="btn-quick-demo-upload" class="px-4 py-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-bold text-xs rounded-xl transition inline-flex items-center gap-1.5 shadow-2xs">
              <span>⚡</span> 1-Click Demo: Process Sample Lecture (850 MB)
            </button>
          </div>

          <!-- Upload Form / Dropzone -->
          <form id="video-upload-form" class="space-y-4">
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label class="block text-xs font-semibold text-slate-700 mb-1">Lecture Title (Optional)</label>
                <input type="text" name="title" placeholder="e.g. Lecture 09: Architectural Patterns & Decoupled Event Loops" class="w-full p-2.5 border rounded-xl text-xs font-medium focus:ring-2 focus:ring-indigo-500">
              </div>
              <div>
                <label class="block text-xs font-semibold text-slate-700 mb-1">Primary Lecture Topic</label>
                <input type="text" name="topic" placeholder="e.g. Observer Pattern & Loose Coupling" class="w-full p-2.5 border rounded-xl text-xs font-medium focus:ring-2 focus:ring-indigo-500">
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
                  Supports MP4, WebM, MOV, MKV up to 4 GB
                </div>
              </div>
            </div>

            <div class="flex justify-end">
              <button type="submit" class="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold text-xs transition shadow-sm flex items-center gap-2">
                <span>🚀</span> Upload & Process with AI
              </button>
            </div>
          </form>

          <!-- Animated Processing Progress Stepper -->
          ${this.isProcessing ? `
            <div class="p-5 rounded-2xl bg-indigo-50 border border-indigo-200 space-y-3">
              <div class="flex items-center justify-between text-xs font-bold text-indigo-900">
                <span>Processing Video with AI Pipeline...</span>
                <span>Step ${this.processingStep} of 4</span>
              </div>
              <div class="w-full bg-indigo-200 rounded-full h-2">
                <div class="bg-indigo-600 h-2 rounded-full bar-transition" style="width: ${this.processingStep * 25}%"></div>
              </div>
              <div class="grid grid-cols-2 md:grid-cols-4 gap-2 text-[11px] text-slate-600 pt-1">
                <div class="${this.processingStep >= 1 ? 'text-indigo-700 font-bold' : 'opacity-50'}">
                  1. 📤 Uploading Video
                </div>
                <div class="${this.processingStep >= 2 ? 'text-indigo-700 font-bold' : 'opacity-50'}">
                  2. 🎙️ Whisper ASR Speech
                </div>
                <div class="${this.processingStep >= 3 ? 'text-indigo-700 font-bold' : 'opacity-50'}">
                  3. 🖼️ Frame & Slide OCR
                </div>
                <div class="${this.processingStep >= 4 ? 'text-indigo-700 font-bold' : 'opacity-50'}">
                  4. 🧠 LLM Synthesis
                </div>
              </div>
            </div>
          ` : ''}
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
                  <span class="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800">
                    AI Ready
                  </span>
                </div>
              </div>
            `).join('')}
          </div>
        </div>

        ${vid ? this.renderVideoDetail(vid) : ''}
      </div>
    `;

    this.attachEventListeners();
  }

  renderVideoDetail(vid) {
    return `
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

            <!-- Interactive Video Player Container -->
            <div class="relative bg-slate-950 rounded-2xl overflow-hidden aspect-[16/9] flex items-center justify-center border border-slate-900 shadow-inner group">
              <div class="text-center space-y-3">
                <div class="w-16 h-16 rounded-full bg-indigo-600/90 text-white flex items-center justify-center mx-auto text-2xl shadow-lg cursor-pointer hover:scale-105 transition">
                  ▶
                </div>
                <div class="text-xs text-slate-300 font-mono">
                  Lecture Stream Preview: <strong>${vid.title}</strong>
                </div>
                <div class="text-[11px] text-slate-500">
                  Full 1080p Recording • Indexed by Multi-Modal LLM
                </div>
              </div>

              <!-- Bottom Player Controls Bar -->
              <div class="absolute bottom-0 inset-x-0 p-4 bg-gradient-to-t from-black/80 via-black/40 to-transparent flex items-center justify-between text-xs text-white">
                <div class="flex items-center gap-3">
                  <span class="cursor-pointer">▶ Play</span>
                  <span class="font-mono text-slate-300">00:00 / ${vid.duration}</span>
                </div>
                <div class="flex items-center gap-2">
                  <span class="px-2 py-0.5 bg-white/20 rounded text-[10px] font-bold">1080p HD</span>
                </div>
              </div>
            </div>

            <!-- Executive Summary Card -->
            <div class="p-5 rounded-2xl bg-slate-50 border border-slate-100 space-y-2">
              <h4 class="font-bold text-slate-800 text-xs flex items-center gap-2">
                <span class="w-2 h-2 rounded-full bg-indigo-600"></span>
                AI Executive Summary (Synthesized from Video Transcript & Slides)
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
            <p class="text-xs text-slate-500">Click any chapter to jump to that lecture section.</p>

            <div class="space-y-2.5">
              ${vid.chapters.map(c => `
                <div class="p-3 rounded-xl border border-slate-200 hover:border-indigo-400 hover:bg-indigo-50/30 transition cursor-pointer text-xs space-y-1" onclick="alert('Seeking video playback to timestamp: ${c.timestamp}')">
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
              <span class="text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded">RAG Assistant</span>
            </div>
            <p class="text-xs text-slate-500">Ask any question to search the multi-modal transcript.</p>

            <form id="video-qa-form" class="space-y-2">
              <input type="text" name="question" required placeholder="e.g. When is the homework deadline?" class="w-full text-xs p-2.5 border rounded-xl focus:ring-2 focus:ring-indigo-500">
              <button type="submit" class="w-full py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-xl transition shadow-2xs">
                Ask Video AI Assistant
              </button>
            </form>

            <!-- Q&A Conversation History -->
            <div class="space-y-3 pt-2">
              ${this.qaHistory.map(qa => `
                <div class="p-3.5 rounded-xl border border-indigo-100 bg-indigo-50/40 text-xs space-y-1.5">
                  <div class="font-bold text-indigo-900 flex items-center justify-between">
                    <span>Q: "${qa.question}"</span>
                    <span class="font-mono text-[10px] text-indigo-600 bg-white px-2 py-0.5 rounded border border-indigo-200">Ref: ${qa.timestamp}</span>
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
    if (btnQuick) {
      btnQuick.addEventListener('click', () => {
        this.handleVideoUpload(
          'CS302_Class_Recording_Advanced_OOP.mp4',
          850.5,
          'Lecture 09: Architectural Patterns & Decoupled Event Loops',
          'Behavioral GoF Patterns & SOLID Architecture'
        );
      });
    }

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
        const title = uploadForm.title.value.trim();
        const topic = uploadForm.topic.value.trim();
        const file = fileInput && fileInput.files ? fileInput.files[0] : null;

        const filename = file ? file.name : (title ? `${title.replace(/\s+/g, '_')}.mp4` : 'Class_Recording.mp4');
        const filesizeMb = file ? (file.size / (1024 * 1024)).toFixed(1) : 540.0;

        this.handleVideoUpload(filename, filesizeMb, title, topic);
      });
    }

    // Q&A Form
    const qaForm = this.container.querySelector('#video-qa-form');
    if (qaForm) {
      qaForm.addEventListener('submit', (e) => this.handleAskQuestion(e));
    }
  }
}
