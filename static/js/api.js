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
        throw new Error(data.error || `HTTP error ${response.status}`);
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
  static async getAttendance() {
    return this.request('/api/attendance');
  }

  static async getSessionActive() {
    return this.request('/api/session/active');
  }

  static async getSessionQR() {
    return this.request('/api/session/qr');
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

  static async verifyAttendance({ studentId, qrToken, lat, lng }) {
    return this.request('/api/attendance/verify', {
      method: 'POST',
      body: JSON.stringify({
        student_id: studentId,
        qr_token: qrToken,
        lat: parseFloat(lat),
        lng: parseFloat(lng)
      })
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

  static async analyzeRepo(repoUrl, studentName) {
    return this.request('/api/review/analyze', {
      method: 'POST',
      body: JSON.stringify({ repo_url: repoUrl, student_name: studentName })
    });
  }
}
