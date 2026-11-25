/**
 * ApiClient (Facade Pattern)
 * Centralizes all REST API communication with the Python backend.
 */
class ApiClient {
  static BASE_URL = '';

  static async request(endpoint, options = {}) {
    const config = {
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {})
      },
      ...options
    };

    try {
      const response = await fetch(`${this.BASE_URL}${endpoint}`, config);
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || data.message || `HTTP error ${response.status}`);
      }
      return data;
    } catch (err) {
      console.error(`API Error on ${endpoint}:`, err);
      throw err;
    }
  }

  // System
  static async getStatus() {
    return this.request('/api/status');
  }

  // Attendance & Geofenced QR
  /** @param {number} [sinceVersion] roster version the caller already has (server may reply {unchanged:true}) */
  static async getAttendance(sinceVersion) {
    const q = (sinceVersion !== undefined && sinceVersion !== null) ? `?since=${encodeURIComponent(sinceVersion)}` : '';
    return this.request('/api/attendance' + q);
  }

  /** Lightweight status for one student (used by student phones instead of the full roster). */
  static async getMyAttendance(studentId) {
    return this.request('/api/attendance/me?student_id=' + encodeURIComponent(studentId || '') +
      '&device_id=' + encodeURIComponent(this.deviceId()));
  }

  static async registerStudent(studentId, name) {
    return this.request('/api/students/register', {
      method: 'POST',
      body: JSON.stringify({ student_id: studentId, name, device_id: this.deviceId() })
    });
  }

  static async getSessionActive() {
    return this.request('/api/session/active');
  }

  static async getSessionQR() {
    return this.request('/api/session/qr');
  }

  static async startSession(resetRoster = true) {
    return this.request('/api/session/start', {
      method: 'POST',
      body: JSON.stringify({ reset_roster: resetRoster })
    });
  }

  static async endSession() {
    return this.request('/api/session/end', {
      method: 'POST',
      body: JSON.stringify({})
    });
  }

  static async updateSessionLocation(lat, lng, name = null) {
    return this.request('/api/session/location', {
      method: 'POST',
      body: JSON.stringify({ lat, lng, name })
    });
  }

  static async createSession(data) {
    return this.request('/api/session/create', {
      method: 'POST',
      body: JSON.stringify(data)
    });
  }

  /**
   * Random id for this phone/browser, kept in localStorage (shared by all tabs).
   * Together with the server's cookie it enforces "one phone = one student" per session.
   */
  static deviceId() {
    const KEY = 'cs302_device_id';
    try {
      let id = window.localStorage.getItem(KEY);
      if (!id) {
        id = (window.crypto && crypto.randomUUID) ? crypto.randomUUID().replace(/-/g, '')
          : (Date.now().toString(36) + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2));
        window.localStorage.setItem(KEY, id);
      }
      return id;
    } catch (e) {
      if (!ApiClient._memDeviceId) ApiClient._memDeviceId = Date.now().toString(36) + Math.random().toString(36).slice(2, 12);
      return ApiClient._memDeviceId;
    }
  }

  static async verifyAttendance({ studentId, qrToken, lat, lng }) {
    return this.request('/api/attendance/verify', {
      method: 'POST',
      body: JSON.stringify({
        student_id: studentId,
        qr_token: qrToken,
        lat: parseFloat(lat),
        lng: parseFloat(lng),
        device_id: this.deviceId()
      })
    });
  }

  /** Saves a photo head count (automatic + corrected) – compared with the check-ins, marks nobody present. */
  static async saveHeadcount(facesDetected, peopleCounted) {
    return this.request('/api/attendance/headcount', {
      method: 'POST',
      body: JSON.stringify({ faces_detected: facesDetected, people_counted: peopleCounted })
    });
  }

  /** Location check without phone permission: current QR + same Wi-Fi as the instructor. */
  static async verifyByNetwork({ studentId, qrToken }) {
    return this.request('/api/attendance/verify-network', {
      method: 'POST',
      body: JSON.stringify({ student_id: studentId, qr_token: qrToken, device_id: this.deviceId() })
    });
  }

  /** Phone blocks location: ask the instructor to approve (requires the current QR code). */
  static async requestApproval({ studentId, qrToken, reason }) {
    return this.request('/api/attendance/request-approval', {
      method: 'POST',
      body: JSON.stringify({ student_id: studentId, qr_token: qrToken, reason, device_id: this.deviceId() })
    });
  }

  static async resolveApproval(studentId, approve) {
    return this.request('/api/attendance/approve', {
      method: 'POST',
      body: JSON.stringify({ student_id: studentId, approve })
    });
  }

  static async checkInStudent(studentId, method = 'self_checkin') {
    return this.request('/api/attendance/checkin', {
      method: 'POST',
      body: JSON.stringify({ student_id: studentId, method })
    });
  }

  static async toggleAttendance(studentId) {
    return this.request('/api/attendance/toggle', {
      method: 'POST',
      body: JSON.stringify({ student_id: studentId })
    });
  }

  static async simulatePhotoScan(detectedFaces = 8) {
    return this.request('/api/attendance/photo-scan', {
      method: 'POST',
      body: JSON.stringify({ detected_faces: detectedFaces })
    });
  }

  // Feedback & Comments
  static async getFeedback(category = 'all') {
    const query = category && category !== 'all' ? `?category=${category}` : '';
    return this.request(`/api/feedback${query}`);
  }

  static async postFeedback({ content, authorName, isAnonymous, category }) {
    return this.request('/api/feedback', {
      method: 'POST',
      body: JSON.stringify({
        content,
        author_name: authorName,
        is_anonymous: isAnonymous,
        category
      })
    });
  }

  static async upvoteFeedback(commentId) {
    return this.request('/api/feedback/upvote', {
      method: 'POST',
      body: JSON.stringify({ comment_id: commentId })
    });
  }

  static async resolveFeedback(commentId) {
    return this.request('/api/feedback/resolve', {
      method: 'POST',
      body: JSON.stringify({ comment_id: commentId })
    });
  }

  // On-the-spot Polls
  static async getPoll() {
    return this.request('/api/poll');
  }

  static async votePoll(optionId, voterId = null) {
    return this.request('/api/poll/vote', {
      method: 'POST',
      body: JSON.stringify({ option_id: optionId, voter_id: voterId })
    });
  }

  static async togglePoll() {
    return this.request('/api/poll/toggle', {
      method: 'POST',
      body: JSON.stringify({})
    });
  }

  static async createPoll(question, options) {
    return this.request('/api/poll/create', {
      method: 'POST',
      body: JSON.stringify({ question, options })
    });
  }

  // Meeting Summary
  static async getSummary() {
    return this.request('/api/summary');
  }

  static async regenerateSummary(topic) {
    return this.request('/api/summary/regenerate', {
      method: 'POST',
      body: JSON.stringify({ topic })
    });
  }

  // Video Upload & AI Summarization
  static async getVideoList() {
    return this.request('/api/video/list');
  }

  static async getVideoDetail(videoId) {
    return this.request(`/api/video/detail?id=${videoId}`);
  }

  static async uploadVideo({ filename, fileSizeMb, title, topic }) {
    return this.request('/api/video/upload', {
      method: 'POST',
      body: JSON.stringify({
        filename: filename || 'Class_Recording.mp4',
        file_size_mb: parseFloat(fileSizeMb || 450.0),
        title: title || '',
        topic: topic || ''
      })
    });
  }

  /**
   * Uploads the actual recording (raw bytes, not JSON) to /api/video/upload-file.
   * Uses XMLHttpRequest because fetch() cannot report upload progress.
   * @param {(percent:number)=>void} onProgress
   */
  static uploadVideoFile(file, { title = '', topic = '', language = 'auto' } = {}, onProgress = () => {}) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/video/upload-file');
      xhr.setRequestHeader('Content-Type', file.type || 'video/mp4');
      xhr.setRequestHeader('X-Filename', encodeURIComponent(file.name));
      xhr.setRequestHeader('X-Title', encodeURIComponent(title));
      xhr.setRequestHeader('X-Topic', encodeURIComponent(topic));
      xhr.setRequestHeader('X-Summary-Language', language);
      xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100)); };
      xhr.onload = () => {
        let data = {};
        try { data = JSON.parse(xhr.responseText || '{}'); } catch (e) { /* non-JSON error page */ }
        if (xhr.status >= 200 && xhr.status < 300) return resolve(data);
        if (xhr.status === 429) return reject(new Error(data.error || 'Upload limit reached. Try again later.'));
        if (xhr.status === 413) return reject(new Error(data.error || 'The file is too large for this connection. Open the instructor page on http://localhost:8000 to upload large recordings.'));
        reject(new Error(data.error || `Upload failed (HTTP ${xhr.status}).`));
      };
      xhr.onerror = () => reject(new Error('Network error during upload. If you use the public tunnel link, large files may be blocked – open the instructor page on http://localhost:8000 instead.'));
      xhr.send(file);
    });
  }

  static async askVideoQuestion(videoId, question) {
    return this.request('/api/video/qa', {
      method: 'POST',
      body: JSON.stringify({
        video_id: videoId,
        question: question
      })
    });
  }

  // Homework Review
  static async getReviews() {
    return this.request('/api/review');
  }

  static async getReviewDetail(submissionId) {
    return this.request(`/api/review/detail?id=${submissionId}`);
  }

  static async compareReviews(idA, idB) {
    return this.request(`/api/review/compare?id_a=${idA}&id_b=${idB}`);
  }

  static async analyzeRepo(repoUrl, studentName, language = 'en') {
    return this.request('/api/review/analyze', {
      method: 'POST',
      body: JSON.stringify({ repo_url: repoUrl, student_name: studentName, language })
    });
  }

  static async setReviewRequirements(text) {
    return this.request('/api/review/requirements', { method: 'POST', body: JSON.stringify({ text }) });
  }

  /** Uploads a homework .zip (raw body) – the server reads it in memory and starts the review job. */
  static uploadHomeworkZip(file, studentName, language = 'en', onProgress = () => {}) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/review/upload-zip');
      xhr.setRequestHeader('Content-Type', 'application/zip');
      xhr.setRequestHeader('X-Filename', encodeURIComponent(file.name));
      xhr.setRequestHeader('X-Student-Name', encodeURIComponent(studentName));
      xhr.setRequestHeader('X-Review-Language', language);
      xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100)); };
      xhr.onload = () => {
        let data = {};
        try { data = JSON.parse(xhr.responseText || '{}'); } catch (e) { /* non-JSON error page */ }
        if (xhr.status >= 200 && xhr.status < 300) return resolve(data);
        reject(new Error(data.error || `Upload failed (HTTP ${xhr.status}).`));
      };
      xhr.onerror = () => reject(new Error('Network error during upload – try again.'));
      xhr.send(file);
    });
  }
}
