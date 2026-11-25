/**
 * AttendanceComponent
 * Fully functional Dual-Factor Attendance Module:
 * 1. Standards-compliant Dynamic / Static QR Code Generation (QREngine).
 * 2. Real-time Live Camera QR Scanner (WebRTC Video + BarcodeDetector API / Html5Qrcode).
 * 3. File upload photo decoder & 1-click screen capture fallback bridges.
 * 4. GPS Geofence Verification via Haversine Distance Formula (<= allowed radius, 500m default).
 * 5. Anti-Spoofing Audit Trails (detecting & flagging remote screenshot attempts).
 */
class AttendanceComponent {
  constructor(containerId, state) {
    this.container = document.getElementById(containerId);
    this.state = state;
    this.data = null;
    this.session = null;
    this.qrInfo = null;

    // QR Rotator Timer
    this.countdownTimer = null;
    this.currentQrCountdown = 20;

    // Student UI State
    // GPS starts EMPTY – a real (or explicitly simulated) position is required before check-in
    this.studentGps = { lat: null, lng: null, acquired: false, isSimulated: false, distance: null, status: null };
    this.scannedQrToken = '';
    this.verificationFeedback = null;
    this.scanStatus = null;   // { type: 'info'|'success'|'error', message }
    this.lockedStudentId = null;  // student this phone already checked in (one phone = one student)
    this.approvalStatus = null;   // null | 'pending' | 'approved' (fallback when location is blocked)
    this.lastGeoError = null;     // raw browser error, shown in "technical details"
    this.submitting = false;
    this.scanBusy = false;

    // Live Camera Scanner State
    this.cameraActive = false;
    this.cameraStream = null;
    this.scannerLoopTimer = null;

    // Instructor Tab
    this.activeRosterTab = 'present'; // 'present' | 'absent' | 'breaches'
  }

  async init() {
    this.state.subscribe('role', () => {
      this.stopCameraScanner();
      this.render();
    });
    this.state.subscribe('student', () => {
      this.verificationFeedback = null;
      this.render();
    });
    this.state.subscribe('tab', (tab) => {
      if (tab !== 'attendance' && this.cameraActive) {
        this.stopCameraScanner();
        this.render();
      }
    });

    // Opened from the QR deep link with the phone's native camera app
    if (this.state.pendingQrToken) {
      this.scannedQrToken = QREngine.extractToken(this.state.pendingQrToken);
      this.state.pendingQrToken = '';
      this.scanStatus = { type: 'success', message: '✅ Code received from the QR link. Select your name, then press "Verify & Check In".' };
    }

    // Learn the LAN address so the QR works on phones even if this page is on localhost
    try {
      const info = await ApiClient.request('/api/server-info');
      QREngine.lanOrigin = info.lan_origin || null;
      window.SERVER_MODE = info.mode || 'http';
    } catch (e) { QREngine.lanOrigin = null; }

    await this.fetchData();
    if (this.state.currentRole === 'student') await this.syncDeviceStatus();
    this.startQrAutoRefresh();
    this.render();
  }

  /**
   * Loads attendance data. Built for 100+ concurrent clients:
   * - Instructor: sends its last roster version; the server answers {unchanged:true} (a few bytes)
   *   when nothing happened, so polling every few seconds is cheap.
   * - Student: loads the roster once (for the name picker), then only polls its own status.
   * @returns {Promise<boolean>} true when something changed (caller re-renders)
   */
  async fetchData({ full = false } = {}) {
    try {
      const isLecturer = this.state.currentRole === 'lecturer';
      if (isLecturer || full || !this.data || !this.data.students) {
        const since = (!full && this.data && this.data.version !== undefined) ? this.data.version : undefined;
        const requests = [ApiClient.getAttendance(since)];
        if (isLecturer) requests.push(ApiClient.getSessionQR());
        const [rosterRes, qrRes] = await Promise.all(requests);

        let changed = false;
        if (!rosterRes.unchanged) {
          this.data = rosterRes;
          this.session = rosterRes.session;
          changed = true;
        }
        if (qrRes) {
          const qrChanged = !this.qrInfo || this.qrInfo.token !== qrRes.token;
          this.qrInfo = qrRes;
          this.currentQrCountdown = qrRes.seconds_remaining || 20;
          if (qrChanged) this.updateQrDisplayOnly();
        }
        this.refreshStudentDistance();
        return changed;
      }

      // Student background poll: only my own record + session status
      const me = await ApiClient.getMyAttendance(this.state.currentStudentId);
      const prev = JSON.stringify([this.session && this.session.is_active, this.currentStudentRecord(), this.lockedStudentId, this.approvalStatus]);
      this.applyDeviceStatus(me);
      if (me.session) this.session = { ...this.session, ...me.session };
      if (me.student) {
        const idx = this.data.students.findIndex(st => st.student_id === me.student.student_id);
        if (idx >= 0) this.data.students[idx] = me.student; else this.data.students.push(me.student);
      }
      this.refreshStudentDistance();
      return prev !== JSON.stringify([this.session && this.session.is_active, this.currentStudentRecord(), this.lockedStudentId, this.approvalStatus]);
    } catch (err) {
      console.error('Failed to load attendance data:', err);
      return false;
    }
  }

  /** Server says which student this phone belongs to (this session) and the approval state. */
  applyDeviceStatus(me) {
    if (!me) return;
    this.lockedStudentId = me.device_student_id || null;
    if (this.lockedStudentId && this.state.currentStudentId !== this.lockedStudentId) {
      this.state.currentStudentId = this.lockedStudentId; // silent switch, no extra render
      AppState.storageSet('cs302_student_id', this.lockedStudentId);
    }
    this.approvalStatus = me.approval_status || null;
  }

  async syncDeviceStatus() {
    try {
      this.applyDeviceStatus(await ApiClient.getMyAttendance(this.state.currentStudentId));
    } catch (e) { /* offline – ignore */ }
  }

  currentStudentRecord() {
    const list = (this.data && this.data.students) || [];
    return list.find(st => st.student_id === this.state.currentStudentId) || null;
  }

  refreshStudentDistance() {
    if (this.session && this.studentGps.acquired) {
      this.studentGps.distance = calculateHaversineDistance(
        this.session.classroom_lat, this.session.classroom_lng,
        this.studentGps.lat, this.studentGps.lng
      );
    }
  }

  /** Allowed check-in radius in meters (comes from the server session; 500 m default). */
  radiusM() {
    return Math.round((this.session && this.session.allowed_radius_meters) || 500);
  }

  /** Called by the App every few seconds after fetchData(): keeps the instructor roster live. */
  onBackgroundRefresh(changed = true) {
    if (!changed) return;
    if (this.state.currentRole !== 'lecturer') {
      // Student: update the status badge only when idle (never disturb an open camera / form)
      if (this.cameraActive || this.submitting) return;
      const active = document.activeElement;
      if (active && this.container.contains(active) && /INPUT|SELECT|TEXTAREA/.test(active.tagName)) return;
      this.render();
      return;
    }
    const active = document.activeElement;
    if (active && this.container.contains(active) && /INPUT|SELECT|TEXTAREA/.test(active.tagName)) return;
    this.render();
  }

  startQrAutoRefresh() {
    if (this.countdownTimer) clearInterval(this.countdownTimer);

    this.countdownTimer = setInterval(async () => {
      if (this.state.currentRole !== 'lecturer') return; // students never need the live QR
      if (this.session && this.session.qr_mode === 'dynamic' && this.session.is_active !== false) {
        this.currentQrCountdown--;
        if (this.currentQrCountdown <= 0) {
          try {
            const qrRes = await ApiClient.getSessionQR();
            this.qrInfo = qrRes;
            this.currentQrCountdown = qrRes.seconds_remaining || 20;
            this.updateQrDisplayOnly();
          } catch (e) {
            console.warn('QR poll error:', e);
          }
        } else {
          this.updateCountdownBadgeOnly();
        }
      }
    }, 1000);
  }

  updateQrDisplayOnly() {
    const qrContainer = this.container ? this.container.querySelector('#qr-code-display') : null;
    const tokenLabel = this.container ? this.container.querySelector('#qr-token-label') : null;
    const shortCode = this.container ? this.container.querySelector('#qr-short-code') : null;
    if (qrContainer && this.qrInfo) {
      QREngine.renderQR(qrContainer, QREngine.buildPayload(this.qrInfo.token), 240);
    }
    if (tokenLabel && this.qrInfo) {
      tokenLabel.textContent = this.qrInfo.token;
    }
    if (shortCode && this.qrInfo) {
      shortCode.textContent = this.qrInfo.short_code || '';
    }
    this.updateCountdownBadgeOnly();
  }

  updateCountdownBadgeOnly() {
    const badge = this.container ? this.container.querySelector('#qr-countdown-badge') : null;
    if (badge) {
      badge.textContent = `🔄 Rotates in: ${this.currentQrCountdown}s`;
    }
  }

  // ==========================================
  // CAMERA SCANNER MANAGEMENT
  // ==========================================
  setScanStatus(type, message) {
    // type: 'info' | 'success' | 'error'
    this.scanStatus = message ? { type, message } : null;
    const box = this.container ? this.container.querySelector('#scan-status-box') : null;
    if (box) box.outerHTML = this.renderScanStatus();
  }

  getVideoEl() {
    return this.container ? this.container.querySelector('#camera-scanner-video') : null;
  }

  async startCameraScanner() {
    this.verificationFeedback = null;

    // Camera access only works on https:// or http://localhost
    if (!window.isSecureContext) {
      this.setScanStatus('error',
        `📵 Camera blocked: this page is opened over plain http (${window.location.host}). ` +
        'Browsers only allow the camera on https:// or on localhost. Restart the server with ' +
        '"python3 server.py --https --host 0.0.0.0" and open the https:// address, or type the code manually below.');
      return;
    }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      this.setScanStatus('error', '📵 This browser does not support camera access. Type the 6-character code shown under the QR code instead.');
      return;
    }

    this.cameraActive = true;
    this.scanStatus = { type: 'info', message: '📷 Requesting camera permission…' };
    this.render(); // mounts the <video> element

    const attempts = [
      { video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false },
      { video: true, audio: false } // desktop webcams / devices that reject constraints
    ];

    let stream = null;
    let lastError = null;
    for (const constraints of attempts) {
      try {
        stream = await navigator.mediaDevices.getUserMedia(constraints);
        break;
      } catch (err) {
        lastError = err;
        if (err && (err.name === 'NotAllowedError' || err.name === 'SecurityError')) break;
      }
    }

    if (!stream) {
      this.stopCameraScanner();
      this.scanStatus = { type: 'error', message: this.describeCameraError(lastError) };
      this.render();
      return;
    }

    // User may have pressed "Stop" while the permission prompt was open
    if (!this.cameraActive) {
      stream.getTracks().forEach(t => t.stop());
      return;
    }

    this.cameraStream = stream;
    await this.attachStreamToVideo();
    this.setScanStatus('info', '🔍 Scanning… point the camera at the QR code on the instructor\'s screen.');
    this.startScanLoop();
  }

  describeCameraError(err) {
    const name = err ? err.name : '';
    switch (name) {
      case 'NotAllowedError':
      case 'SecurityError':
        return '🚫 Camera permission denied. Allow camera access for this site (tap the 🔒/ⓘ icon in the address bar → Camera → Allow), then press "Start Camera" again — or type the code manually below.';
      case 'NotFoundError':
      case 'OverconstrainedError':
        return '📷 No camera was found on this device. Type the 6-character code shown under the QR code instead.';
      case 'NotReadableError':
      case 'AbortError':
        return '📷 The camera is being used by another app or tab (Zoom, Teams, another browser tab…). Close it and try again.';
      default:
        return '📷 Could not start the camera' + (err && err.message ? `: ${err.message}` : '.') + ' You can type the code manually below.';
    }
  }

  /** (Re)attaches the live stream to the current <video> element – survives re-renders. */
  async attachStreamToVideo() {
    const videoEl = this.getVideoEl();
    if (!videoEl || !this.cameraStream) return;
    if (videoEl.srcObject !== this.cameraStream) {
      videoEl.muted = true;              // required for autoplay on iOS
      videoEl.setAttribute('playsinline', ''); // keep iOS from going full-screen
      videoEl.srcObject = this.cameraStream;
    }
    try {
      await videoEl.play();
    } catch (e) {
      console.warn('Video play() was interrupted:', e);
    }
  }

  startScanLoop() {
    if (this.scannerLoopTimer) clearInterval(this.scannerLoopTimer);
    this.scanBusy = false;

    this.scannerLoopTimer = setInterval(async () => {
      if (!this.cameraActive || this.scanBusy) return;
      const videoEl = this.getVideoEl();
      if (!videoEl || videoEl.readyState < 2 || !videoEl.videoWidth) return;

      this.scanBusy = true;
      try {
        const decodedText = await QREngine.detectBarcode(videoEl);
        if (decodedText && this.cameraActive) {
          await this.onQrDecoded(decodedText, 'camera');
        }
      } catch (err) {
        // ignore single-frame errors
      } finally {
        this.scanBusy = false;
      }
    }, 200);
  }

  stopCameraScanner() {
    if (this.scannerLoopTimer) {
      clearInterval(this.scannerLoopTimer);
      this.scannerLoopTimer = null;
    }
    if (this.cameraStream) {
      this.cameraStream.getTracks().forEach(track => track.stop());
      this.cameraStream = null;
    }
    const videoEl = this.getVideoEl();
    if (videoEl) videoEl.srcObject = null;
    this.cameraActive = false;
    this.scanBusy = false;
  }

  /** Called once a QR code (camera / photo) has been decoded. */
  async onQrDecoded(rawText, source) {
    const token = QREngine.extractToken(rawText);
    if (!token) {
      this.setScanStatus('error', '⚠️ That QR code does not contain an attendance code.');
      return;
    }
    console.log(`✅ QR decoded via ${source}:`, rawText);
    QREngine.playSuccessBeep();
    this.stopCameraScanner();
    this.scannedQrToken = token;
    this.scanStatus = { type: 'success', message: '✅ QR code scanned. Verifying your location…' };
    this.render();

    if (!this.studentGps.acquired) {
      // Location is a separate step: never requested in the middle of the QR flow
      this.scanStatus = { type: 'success', message: '✅ QR code scanned. Now do step 1: tap <strong>📍 Check my location</strong>, then <strong>Verify</strong>.' };
      this.render();
      return;
    }
    await this.handleSubmitVerification();
  }

  // Handle Photo File Upload Scanning
  async handleFileUploadScan(file) {
    if (!file) return;
    this.setScanStatus('info', '🖼️ Reading photo…');
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = async () => {
      try {
        const decoded = await QREngine.detectBarcode(img, true);
        if (decoded) {
          await this.onQrDecoded(decoded, 'photo');
        } else {
          this.setScanStatus('error', '⚠️ No QR code found in that photo. Make sure the whole code is visible, sharp and well-lit — or type the code manually.');
        }
      } finally {
        URL.revokeObjectURL(url);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      this.setScanStatus('error', '⚠️ Could not open that image file.');
    };
    img.src = url;
  }

  // ==========================================
  // INSTRUCTOR HANDLERS
  // ==========================================
  async handleUpdateLocation(lat, lng, name) {
    try {
      await ApiClient.updateSessionLocation(lat, lng, name);
      await this.fetchData();
      this.render();
      alert(`📍 Classroom location updated to: ${name || 'Custom'} (${lat}, ${lng})!`);
    } catch (err) {
      alert('Error updating location: ' + err.message);
    }
  }

  async handleFetchInstructorGPS() {
    if (!navigator.geolocation) {
      alert('Geolocation is not supported by your browser.');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const lat = parseFloat(pos.coords.latitude.toFixed(6));
        const lng = parseFloat(pos.coords.longitude.toFixed(6));
        await this.handleUpdateLocation(lat, lng, 'Instructor Live Device GPS');
      },
      (err) => {
        alert('Could not acquire GPS: ' + err.message + '. You may select a campus preset instead.');
      },
      { enableHighAccuracy: true, timeout: 8000 }
    );
  }

  async handleStartSession() {
    try {
      await ApiClient.startSession();
      await this.fetchData();
      this.activeRosterTab = 'present';
      this.render();
    } catch (err) {
      alert('Could not start the session: ' + err.message);
    }
  }

  async handleEndSession() {
    if (!confirm('End this session? Students will no longer be able to check in.')) return;
    try {
      await ApiClient.endSession();
      await this.fetchData();
      this.render();
    } catch (err) {
      alert('Could not end the session: ' + err.message);
    }
  }

  async handleToggleQrMode(newMode) {
    try {
      await ApiClient.createSession({
        ...this.session,
        qr_mode: newMode
      });
      await this.fetchData();
      this.render();
    } catch (err) {
      alert('Error toggling QR mode: ' + err.message);
    }
  }

  // ==========================================
  // STUDENT HANDLERS
  // ==========================================
  async handleRegisterStudent() {
    const id = (this.container.querySelector('#register-id') || {}).value || '';
    const name = (this.container.querySelector('#register-name') || {}).value || '';
    try {
      const res = await ApiClient.registerStudent(id.trim(), name.trim());
      this.registerMessage = {
        ok: true,
        text: res.created ? `✓ Added ${res.student.name}. You can check in now.` : `✓ ${res.student.name} is already on the list — selected.`
      };
      this.registerOpen = false;
      await this.fetchData({ full: true });
      this.state.setCurrentStudent(res.student.student_id); // re-renders
    } catch (err) {
      this.registerMessage = { ok: false, text: '✕ ' + err.message };
      this.registerOpen = true;
      this.render();
    }
  }

  applyRosterFilter() {
    if (!this.container) return;
    const q = (this.rosterFilter || '').trim().toLowerCase();
    const rows = this.container.querySelectorAll('.roster-row');
    let shown = 0;
    rows.forEach(row => {
      const hit = !q || row.getAttribute('data-search').includes(q);
      row.style.display = hit ? '' : 'none';
      if (hit) shown++;
    });
    let empty = this.container.querySelector('#roster-empty');
    if (q && shown === 0 && rows.length) {
      if (!empty) {
        const table = rows[0].closest('table');
        empty = document.createElement('div');
        empty.id = 'roster-empty';
        empty.className = 'p-6 text-center text-xs text-slate-400';
        table.parentNode.appendChild(empty);
      }
      empty.textContent = `No student matches "${this.rosterFilter}".`;
    } else if (empty) {
      empty.remove();
    }
  }
  /** Which browser/OS is this? Used to show the right "how to allow location" steps. */
  static detectBrowserEnv() {
    const ua = navigator.userAgent || '';
    const isIOS = /iPhone|iPad|iPod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const isAndroid = /Android/i.test(ua);
    // In-app browsers (Google Lens/Google app, WhatsApp, Instagram, Facebook…) often block location
    const inAppMatch = ua.match(/\b(GSA|FBAN|FBAV|Instagram|Line|WhatsApp|Snapchat|TikTok|musical_ly)\b/i);
    const androidWebView = isAndroid && /; wv\)/.test(ua);
    const inApp = Boolean(inAppMatch) || androidWebView;
    const inAppName = inAppMatch ? ({ GSA: 'the Google app / Lens', FBAN: 'Facebook', FBAV: 'Facebook' }[inAppMatch[1]] || inAppMatch[1]) : 'another app';
    return { isIOS, isAndroid, inApp, inAppName };
  }

  /** Step-by-step help for a denied location permission, per platform. */
  locationDeniedHelp() {
    const env = AttendanceComponent.detectBrowserEnv();
    const url = window.location.origin + '/?role=student';
    const copyBtn = `<button type="button" data-copy-url="${url}" class="btn-copy-url underline font-semibold">copy the link</button>`;
    let steps;
    if (env.inApp) {
      steps = `
        <p><strong>This page is open inside ${env.inAppName}</strong>, which doesn't allow location for websites.</p>
        <p>Open it in ${env.isIOS ? '<strong>Safari</strong>' : '<strong>Chrome</strong>'}: tap <strong>⋮</strong> / the share icon → <strong>"Open in ${env.isIOS ? 'Safari' : 'Chrome'}"</strong> (or ${copyBtn} and paste it in the browser).</p>`;
    } else if (env.isIOS) {
      const selfSigned = window.SERVER_MODE === 'https-self-signed';
      steps = `${selfSigned ? `
        <p class="p-2 rounded-lg bg-rose-100"><strong>This link uses the self-signed certificate (<code>--https</code>). iPhone Safari blocks location on such sites.</strong>
        Ask the instructor to restart with <code>python3 server.py --tunnel</code> and open the new https://….trycloudflare.com link.</p>` : ''}
        <ol class="list-decimal ms-4 space-y-0.5">
          <li><strong>Settings → Privacy &amp; Security → Location Services</strong> → <strong>On</strong>, then <strong>Safari Websites</strong> → <strong>"While Using the App"</strong>.</li>
          <li><strong>Settings → Apps → Safari → Location</strong> (older iOS: Settings → Safari → Location) → <strong>Ask</strong> or <strong>Allow</strong> — not "Deny".</li>
          <li>In Safari tap <strong>ᴀA</strong> left of the address → <strong>Website Settings → Location → Ask</strong>.</li>
          <li>Close this tab, open the link again, tap <strong>📍 Check my location</strong> and choose <strong>Allow</strong>.</li>
        </ol>
        <p class="opacity-80">Using Chrome on iPhone? Settings → Apps → Chrome → Location → "While Using the App". Screen Time can also lock location: Settings → Screen Time → Content &amp; Privacy Restrictions → Location Services → Allow Changes.</p>`;
    } else if (env.isAndroid) {
      steps = `
        <ol class="list-decimal ms-4 space-y-0.5">
          <li>Turn on <strong>Location</strong> in the quick settings (swipe down from the top).</li>
          <li>In Chrome tap the <strong>🔒 / ⚙ icon</strong> left of the address → <strong>Permissions → Location → Allow</strong>.</li>
          <li>Still blocked? <strong>Settings → Apps → Chrome → Permissions → Location → "Allow only while using the app"</strong>.</li>
          <li>Reload this page and tap <strong>📍 Check my location</strong> — or use <strong>📶 Check my location by Wi-Fi</strong> below.</li>
        </ol>`;
    } else {
      steps = `
        <ol class="list-decimal ms-4 space-y-0.5">
          <li>Click the <strong>🔒 / ⓘ icon</strong> left of the address → <strong>Location → Allow</strong>, then reload.</li>
          <li>Mac: <strong>System Settings → Privacy &amp; Security → Location Services</strong> → enable your browser.</li>
        </ol>`;
    }
    return `<div class="space-y-1.5"><p class="font-bold">🚫 Location access is blocked for this site.</p>${steps}</div>`;
  }

  async getGeoPermissionState() {
    try {
      if (!navigator.permissions || !navigator.permissions.query) return 'unknown';
      const res = await navigator.permissions.query({ name: 'geolocation' });
      return res.state; // 'granted' | 'prompt' | 'denied'
    } catch (e) {
      return 'unknown'; // Safari < 16 etc.
    }
  }

  getPosition(options) {
    return new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, reject, options));
  }

  /**
   * Acquires the device position. Resolves true on success.
   * IMPORTANT: getCurrentPosition() is called synchronously (no await before it) so that, when this
   * runs inside a tap handler, Safari still treats it as a user action and shows the permission prompt.
   * permissions.query() is only used afterwards for diagnostics – Safari can report "prompt" while the
   * setting is actually "Deny" (and vice versa), so it must never block the request.
   */
  handleAcquireStudentGPS() {
    if (this.geoInFlight) return this.geoInFlight;

    const fail = (message, extra = {}) => {
      this.studentGps = { ...this.studentGps, status: { type: 'error', message, ...extra } };
      this.render();
      return false;
    };
    if (!window.isSecureContext) {
      return Promise.resolve(fail('📍 Location is blocked because the page is opened over plain http. Open the https:// link (python3 server.py --tunnel).'));
    }
    if (!navigator.geolocation) {
      return Promise.resolve(fail('📍 This browser does not support location. Open the link in Safari or Chrome.'));
    }

    const ask = (options) => new Promise((resolve, reject) =>
      navigator.geolocation.getCurrentPosition(resolve, reject, options));

    // ↓ first call happens right now, synchronously inside the tap
    const firstTry = ask({ enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 });

    this.studentGps = { ...this.studentGps, status: { type: 'info', message: '📡 Getting your location… tap <strong>Allow</strong> if the phone asks.' } };
    this.render();

    const denied = async (err) => {
      const permission = await this.getGeoPermissionState();
      this.lastGeoError = { code: err.code, message: err.message, permission };
      return fail(this.locationDeniedHelp(), { denied: true });
    };

    this.geoInFlight = (async () => {
      let pos;
      try {
        pos = await firstTry;
      } catch (err) {
        if (err.code === 1) return denied(err);
        try {
          // GPS slow/unavailable indoors → faster network-based position (permission already granted)
          pos = await ask({ enableHighAccuracy: false, timeout: 20000, maximumAge: 120000 });
        } catch (err2) {
          if (err2.code === 1) return denied(err2);
          this.lastGeoError = { code: err2.code, message: err2.message, permission: await this.getGeoPermissionState() };
          return fail(err2.code === 3
            ? '⏱️ Getting your location timed out. Move near a window, make sure Location is on, and tap <strong>📍 Check my location</strong> again.'
            : '📍 Your position is unavailable. Turn on Location (GPS) and Wi-Fi, then tap <strong>📍 Check my location</strong> again.');
        }
      }
      this.lastGeoError = null;
      const lat = parseFloat(pos.coords.latitude.toFixed(6));
      const lng = parseFloat(pos.coords.longitude.toFixed(6));
      const dist = calculateHaversineDistance(this.session.classroom_lat, this.session.classroom_lng, lat, lng);
      const accuracy = Math.round(pos.coords.accuracy || 0);
      this.studentGps = {
        lat, lng, acquired: true, isSimulated: false, distance: dist, accuracy,
        status: { type: 'success', message: `📍 Location acquired (±${accuracy}m accuracy).` }
      };
      this.render();
      return true;
    })().finally(() => { this.geoInFlight = null; });

    return this.geoInFlight;
  }

  async handleSubmitVerification() {
    const input = this.container ? this.container.querySelector('#input-student-qr-token') : null;
    if (input && input.value.trim()) this.scannedQrToken = QREngine.extractToken(input.value);

    if (!this.scannedQrToken) {
      this.verificationFeedback = { success: false, reason: 'missing_qr', message: 'Scan the QR code first, or type the 6-character code shown under it.' };
      this.render();
      return;
    }
    if (!this.studentGps.acquired) {
      this.verificationFeedback = { success: false, reason: 'missing_gps', message: 'Do step 1 first: tap 📍 Check my location. (If your phone blocks location, use 📶 Check my location by Wi-Fi there.)' };
      this.render();
      return;
    }

    this.submitting = true;
    this.render();
    try {
      const res = await ApiClient.verifyAttendance({
        studentId: this.state.currentStudentId,
        qrToken: this.scannedQrToken,
        lat: this.studentGps.lat,
        lng: this.studentGps.lng
      });
      this.verificationFeedback = res;
      if (res.reason === 'device_already_used' && res.device_student_id) {
        this.lockedStudentId = res.device_student_id;
        this.state.currentStudentId = res.device_student_id;
        AppState.storageSet('cs302_student_id', res.device_student_id);
      }
      if (res.success) {
        this.lockedStudentId = this.state.currentStudentId;
        this.scanStatus = null;
      } else if (res.reason === 'invalid_qr') {
        this.scannedQrToken = ''; // force a fresh scan
      }
      await this.fetchData();
    } catch (err) {
      this.verificationFeedback = {
        success: false,
        reason: 'network_error',
        message: 'Could not reach the server: ' + err.message + '. Check that the server is running and that you are on the same Wi-Fi.'
      };
    } finally {
      this.submitting = false;
      this.render();
    }
  }

  // ==========================================
  // RENDER PIPELINE
  // ==========================================
  render() {
    if (!this.container) return;
    if (!this.data || !this.session) {
      this.container.innerHTML = '<div class="p-8 text-center text-slate-500">Loading classroom session & attendance...</div>';
      return;
    }

    const isLecturer = this.state.currentRole === 'lecturer';

    this.container.innerHTML = `
      <div class="space-y-6">
        <!-- Dual Factor Notification Banner -->
        <div class="bg-indigo-900 text-white p-5 rounded-2xl shadow-sm border border-indigo-800 flex flex-wrap items-center justify-between gap-4">
          <div class="flex items-center gap-3">
            <span class="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center text-xl">🛡️</span>
            <div>
              <div class="flex items-center gap-2">
                <h3 class="font-bold text-sm">Dual-Factor Verification Enforced</h3>
                <span class="text-[10px] font-bold uppercase bg-emerald-500/20 text-emerald-300 border border-emerald-400/30 px-2 py-0.5 rounded-full">
                  Anti-Spoofing Active
                </span>
              </div>
              <p class="text-xs text-indigo-200 mt-0.5">
                Students must satisfy BOTH: (1) Scan dynamic QR code + (2) Device GPS within <strong>${this.radiusM()} meters</strong> of classroom.
              </p>
            </div>
          </div>
          <div class="flex items-center gap-2">
            <span class="text-xs text-indigo-200">Current Role View:</span>
            <span class="px-3 py-1 rounded-xl text-xs font-bold ${isLecturer ? 'bg-indigo-700 text-white' : 'bg-emerald-600 text-white'}">
              ${isLecturer ? '👨‍🏫 Instructor Interface' : '👨‍🎓 Student Mobile Interface'}
            </span>
          </div>
        </div>

        ${isLecturer ? this.renderInstructorView() : this.renderStudentView()}
      </div>
    `;

    this.attachEventListeners();

    // After DOM is attached, render the real QR code for instructor
    if (isLecturer) {
      const qrBox = this.container.querySelector('#qr-code-display');
      if (qrBox && this.qrInfo) {
        QREngine.renderQR(qrBox, QREngine.buildPayload(this.qrInfo.token), 240);
      }
    } else if (this.cameraActive && this.cameraStream) {
      // The <video> element was re-created by this render – re-attach the live camera
      this.attachStreamToVideo();
    }
  }

  /** Tells the instructor which address phones must open (localhost does not work on a phone). */
  renderPhoneAccessHint() {
    const studentUrl = `${QREngine.publicOrigin()}/?role=student`;
    if (QREngine.isLocalhostPage() && !QREngine.lanOrigin) {
      return `
        <div class="text-left text-[11px] p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 leading-relaxed">
          ⚠️ <strong>Phones can't open this QR yet.</strong> This page runs on <code>localhost</code>, which only exists on this computer.
          Stop the server and run <code class="font-mono">python3 server.py --https --host 0.0.0.0</code>, then reload.
        </div>`;
    }
    return `
      <div class="text-left text-[11px] p-3 rounded-xl bg-slate-50 border border-slate-200 text-slate-600 leading-relaxed">
        📱 Students open: <span class="font-mono font-bold text-slate-900 break-all select-all">${studentUrl}</span>
        ${window.location.protocol === 'http:' && !QREngine.isLocalhostPage() ? '<br>⚠️ Plain http: phones will block the camera/GPS — use <code>--https</code>.' : ''}
      </div>`;
  }

  /**
   * Renders Instructor Interface
   */
  renderInstructorView() {
    const breaches = this.data.flagged_remote_attempts || [];
    const pendingApprovals = this.data.pending_approvals || [];
    const presentCount = this.data.present_count;
    const absentCount = this.data.absent_count;
    const totalEnrolled = this.data.total_enrolled;
    const rate = this.data.attendance_rate;
    const sessionOpen = this.session.is_active !== false;
    const allStudents = this.data.students || [];
    const presentList = allStudents.filter(st => st.is_present)
      .sort((a, b) => String(b.check_in_time || '').localeCompare(String(a.check_in_time || '')));
    const absentList = allStudents.filter(st => !st.is_present)
      .sort((a, b) => a.name.localeCompare(b.name));

    return `
      <!-- Top Metrics Counters -->
      <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div class="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm">
          <span class="text-xs font-semibold text-slate-400 uppercase tracking-wider">Total Enrolled</span>
          <div class="mt-2 text-2xl font-bold text-slate-800">${totalEnrolled} <span class="text-xs font-normal text-slate-500">Students</span></div>
        </div>
        <div class="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm">
          <span class="text-xs font-semibold text-emerald-600 uppercase tracking-wider">Verified Present</span>
          <div class="mt-2 text-2xl font-bold text-emerald-600">${presentCount} <span class="text-xs font-normal text-slate-500">(${rate}%)</span></div>
        </div>
        <div class="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm">
          <span class="text-xs font-semibold text-amber-500 uppercase tracking-wider">Not Checked In</span>
          <div class="mt-2 text-2xl font-bold text-amber-500">${absentCount} <span class="text-xs font-normal text-slate-500">Pending</span></div>
        </div>
        <div class="bg-white p-5 rounded-2xl border border-rose-100 shadow-sm bg-rose-50/20">
          <span class="text-xs font-semibold text-rose-600 uppercase tracking-wider flex items-center gap-1">
            <span>🚨</span> Geofence Breaches
          </span>
          <div class="mt-2 text-2xl font-bold text-rose-600">${breaches.length} <span class="text-xs font-normal text-slate-500">Blocked</span></div>
        </div>
      </div>

      <!-- Main Instructor Grid: QR Generator & Geofence Settings -->
      <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <!-- Left: Session control + QR Code Display -->
        <div class="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm space-y-4 text-center">
          <div class="flex items-center justify-between">
            <h4 class="font-bold text-slate-800 text-sm">Class Session</h4>
            <span class="px-2.5 py-1 rounded-full text-[11px] font-bold ${
              sessionOpen ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-slate-100 text-slate-600 border border-slate-200'
            }">
              ${sessionOpen ? `● Live since ${this.session.started_at || ''}` : `■ Ended ${this.session.ended_at || ''}`}
            </span>
          </div>

          ${sessionOpen ? `
            <div class="flex items-center justify-between text-xs">
              <span class="text-slate-500">Students scan this code:</span>
              <span id="qr-countdown-badge" class="px-2.5 py-1 rounded-full text-[11px] font-bold ${
                this.session.qr_mode === 'dynamic' ? 'bg-indigo-50 text-indigo-700 border border-indigo-200' : 'bg-slate-100 text-slate-600'
              }">
                ${this.session.qr_mode === 'dynamic' ? `🔄 Rotates in: ${this.currentQrCountdown}s` : 'Static QR Mode'}
              </span>
            </div>

            <!-- Real Scannable QR Code -->
            <div id="qr-code-display" class="py-2 flex items-center justify-center min-h-[260px]">
              <div class="text-xs text-slate-400">Rendering QR code…</div>
            </div>

            <div class="space-y-1">
              <div class="text-[11px] text-slate-400">Or type this code in Student Mode:</div>
              <div id="qr-short-code" class="font-mono text-3xl font-extrabold tracking-[0.3em] text-slate-900 select-all">
                ${this.qrInfo ? this.qrInfo.short_code || '' : ''}
              </div>
            </div>

            ${this.renderPhoneAccessHint()}

            <details class="text-left text-[11px] text-slate-500">
              <summary class="cursor-pointer font-semibold">Token details</summary>
              <div id="qr-token-label" class="mt-1 font-mono text-[10px] bg-slate-50 py-1.5 px-2 rounded-lg border border-slate-200 text-slate-700 select-all break-all">
                ${this.qrInfo ? this.qrInfo.token : ''}
              </div>
            </details>

            <div class="grid grid-cols-2 gap-2 text-xs">
              <a href="/?role=student" target="_blank" rel="noopener" class="py-2 rounded-xl bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-semibold">
                ↗ Open Student Mode
              </a>
              <button id="btn-end-session" class="py-2 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 font-semibold">
                ■ End Session
              </button>
            </div>
          ` : `
            <div class="py-10 space-y-3">
              <div class="text-4xl">⏸️</div>
              <p class="text-xs text-slate-500">No session is running, so no QR code is shown and student check-ins are rejected.</p>
              <button id="btn-start-session" class="w-full py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold text-sm">
                ▶ Start Session
              </button>
              <p class="text-[11px] text-slate-400">Starting a session resets the attendance list for a new class.</p>
            </div>
          `}

          <!-- QR Rotation Mode Controls -->
          <div class="pt-2 border-t border-slate-100 flex items-center justify-between text-xs">
            <span class="text-slate-500 font-medium">Rotation Mode:</span>
            <div class="flex items-center gap-1">
              <button id="btn-set-dynamic-qr" class="px-2.5 py-1 rounded-lg font-semibold transition ${
                this.session.qr_mode === 'dynamic' ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }">
                Dynamic (20s)
              </button>
              <button id="btn-set-static-qr" class="px-2.5 py-1 rounded-lg font-semibold transition ${
                this.session.qr_mode === 'static' ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }">
                Static
              </button>
            </div>
          </div>
          <p class="text-[11px] text-slate-400 text-left">
            💡 Dynamic mode rotates the HMAC token every 20s (codes stay valid ~40s) so a forwarded screenshot quickly stops working.
          </p>
        </div>

        <!-- Middle & Right: Base GPS Configuration & Live Statistics -->
        <div class="lg:col-span-2 space-y-6">
          <!-- Classroom Location & Geofence Coordinates -->
          <div class="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm space-y-4">
            <div class="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
              <div>
                <h4 class="font-bold text-slate-800 text-sm">Classroom GPS Base Coordinates</h4>
                <p class="text-xs text-slate-500">Students must be within ${this.radiusM()}m of this location to be marked present.</p>
              </div>
              <span class="px-3 py-1 bg-emerald-50 text-emerald-700 border border-emerald-200 text-xs font-bold rounded-full">
                Allowed Radius: ${this.radiusM()}m
              </span>
            </div>

            <div class="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
              <div>
                <label class="block text-slate-500 font-semibold mb-1">Classroom / Hall Name</label>
                <input id="input-classroom-name" type="text" value="${this.session.classroom_name}" class="w-full p-2.5 border rounded-xl font-medium focus:ring-2 focus:ring-indigo-500">
              </div>
              <div>
                <label class="block text-slate-500 font-semibold mb-1">Latitude</label>
                <input id="input-classroom-lat" type="number" step="0.000001" value="${this.session.classroom_lat}" class="w-full p-2.5 border rounded-xl font-mono focus:ring-2 focus:ring-indigo-500">
              </div>
              <div>
                <label class="block text-slate-500 font-semibold mb-1">Longitude</label>
                <input id="input-classroom-lng" type="number" step="0.000001" value="${this.session.classroom_lng}" class="w-full p-2.5 border rounded-xl font-mono focus:ring-2 focus:ring-indigo-500">
              </div>
            </div>

            <!-- Preset Shortcuts & My Location -->
            <div class="flex flex-wrap items-center justify-between gap-3 pt-1">
              <div class="flex flex-wrap items-center gap-2">
                <button id="btn-fetch-my-gps" class="px-3 py-1.5 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 font-semibold text-xs rounded-xl transition inline-flex items-center gap-1.5">
                  <span>📍</span> Auto-Fetch My Current GPS Location
                </button>
                <select id="select-campus-preset" class="text-xs bg-slate-50 border border-slate-200 rounded-xl px-3 py-1.5 font-medium text-slate-700">
                  <option value="">Campus Presets...</option>
                  <option value="32.104722,35.209444,Ariel University">Ariel University (32.1047, 35.2094)</option>
                  <option value="32.113300,34.804300,Ada Lovelace Auditorium (TAU)">Ada Lovelace Auditorium (32.1133, 34.8043)</option>
                  <option value="32.777000,35.021600,Software Lab 3 (Technion)">Software Lab 3 (32.7770, 35.0216)</option>
                </select>
              </div>
              <button id="btn-save-classroom-loc" class="px-4 py-1.5 bg-slate-800 text-white font-semibold text-xs rounded-xl hover:bg-slate-900 transition">
                Save Classroom GPS
              </button>
            </div>
          </div>

          <!-- Real-Time Attendance Statistics Tabs -->
          <div class="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
            <div class="px-6 py-4 border-b border-slate-100 flex flex-wrap items-center justify-between gap-4">
              <div class="flex items-center gap-2">
                <button data-tab="present" class="btn-roster-tab px-3 py-1.5 rounded-xl text-xs font-bold transition ${
                  this.activeRosterTab === 'present' ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }">
                  ✓ Verified Present (${presentCount})
                </button>
                <button data-tab="absent" class="btn-roster-tab px-3 py-1.5 rounded-xl text-xs font-bold transition ${
                  this.activeRosterTab === 'absent' ? 'bg-amber-500 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }">
                  ⏳ Not Checked In (${absentCount})
                </button>
                <button data-tab="breaches" class="btn-roster-tab px-3 py-1.5 rounded-xl text-xs font-bold transition ${
                  this.activeRosterTab === 'breaches' ? 'bg-rose-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }">
                  🚨 Flagged Breaches (${breaches.length})
                </button>
                <button data-tab="approvals" class="btn-roster-tab px-3 py-1.5 rounded-xl text-xs font-bold transition ${
                  this.activeRosterTab === 'approvals' ? 'bg-amber-500 text-white' : (pendingApprovals.length ? 'bg-amber-100 text-amber-800 animate-pulse' : 'bg-slate-100 text-slate-600 hover:bg-slate-200')
                }">
                  🙋 Approvals (${pendingApprovals.length})
                </button>
                <button data-tab="headcount" class="btn-roster-tab px-3 py-1.5 rounded-xl text-xs font-bold transition ${
                  this.activeRosterTab === 'headcount' ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }">
                  📸 Photo count
                </button>
              </div>

              <div class="flex items-center gap-2 flex-wrap">
                <input id="roster-search" type="search" placeholder="🔍 Search name or ID…" value="${this.rosterFilter || ''}"
                  class="px-3 py-1.5 border border-slate-200 rounded-xl text-xs w-44 focus:ring-2 focus:ring-indigo-500">
                <button id="btn-live-sheet" class="px-3 py-1.5 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 text-emerald-800 rounded-xl text-xs font-semibold transition inline-flex items-center gap-1">
                  <span>🔗</span> Live Sheet
                </button>
                <button id="btn-export-csv" class="px-3 py-1.5 bg-slate-50 hover:bg-slate-100 border border-slate-200 text-slate-700 rounded-xl text-xs font-medium transition inline-flex items-center gap-1">
                  <span>📥</span> Export CSV
                </button>
              </div>
            </div>

            <!-- Tab Content: Verified Present -->
            ${this.activeRosterTab === 'present' ? `
              <div class="overflow-x-auto max-h-[560px] overflow-y-auto">
                <table class="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr class="bg-slate-50 text-slate-500 font-semibold border-b border-slate-100 sticky top-0 z-10">
                      <th class="py-3 px-6">Student</th>
                      <th class="py-3 px-6">Check-in Time</th>
                      <th class="py-3 px-6">Verified Distance</th>
                      <th class="py-3 px-6">Factors Verified</th>
                      <th class="py-3 px-6 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-slate-100">
                    ${presentList.map(s => `
                      <tr class="roster-row hover:bg-slate-50/70 transition" data-search="${(s.name + ' ' + s.student_id).toLowerCase()}">
                        <td class="py-3.5 px-6">
                          <div class="flex items-center gap-3">
                            <img src="${s.avatar}" loading="lazy" class="w-7 h-7 rounded-full bg-slate-100">
                            <div>
                              <div class="font-bold text-slate-800">${s.name}</div>
                              <div class="text-[10px] text-slate-400 font-mono">${s.student_id}</div>
                            </div>
                          </div>
                        </td>
                        <td class="py-3.5 px-6 font-mono text-slate-700">${s.check_in_time || '—'}</td>
                        <td class="py-3.5 px-6">
                          ${s.distance_meters !== null ? `
                            <span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-100 font-mono">
                              📍 ${s.distance_meters}m from class
                            </span>
                          ` : `<span class="text-slate-400">—</span>`}
                        </td>
                        <td class="py-3.5 px-6">
                          <span class="px-2 py-0.5 rounded text-[10px] font-semibold bg-indigo-50 text-indigo-700">
                            ${s.check_in_method === 'qr_gps' ? `QR Code + GPS (≤${this.radiusM()}m)` : s.check_in_method === 'instructor_approved' ? 'QR Code + instructor approval' : s.check_in_method === 'qr_network' ? 'QR Code + classroom Wi-Fi' : s.check_in_method}
                          </span>
                        </td>
                        <td class="py-3.5 px-6 text-right">
                          <button data-id="${s.student_id}" class="btn-toggle-student text-[11px] text-rose-600 hover:bg-rose-50 px-2 py-1 rounded border border-rose-200">
                            Reset
                          </button>
                        </td>
                      </tr>
                    `).join('')}
                  </tbody>
                </table>
              </div>
            ` : ''}

            <!-- Tab Content: Not Checked In Yet -->
            ${this.activeRosterTab === 'absent' ? `
              <div class="overflow-x-auto max-h-[560px] overflow-y-auto">
                <table class="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr class="bg-slate-50 text-slate-500 font-semibold border-b border-slate-100 sticky top-0 z-10">
                      <th class="py-3 px-6">Student</th>
                      <th class="py-3 px-6">Student ID</th>
                      <th class="py-3 px-6">Status</th>
                      <th class="py-3 px-6 text-right">Manual Override</th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-slate-100">
                    ${absentList.map(s => `
                      <tr class="roster-row hover:bg-slate-50/70 transition" data-search="${(s.name + ' ' + s.student_id).toLowerCase()}">
                        <td class="py-3.5 px-6">
                          <div class="flex items-center gap-3">
                            <img src="${s.avatar}" loading="lazy" class="w-7 h-7 rounded-full bg-slate-100">
                            <span class="font-bold text-slate-800">${s.name}</span>
                          </div>
                        </td>
                        <td class="py-3.5 px-6 font-mono text-slate-500">${s.student_id}</td>
                        <td class="py-3.5 px-6">
                          <span class="px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-rose-50 text-rose-600 border border-rose-100">
                            Absent
                          </span>
                        </td>
                        <td class="py-3.5 px-6 text-right">
                          <button data-id="${s.student_id}" class="btn-toggle-student text-[11px] text-emerald-600 hover:bg-emerald-50 px-2.5 py-1 rounded border border-emerald-200 font-semibold">
                            Mark Present
                          </button>
                        </td>
                      </tr>
                    `).join('')}
                  </tbody>
                </table>
              </div>
            ` : ''}

            ${this.showLiveSheet ? this.renderLiveSheetPanel() : ''}

            <!-- Tab Content: Photo head count -->
            ${this.activeRosterTab === 'headcount' ? this.renderHeadcountTab() : ''}

            <!-- Tab Content: Manual approvals (phone location blocked) -->
            ${this.activeRosterTab === 'approvals' ? `
              <div class="p-4 space-y-3">
                <div class="text-xs text-slate-500">
                  These students scanned the <strong>current QR code</strong> but their phone won't share its location. Approve only students you can see in the room.
                </div>
                ${pendingApprovals.length === 0 ? `
                  <div class="p-8 text-center text-slate-400 text-xs">No pending requests.</div>
                ` : pendingApprovals.map(r => `
                  <div class="p-3.5 rounded-xl border border-amber-200 bg-amber-50/50 flex items-center justify-between text-xs gap-3">
                    <div class="space-y-0.5">
                      <div class="font-bold text-slate-900">${r.student_name} <span class="font-mono text-[10px] text-slate-500">(${r.student_id})</span></div>
                      <div class="text-amber-800">${r.reason} · ${r.requested_at}</div>
                    </div>
                    <div class="flex gap-1.5 shrink-0">
                      <button data-id="${r.student_id}" data-approve="1" class="btn-resolve-approval px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold">✓ Approve</button>
                      <button data-id="${r.student_id}" data-approve="0" class="btn-resolve-approval px-3 py-1.5 rounded-lg bg-white border border-rose-200 text-rose-700 font-semibold">✕ Reject</button>
                    </div>
                  </div>
                `).join('')}
              </div>
            ` : ''}

            <!-- Tab Content: Flagged Remote Breaches -->
            ${this.activeRosterTab === 'breaches' ? `
              <div class="p-4 space-y-3">
                <div class="text-xs text-slate-500">
                  Blocked check-ins: students <strong>outside the ${this.radiusM()}-meter geofence</strong>, and phones that tried to check in <strong>a second student</strong>:
                </div>
                ${breaches.length === 0 ? `
                  <div class="p-8 text-center text-slate-400 text-xs">No geofence violations detected.</div>
                ` : breaches.map(b => `
                  <div class="p-3.5 rounded-xl border border-rose-200 bg-rose-50/40 flex items-center justify-between text-xs gap-3">
                    <div class="space-y-0.5">
                      <div class="flex items-center gap-2">
                        <span class="font-bold text-slate-900">${b.student_name}</span>
                        <span class="font-mono text-[10px] text-slate-500">(${b.student_id})</span>
                        <span class="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-100 text-rose-800">${b.status === 'rejected_device' ? 'SAME PHONE' : 'BLOCKED'}</span>
                      </div>
                      <div class="text-rose-700 font-medium">${b.message}</div>
                    </div>
                    <div class="text-right font-mono text-slate-500 text-[11px]">
                      <div>${b.timestamp}</div>
                      ${b.status === 'rejected_device' ? '<div class="text-rose-600 font-bold">📵 buddy check-in</div>' : `<div class="text-rose-600 font-bold">${b.distance_meters.toFixed(1)}m away</div>`}
                    </div>
                  </div>
                `).join('')}
              </div>
            ` : ''}
          </div>
        </div>
      </div>
    `;
  }

  /** Online spreadsheet: a live CSV link that Google Sheets / Excel keep in sync. */
  renderLiveSheetPanel() {
    const url = `${QREngine.publicOrigin()}/api/attendance/export.csv`;
    const formula = `=IMPORTDATA("${url}")`;
    const isPublic = window.SERVER_MODE === 'tunnel';
    return `
      <div class="mx-4 mb-2 p-4 rounded-2xl bg-emerald-50 border border-emerald-200 text-xs space-y-2 text-emerald-900">
        <div class="font-bold">🔗 Live attendance spreadsheet</div>
        <ol class="list-decimal ms-4 space-y-1">
          <li>Open a new Google Sheet (<a href="https://sheets.new" target="_blank" rel="noopener" class="underline">sheets.new</a>).</li>
          <li>Paste this into cell <strong>A1</strong> — the sheet fills with the attendance and keeps updating:</li>
        </ol>
        <div class="flex gap-2">
          <code id="live-sheet-formula" class="flex-1 p-2 rounded-lg bg-white border border-emerald-200 font-mono text-[11px] break-all select-all">${formula}</code>
          <button id="btn-copy-formula" class="px-3 rounded-lg bg-emerald-600 text-white font-bold">Copy</button>
        </div>
        <div>Excel: <em>Data → From Web</em> → paste <span class="font-mono break-all">${url}</span>. Or <a href="${url}" target="_blank" rel="noopener" class="underline font-semibold">open the CSV</a>.</div>
        ${isPublic ? '' : `<div class="p-2 rounded-lg bg-amber-100 text-amber-900">⚠️ Google Sheets can only read a <strong>public</strong> link. Start the server with <code>python3 server.py --tunnel</code> for the live sheet. (The CSV file download works anyway.)</div>`}
        <div class="text-emerald-700">Google refreshes IMPORTDATA about once an hour; to refresh now, delete and re-paste the formula.</div>
      </div>`;
  }

  // ==========================================
  // PHOTO HEAD COUNT (instructor)
  // ==========================================
  renderHeadcountTab() {
    const hc = this.headcount || {};
    const latest = this.data.latest_headcount;
    const checkedIn = this.data.present_count;
    const counted = hc.counted;
    const diff = typeof counted === 'number' ? counted - checkedIn : null;
    return `
      <div class="p-4 space-y-4 text-xs">
        <div class="text-slate-500 leading-relaxed">
          Take a photo of the class (or upload one). Faces are counted automatically <strong>in this browser</strong> (the photo is not uploaded)
          and compared with the <strong>${checkedIn}</strong> check-ins. The count never marks anyone present.
        </div>
        <div class="flex flex-wrap gap-2">
          <button id="btn-headcount-photo" class="px-4 py-2.5 bg-slate-800 hover:bg-slate-900 text-white rounded-xl font-bold">📷 Take / upload class photo</button>
          <input id="input-headcount-photo" type="file" accept="image/*" capture="environment" class="hidden">
        </div>
        ${hc.status ? `<div class="p-3 rounded-xl border ${hc.error ? 'bg-rose-50 border-rose-200 text-rose-900' : 'bg-indigo-50 border-indigo-200 text-indigo-900'}">${hc.status}</div>` : ''}
        ${typeof counted === 'number' ? `
          <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div class="p-4 rounded-2xl bg-slate-50 border border-slate-200 text-center">
              <div class="text-slate-500">People in the photo</div>
              <div class="flex items-center justify-center gap-3 mt-1">
                <button id="btn-headcount-minus" class="w-8 h-8 rounded-full bg-white border border-slate-300 font-bold">−</button>
                <span id="headcount-value" class="text-3xl font-extrabold text-slate-900">${counted}</span>
                <button id="btn-headcount-plus" class="w-8 h-8 rounded-full bg-white border border-slate-300 font-bold">+</button>
              </div>
              <div class="text-[10px] text-slate-400 mt-1">detected automatically: ${hc.detected} · fix with − / +</div>
            </div>
            <div class="p-4 rounded-2xl bg-slate-50 border border-slate-200 text-center">
              <div class="text-slate-500">Checked in</div>
              <div class="text-3xl font-extrabold text-indigo-700 mt-1">${checkedIn}</div>
            </div>
            <div class="p-4 rounded-2xl border text-center ${diff === 0 ? 'bg-emerald-50 border-emerald-200 text-emerald-900' : 'bg-amber-50 border-amber-200 text-amber-900'}">
              <div>Difference</div>
              <div class="text-3xl font-extrabold mt-1">${diff > 0 ? '+' : ''}${diff}</div>
              <div class="text-[11px] mt-1">${diff === 0 ? 'Photo matches the check-ins' : diff > 0 ? `${diff} in the room did not check in` : `${-diff} more check-ins than people – possible remote check-ins`}</div>
            </div>
          </div>
          <button id="btn-headcount-save" class="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold">💾 Save this count to the session</button>
          <canvas id="headcount-canvas" class="w-full rounded-xl border border-slate-200"></canvas>
        ` : ''}
        ${latest ? `
          <div class="p-3 rounded-xl bg-white border border-slate-200 text-slate-600">
            <strong>Last saved count (${latest.time}):</strong> ${latest.people_counted} people in the photo
            (auto ${latest.faces_detected}) vs ${latest.checked_in} check-ins — ${latest.verdict}
          </div>` : ''}
      </div>`;
  }

  async handleHeadcountPhoto(file) {
    if (!file) return;
    this.headcount = { status: '🖼️ Opening the photo…' };
    this.render();
    const url = URL.createObjectURL(file);
    const img = new Image();
    try {
      await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = () => reject(new Error('Could not open that image.')); img.src = url; });
      const setStatus = (text) => {
        this.headcount = { ...this.headcount, status: '⏳ ' + text };
        const box = this.container.querySelector('#btn-headcount-photo');
        if (box) this.render();
      };
      const result = await HeadCounter.countFaces(img, { onStatus: setStatus });
      this.headcountImage = img;
      this.headcountBoxes = result.boxes;
      this.headcount = { detected: result.count, counted: result.count,
        status: `✅ Found <strong>${result.count}</strong> faces. Check the green boxes and fix the number with − / + if needed, then save.` };
    } catch (err) {
      this.headcount = { error: true, status: '⚠️ ' + err.message };
    } finally {
      URL.revokeObjectURL(url);
    }
    this.render();
  }

  drawHeadcountCanvas() {
    const canvas = this.container ? this.container.querySelector('#headcount-canvas') : null;
    if (canvas && this.headcountImage) HeadCounter.drawResult(canvas, this.headcountImage, this.headcountBoxes || []);
  }

  async handleSaveHeadcount() {
    const hc = this.headcount || {};
    try {
      const res = await ApiClient.saveHeadcount(hc.detected, hc.counted);
      this.headcount = { ...hc, status: '💾 Saved: ' + res.headcount.verdict };
      await this.fetchData({ full: true });
    } catch (err) {
      this.headcount = { ...hc, error: true, status: '⚠️ ' + err.message };
    }
    this.render();
  }

  /** Fallback when the phone refuses location: request instructor approval. */
  renderApprovalBox(gps, isPresent) {
    if (isPresent) return '';
    if (this.approvalStatus === 'pending') {
      return `<div class="text-[11px] p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-900">
        ⏳ <strong>Waiting for the instructor to approve you.</strong> This page updates automatically.</div>`;
    }
    if (!gps.status || gps.status.type !== 'error') return '';
    const e = this.lastGeoError || {};
    return `
      <div class="text-[11px] p-3 rounded-xl bg-white border border-slate-200 space-y-2">
        <div class="text-slate-700"><strong>Location blocked on this phone? No problem.</strong> Scan/type the current code in step 2, then:</div>
        <button id="btn-verify-network" class="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold">📶 Check my location by Wi-Fi</button>
        <div class="text-slate-500">Works without location permission: your phone must be on the <strong>same Wi-Fi as the instructor</strong> (turn off mobile data).</div>
        <button id="btn-request-approval" class="w-full py-2 bg-white hover:bg-amber-50 text-amber-700 border border-amber-300 rounded-xl font-bold">🙋 Still not working? Ask the instructor to approve me</button>
        <details class="text-slate-500">
          <summary class="cursor-pointer">Technical details (send to the developer)</summary>
          <div class="font-mono text-[10px] break-all pt-1">
            error code: ${e.code ?? '—'} · message: ${e.message || '—'}<br>
            permission: ${e.permission || '—'} · secure: ${window.isSecureContext} · origin: ${window.location.origin}<br>
            browser: ${navigator.userAgent}
          </div>
        </details>
      </div>`;
  }

  async handleVerifyByNetwork() {
    const input = this.container.querySelector('#input-student-qr-token');
    if (input && input.value.trim()) this.scannedQrToken = QREngine.extractToken(input.value);
    if (!this.scannedQrToken) {
      this.verificationFeedback = { success: false, reason: 'missing_qr', message: 'First scan the QR code (or type the 6-character code) in step 2.' };
      this.render();
      return;
    }
    this.submitting = true;
    this.render();
    try {
      const res = await ApiClient.verifyByNetwork({ studentId: this.state.currentStudentId, qrToken: this.scannedQrToken });
      this.verificationFeedback = res;
      if (res.reason === 'device_already_used' && res.device_student_id) {
        this.lockedStudentId = res.device_student_id;
        this.state.currentStudentId = res.device_student_id;
      }
      if (res.success) this.lockedStudentId = this.state.currentStudentId;
      if (res.reason === 'invalid_qr') this.scannedQrToken = '';
      await this.fetchData();
    } catch (err) {
      this.verificationFeedback = { success: false, reason: 'network_error', message: 'Could not reach the server: ' + err.message };
    } finally {
      this.submitting = false;
      this.render();
    }
  }

  async handleRequestApproval() {
    const input = this.container.querySelector('#input-student-qr-token');
    if (input && input.value.trim()) this.scannedQrToken = QREngine.extractToken(input.value);
    if (!this.scannedQrToken) {
      this.verificationFeedback = { success: false, reason: 'missing_qr', message: 'First scan the QR code (or type the 6-character code) in step 2 — it proves you are in the classroom right now.' };
      this.render();
      return;
    }
    try {
      const e = this.lastGeoError || {};
      const res = await ApiClient.requestApproval({
        studentId: this.state.currentStudentId,
        qrToken: this.scannedQrToken,
        reason: `Location unavailable (code ${e.code ?? '?'}: ${e.message || 'unknown'})`
      });
      this.approvalStatus = res.status === 'approved' ? 'approved' : 'pending';
      if (res.status !== 'approved') this.lockedStudentId = this.state.currentStudentId;
      this.verificationFeedback = { success: res.status === 'approved', reason: 'approval', message: res.message };
      await this.fetchData();
    } catch (err) {
      this.verificationFeedback = { success: false, reason: /phone/.test(err.message) ? 'device_already_used' : 'invalid_qr', message: err.message };
    }
    this.render();
  }

  renderScanStatus() {
    if (!this.scanStatus) return '<div id="scan-status-box" class="hidden"></div>';
    const styles = {
      info: 'bg-indigo-50 border-indigo-200 text-indigo-900',
      success: 'bg-emerald-50 border-emerald-200 text-emerald-900',
      error: 'bg-rose-50 border-rose-200 text-rose-900'
    };
    return `<div id="scan-status-box" role="status" class="p-3 rounded-xl border text-[11px] leading-relaxed ${styles[this.scanStatus.type] || styles.info}">${this.scanStatus.message}</div>`;
  }

  renderFeedback() {
    const fb = this.verificationFeedback;
    if (!fb) return '';
    const titles = {
      invalid_qr: '⌛ Invalid or expired QR code',
      distance_exceeded: `📍 Outside the ${this.radiusM()} m classroom radius`,
      session_closed: '⏸️ No active session',
      student_not_found: '👤 Student not found',
      missing_qr: '🔳 QR code needed',
      missing_gps: '📍 Location needed',
      network_error: '📶 Connection problem',
      device_already_used: '📵 This phone already checked in another student',
      different_network: '📶 Not on the classroom Wi-Fi'
    };
    const title = fb.success ? '🎉 Attendance recorded!' : (titles[fb.reason] || '✕ Check-in rejected');
    const tone = fb.success
      ? 'bg-emerald-50 border-emerald-300 text-emerald-900'
      : fb.reason === 'distance_exceeded'
        ? 'bg-rose-50 border-rose-300 text-rose-900'
        : 'bg-amber-50 border-amber-300 text-amber-900';
    const hint = fb.reason === 'invalid_qr'
      ? '<p class="text-[11px] opacity-80">The code rotates every 20 seconds. Scan the code currently on the instructor\'s screen again.</p>'
      : '';
    return `
      <div id="verification-feedback" class="p-4 rounded-2xl border text-xs space-y-1.5 ${tone}">
        <div class="font-bold text-sm">${title}</div>
        <p class="leading-relaxed font-medium">${fb.message || ''}</p>
        ${hint}
        ${typeof fb.distance_meters === 'number' ? `
          <div class="font-mono text-[11px] opacity-80 pt-1">
            Measured distance: ${fb.distance_meters.toFixed(1)}m • Limit: ${(fb.allowed_radius_meters || this.radiusM()).toFixed(0)}m
          </div>` : ''}
      </div>`;
  }

  /**
   * Renders Student Interface (Mobile Optimized)
   */
  renderStudentView() {
    const students = this.data.students || [];
    const student = students.find(s => s.student_id === this.state.currentStudentId);
    const isPresent = student ? student.is_present : false;
    const radius = this.radiusM();
    const gps = this.studentGps;
    const isWithinRange = gps.acquired && gps.distance <= radius;
    const sessionOpen = this.session.is_active !== false;
    const gpsStatusStyles = {
      info: 'text-indigo-700', success: 'text-emerald-700', error: 'text-rose-700'
    };

    return `
      <div class="max-w-md mx-auto bg-white rounded-3xl border border-slate-200 shadow-xl overflow-hidden">
        <!-- Header -->
        <div class="bg-slate-900 text-white p-5 space-y-3">
          <div class="flex items-center justify-between text-xs text-slate-400">
            <span>👨‍🎓 Student Check-In</span>
            <span class="font-mono">${this.session.course_name || ''}</span>
          </div>
          <div class="flex items-center gap-3">
            <img src="${student ? student.avatar : ''}" class="w-10 h-10 rounded-full border-2 border-indigo-400 bg-slate-800">
            <div class="flex-1 min-w-0">
              <label for="select-student" class="block text-[10px] uppercase tracking-wider text-slate-400 font-semibold">I am</label>
              <select id="select-student" ${this.lockedStudentId ? 'disabled' : ''} class="w-full bg-slate-800 text-white text-sm font-bold rounded-lg px-2 py-1 border border-slate-700 disabled:opacity-90">
                ${[...students].sort((a, b) => a.name.localeCompare(b.name)).map(s => `<option value="${s.student_id}" ${s.student_id === this.state.currentStudentId ? 'selected' : ''}>${s.name} (${s.student_id})</option>`).join('')}
              </select>
            </div>
            <span class="px-2.5 py-1 rounded-full text-xs font-bold ${isPresent ? 'bg-emerald-500' : 'bg-amber-500'} text-white whitespace-nowrap">
              ${isPresent ? '✓ Present' : 'Not checked in'}
            </span>
          </div>
          ${this.lockedStudentId ? `
          <div class="text-[11px] bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-slate-300">
            🔒 This phone is registered to <strong class="text-white">${(students.find(x => x.student_id === this.lockedStudentId) || {}).name || this.lockedStudentId}</strong> for this session. Each student checks in from their own phone.
          </div>` : `
          <input id="student-picker-search" type="search" autocomplete="off" placeholder="🔍 Find your name or ID (${students.length} students)…"
            class="w-full bg-slate-800 text-white placeholder-slate-400 text-xs rounded-lg px-3 py-2 border border-slate-700">
          <details id="student-register" class="text-[11px] text-slate-300" ${this.registerOpen ? 'open' : ''}>
            <summary class="cursor-pointer">Not on the list? Add yourself</summary>
            <div class="flex flex-col sm:flex-row gap-2 pt-2">
              <input id="register-id" type="text" inputmode="numeric" autocomplete="off" placeholder="Student ID"
                class="sm:w-32 bg-slate-800 text-white text-xs rounded-lg px-3 py-2 border border-slate-700">
              <input id="register-name" type="text" autocomplete="name" placeholder="Full name"
                class="flex-1 bg-slate-800 text-white text-xs rounded-lg px-3 py-2 border border-slate-700">
              <button id="btn-register-student" class="px-3 py-2 bg-indigo-500 hover:bg-indigo-600 text-white rounded-lg font-bold text-xs">Add</button>
            </div>
            ${this.registerMessage ? `<div class="pt-1 ${this.registerMessage.ok ? 'text-emerald-300' : 'text-rose-300'}">${this.registerMessage.text}</div>` : ''}
          </details>`}
          ${sessionOpen ? '' : `
            <div class="text-[11px] bg-amber-500/20 border border-amber-400/40 text-amber-200 rounded-lg px-3 py-2">
              ⏸️ The instructor hasn't started a session yet. Check-ins open when the instructor presses "Start Session".
            </div>`}
        </div>

        <div class="p-5 space-y-5 text-xs">
          <!-- Step 1: Location (separate from the QR / camera) -->
          <div class="p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-3">
            <div class="flex items-center justify-between">
              <span class="font-bold text-slate-800 flex items-center gap-1.5">
                <span class="w-5 h-5 rounded-full bg-indigo-600 text-white flex items-center justify-center text-[10px]">1</span>
                Check your location
              </span>
              <span class="text-[10px] font-mono text-slate-400">must be ≤ ${radius.toFixed(0)}m</span>
            </div>

            <div class="text-slate-600">Classroom: <strong>${this.session.classroom_name}</strong> · <a href="/gps" target="_blank" rel="noopener" class="underline text-indigo-600">simple location test page</a></div>

            <div class="p-3 rounded-xl border ${
              !gps.acquired ? 'bg-white border-slate-200 text-slate-600'
                : isWithinRange ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                : 'bg-rose-50 border-rose-200 text-rose-900'
            }">
              <div class="flex items-center justify-between">
                <span class="font-semibold">Distance to classroom:</span>
                <span id="student-distance" class="font-bold text-sm font-mono">${gps.acquired ? `${gps.distance.toFixed(1)}m` : 'not acquired'}</span>
              </div>
              <div class="text-[11px] mt-0.5">
                ${!gps.acquired ? 'Location is requested automatically after the scan, or tap the button below.'
                  : isWithinRange ? `✓ Within the ${radius.toFixed(0)}m classroom radius.`
                  : `✕ More than ${radius.toFixed(0)}m away — check-in will be rejected.`}
                ${gps.isSimulated ? ' <em>(simulated)</em>' : ''}
              </div>
            </div>
            ${gps.status ? (gps.status.denied
              ? `<div id="gps-denied-help" class="text-[11px] leading-relaxed p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-900">${gps.status.message}</div>`
              : `<div class="text-[11px] ${gpsStatusStyles[gps.status.type] || ''}">${gps.status.message}</div>`) : ''}

            ${this.renderApprovalBox(gps, isPresent)}

            <button id="btn-acquire-student-gps" class="w-full py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold transition shadow-sm">
              📍 ${gps.acquired ? 'Check my location again' : 'Check my location'}
            </button>

          </div>

          <!-- Step 2: QR code (separate from location) -->
          <div class="p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-3">
            <div class="flex items-center justify-between">
              <span class="font-bold text-slate-800 flex items-center gap-1.5">
                <span class="w-5 h-5 rounded-full bg-indigo-600 text-white flex items-center justify-center text-[10px]">2</span>
                Scan the instructor's QR code
              </span>
              ${this.scannedQrToken ? '<span class="text-[10px] font-bold text-emerald-600">✓ Code ready</span>' : ''}
            </div>

            ${this.cameraActive ? `
              <div class="reticle-box bg-slate-900 rounded-2xl relative overflow-hidden aspect-square sm:aspect-[4/3]">
                <video id="camera-scanner-video" class="w-full h-full object-cover" autoplay muted playsinline></video>
                <div class="scanner-laser"></div>
              </div>
              <button id="btn-stop-camera" class="w-full py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-xl font-bold transition">
                ⏹ Stop Camera
              </button>
            ` : `
              <button id="btn-start-camera" class="w-full py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold transition flex items-center justify-center gap-2 shadow-sm">
                <span>📷</span> Start Camera &amp; Scan QR
              </button>
            `}

            ${this.renderScanStatus()}

            <!-- Manual fallback -->
            <div class="pt-1 space-y-1">
              <label for="input-student-qr-token" class="block text-slate-500 font-semibold">Camera not working? Type the code shown under the QR:</label>
              <input id="input-student-qr-token" type="text" inputmode="text" autocomplete="off" autocapitalize="characters" spellcheck="false"
                placeholder="e.g. K7Q2MX" value="${this.scannedQrToken}"
                class="w-full p-2.5 border rounded-xl font-mono text-sm tracking-widest uppercase focus:ring-2 focus:ring-indigo-500 bg-white">
            </div>

            <div class="flex flex-wrap gap-1.5 pt-1">
              <button id="btn-upload-qr-photo" class="flex-1 py-2 bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 rounded-xl font-semibold transition text-[11px]">
                📁 Scan from photo
              </button>
              <input id="input-qr-file-upload" type="file" accept="image/*" class="hidden">
            </div>
          </div>

          <!-- Step 3: Verify -->
          <button id="btn-submit-verification" ${this.submitting ? 'disabled' : ''} class="w-full py-3 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 disabled:opacity-60 text-white rounded-2xl font-extrabold text-sm shadow-md transition flex items-center justify-center gap-2">
            ${this.submitting ? '⏳ Verifying…' : '✅ Verify &amp; Check In'}
          </button>

          ${this.renderFeedback()}
        </div>
      </div>
    `;
  }

  attachEventListeners() {
    // Instructor Location Save
    const btnSaveLoc = this.container.querySelector('#btn-save-classroom-loc');
    if (btnSaveLoc) {
      btnSaveLoc.addEventListener('click', () => {
        const name = this.container.querySelector('#input-classroom-name').value;
        const lat = parseFloat(this.container.querySelector('#input-classroom-lat').value);
        const lng = parseFloat(this.container.querySelector('#input-classroom-lng').value);
        this.handleUpdateLocation(lat, lng, name);
      });
    }

    // Auto Fetch Instructor GPS
    const btnFetchMyGps = this.container.querySelector('#btn-fetch-my-gps');
    if (btnFetchMyGps) {
      btnFetchMyGps.addEventListener('click', () => this.handleFetchInstructorGPS());
    }

    // Campus Preset Dropdown
    const selectPreset = this.container.querySelector('#select-campus-preset');
    if (selectPreset) {
      selectPreset.addEventListener('change', (e) => {
        const val = e.target.value;
        if (val) {
          const [lat, lng, name] = val.split(',');
          this.handleUpdateLocation(parseFloat(lat), parseFloat(lng), name);
        }
      });
    }

    // QR Mode Switchers
    const btnDyn = this.container.querySelector('#btn-set-dynamic-qr');
    if (btnDyn) {
      btnDyn.addEventListener('click', () => this.handleToggleQrMode('dynamic'));
    }
    const btnStatic = this.container.querySelector('#btn-set-static-qr');
    if (btnStatic) {
      btnStatic.addEventListener('click', () => this.handleToggleQrMode('static'));
    }

    // Roster Tab Switchers
    this.container.querySelectorAll('.btn-roster-tab').forEach(btn => {
      btn.addEventListener('click', (e) => {
        this.activeRosterTab = e.currentTarget.getAttribute('data-tab');
        this.render();
      });
    });

    // Student GPS Handlers
    const btnStudentGps = this.container.querySelector('#btn-acquire-student-gps');
    if (btnStudentGps) {
      btnStudentGps.addEventListener('click', () => {
        if (this.cameraActive) this.stopCameraScanner(); // location and camera never at the same time
        this.handleAcquireStudentGPS();                    // getCurrentPosition() runs inside this tap
      });
    }
    const btnStartCam = this.container.querySelector('#btn-start-camera');
    if (btnStartCam) {
      btnStartCam.addEventListener('click', () => this.startCameraScanner());
    }
    const btnStopCam = this.container.querySelector('#btn-stop-camera');
    if (btnStopCam) {
      btnStopCam.addEventListener('click', () => {
        this.stopCameraScanner();
        this.render();
      });
    }

    // Photo File Upload Controls
    const btnUploadPhoto = this.container.querySelector('#btn-upload-qr-photo');
    const inputPhotoFile = this.container.querySelector('#input-qr-file-upload');
    if (btnUploadPhoto && inputPhotoFile) {
      btnUploadPhoto.addEventListener('click', () => inputPhotoFile.click());
      inputPhotoFile.addEventListener('change', (e) => {
        if (e.target.files && e.target.files[0]) {
          this.handleFileUploadScan(e.target.files[0]);
        }
      });
    }

    // Testing shortcuts (student view)
    // Manual code input: keep state in sync so re-renders never wipe what the student typed
    const tokenInput = this.container.querySelector('#input-student-qr-token');
    if (tokenInput) {
      tokenInput.addEventListener('input', (e) => {
        this.scannedQrToken = e.target.value.trim();
      });
      tokenInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') this.handleSubmitVerification();
      });
    }

    // Roster search (instructor) – filters rows in place, no re-render
    const rosterSearch = this.container.querySelector('#roster-search');
    if (rosterSearch) {
      rosterSearch.addEventListener('input', (e) => {
        this.rosterFilter = e.target.value;
        this.applyRosterFilter();
      });
    }
    this.applyRosterFilter();

    // Student name picker search – filters <option>s and auto-selects a single match
    const pickerSearch = this.container.querySelector('#student-picker-search');
    if (pickerSearch) {
      pickerSearch.addEventListener('input', (e) => {
        const q = e.target.value.trim().toLowerCase();
        const select = this.container.querySelector('#select-student');
        if (!select) return;
        const matches = [];
        Array.from(select.options).forEach(opt => {
          const hit = !q || opt.textContent.toLowerCase().includes(q);
          opt.hidden = !hit;
          opt.disabled = !hit;
          if (hit) matches.push(opt);
        });
        if (q && matches.length >= 1 && (matches.length === 1 || select.selectedOptions[0]?.hidden)) {
          select.value = matches[0].value;
          this.state.currentStudentId = matches[0].value; // silent: no re-render while typing
          AppState.storageSet('cs302_student_id', matches[0].value);
          this.verificationFeedback = null;
        }
      });
    }

    // Self-registration
    const registerBox = this.container.querySelector('#student-register');
    if (registerBox) {
      registerBox.addEventListener('toggle', () => { this.registerOpen = registerBox.open; });
    }
    const btnRegister = this.container.querySelector('#btn-register-student');
    if (btnRegister) {
      btnRegister.addEventListener('click', () => this.handleRegisterStudent());
    }

    // Live spreadsheet panel
    const btnLiveSheet = this.container.querySelector('#btn-live-sheet');
    if (btnLiveSheet) btnLiveSheet.addEventListener('click', () => { this.showLiveSheet = !this.showLiveSheet; this.render(); });
    const btnCopyFormula = this.container.querySelector('#btn-copy-formula');
    if (btnCopyFormula) {
      btnCopyFormula.addEventListener('click', async () => {
        const text = this.container.querySelector('#live-sheet-formula').textContent;
        try { await navigator.clipboard.writeText(text); btnCopyFormula.textContent = 'Copied ✓'; }
        catch (e) { window.prompt('Copy this formula:', text); }
      });
    }

    // Photo head count
    const btnHcPhoto = this.container.querySelector('#btn-headcount-photo');
    const inputHcPhoto = this.container.querySelector('#input-headcount-photo');
    if (btnHcPhoto && inputHcPhoto) {
      btnHcPhoto.addEventListener('click', () => inputHcPhoto.click());
      inputHcPhoto.addEventListener('change', (e) => this.handleHeadcountPhoto(e.target.files[0]));
    }
    const adjust = (delta) => {
      if (!this.headcount || typeof this.headcount.counted !== 'number') return;
      this.headcount = { ...this.headcount, counted: Math.max(0, this.headcount.counted + delta) };
      this.render();
    };
    const btnMinus = this.container.querySelector('#btn-headcount-minus');
    if (btnMinus) btnMinus.addEventListener('click', () => adjust(-1));
    const btnPlus = this.container.querySelector('#btn-headcount-plus');
    if (btnPlus) btnPlus.addEventListener('click', () => adjust(+1));
    const btnHcSave = this.container.querySelector('#btn-headcount-save');
    if (btnHcSave) btnHcSave.addEventListener('click', () => this.handleSaveHeadcount());
    this.drawHeadcountCanvas();

    const btnNetwork = this.container.querySelector('#btn-verify-network');
    if (btnNetwork) btnNetwork.addEventListener('click', () => this.handleVerifyByNetwork());

    const btnApproval = this.container.querySelector('#btn-request-approval');
    if (btnApproval) btnApproval.addEventListener('click', () => this.handleRequestApproval());

    // Instructor: approve / reject manual requests
    this.container.querySelectorAll('.btn-resolve-approval').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const id = e.currentTarget.getAttribute('data-id');
        const approve = e.currentTarget.getAttribute('data-approve') === '1';
        try {
          await ApiClient.resolveApproval(id, approve);
          await this.fetchData();
          this.render();
        } catch (err) {
          alert('Could not update the request: ' + err.message);
        }
      });
    });

    // "copy the link" (in the location help for in-app browsers)
    this.container.querySelectorAll('.btn-copy-url').forEach(btn => {
      btn.addEventListener('click', async () => {
        const url = btn.getAttribute('data-copy-url');
        try { await navigator.clipboard.writeText(url); btn.textContent = 'link copied ✓'; }
        catch (e) { window.prompt('Copy this link:', url); }
      });
    });

    // Student profile selector
    const selectStudent = this.container.querySelector('#select-student');
    if (selectStudent) {
      selectStudent.addEventListener('change', (e) => this.state.setCurrentStudent(e.target.value));
    }

    // Student Verification Submit
    const btnSubmitVerify = this.container.querySelector('#btn-submit-verification');
    if (btnSubmitVerify) {
      btnSubmitVerify.addEventListener('click', () => this.handleSubmitVerification());
    }

    // Instructor session controls
    const btnStartSession = this.container.querySelector('#btn-start-session');
    if (btnStartSession) {
      btnStartSession.addEventListener('click', () => this.handleStartSession());
    }
    const btnEndSession = this.container.querySelector('#btn-end-session');
    if (btnEndSession) {
      btnEndSession.addEventListener('click', () => this.handleEndSession());
    }

    // Individual toggle buttons
    this.container.querySelectorAll('.btn-toggle-student').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const studentId = e.currentTarget.getAttribute('data-id');
        try {
          await ApiClient.toggleAttendance(studentId);
          await this.fetchData();
          this.render();
        } catch (err) {
          alert('Toggle error: ' + err.message);
        }
      });
    });

    // Face scan simulator
    const btnPhoto = this.container.querySelector('#btn-photo-scan');
    if (btnPhoto) {
      btnPhoto.addEventListener('click', async () => {
        const count = prompt('Simulate Photo Scan: Enter number of faces detected in camera (1-10):', '8');
        if (count !== null) {
          const num = parseInt(count, 10);
          if (!isNaN(num)) {
            await ApiClient.simulatePhotoScan(num);
            await this.fetchData();
            this.render();
          }
        }
      });
    }

    // Export CSV
    const btnExport = this.container.querySelector('#btn-export-csv');
    if (btnExport) {
      btnExport.addEventListener('click', () => {
        let csv = "Student ID,Name,Status,Distance (m),Check-In Time,Method\n";
        this.data.students.forEach(s => {
          csv += `"${s.student_id}","${String(s.name).replace(/"/g, '""')}","${s.is_present ? 'Present' : 'Absent'}","${s.distance_meters !== null ? s.distance_meters : ''}","${s.check_in_time || ''}","${s.check_in_method}"\n`;
        });
        // \uFEFF (BOM) makes Excel read the file as UTF-8, so Hebrew names display correctly
        const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `attendance_geofence_${new Date().toISOString().slice(0,10)}.csv`;
        a.click();
      });
    }
  }
}
