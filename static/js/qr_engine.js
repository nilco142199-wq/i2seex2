/**
 * QREngine
 * Offline QR generator + scanner helpers.
 * - Generation: local vendor/qrcode.min.js (David Shim)
 * - Decoding: native BarcodeDetector when available, otherwise local vendor/jsQR.min.js
 * - Payload helpers: the QR encodes a deep link (…/?role=student&token=…) so that a phone's
 *   built-in camera app can also open Student Mode with the code pre-filled.
 */
class QREngine {
  /** Builds the text that goes inside the QR code. */
  static isLocalhostPage() {
    const h = window.location.hostname;
    return h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '[::1]';
  }

  /** Address other devices (phones) must use. "localhost" only works on this computer. */
  static publicOrigin() {
    if (QREngine.isLocalhostPage() && QREngine.lanOrigin) return QREngine.lanOrigin;
    return window.location.origin;
  }

  static buildPayload(token) {
    return `${QREngine.publicOrigin()}/?role=student&token=${encodeURIComponent(token)}`;
  }

  /**
   * Extracts the attendance token from whatever was scanned or typed:
   * a deep-link URL, a raw "QR_…" token, or a short 6-character code.
   */
  static extractToken(raw) {
    if (!raw) return '';
    let value = String(raw).trim();
    if (/[?&](token|code)=/.test(value)) {
      try {
        const url = new URL(value, window.location.origin);
        value = (url.searchParams.get('token') || url.searchParams.get('code') || value).trim();
      } catch (e) { /* not a URL – keep raw value */ }
    }
    if (/^QR_/i.test(value)) return value;
    return value.replace(/[\s\-_]/g, '').toUpperCase();
  }

  /** Renders a standards-compliant QR code into containerElement. */
  static renderQR(containerElement, text, size = 220) {
    if (!containerElement) return false;
    containerElement.innerHTML = '';

    if (typeof QRCode === 'undefined') {
      containerElement.innerHTML = '<div class="p-4 text-xs text-rose-500">QR library failed to load (static/js/vendor/qrcode.min.js).</div>';
      return false;
    }

    try {
      new QRCode(containerElement, {
        text,
        width: size,
        height: size,
        colorDark: '#000000',
        colorLight: '#ffffff',
        correctLevel: QRCode.CorrectLevel.M
      });
      // qrcode.js adds a tooltip with the payload – not needed
      containerElement.removeAttribute('title');
      // White quiet-zone border around the code helps phone cameras lock on
      containerElement.querySelectorAll('img, canvas').forEach(el => {
        el.style.background = '#fff';
        el.style.padding = '12px';
        el.style.borderRadius = '12px';
      });
      return true;
    } catch (e) {
      console.warn('QRCode render error:', e);
      containerElement.innerHTML = '<div class="p-4 text-xs text-rose-500">Could not render QR code. Use the short code below.</div>';
      return false;
    }
  }

  static _getCanvas() {
    if (!QREngine._canvas) {
      QREngine._canvas = document.createElement('canvas');
      QREngine._ctx = QREngine._canvas.getContext('2d', { willReadFrequently: true });
    }
    return QREngine._canvas;
  }

  static async _getNativeDetector() {
    if (QREngine._nativeDetector !== undefined) return QREngine._nativeDetector;
    QREngine._nativeDetector = null;
    try {
      if ('BarcodeDetector' in window) {
        const formats = await window.BarcodeDetector.getSupportedFormats();
        if (formats.includes('qr_code')) {
          QREngine._nativeDetector = new window.BarcodeDetector({ formats: ['qr_code'] });
        }
      }
    } catch (e) {
      QREngine._nativeDetector = null;
    }
    return QREngine._nativeDetector;
  }

  /**
   * Decodes a QR code from an HTMLVideoElement, HTMLImageElement or HTMLCanvasElement.
   * @param {boolean} thorough  try inverted colours too (slower – used for photo uploads)
   * @returns {Promise<string|null>} raw decoded text
   */
  static async detectBarcode(sourceElement, thorough = false) {
    if (!sourceElement) return null;

    let width = 0, height = 0;
    if (sourceElement instanceof HTMLVideoElement) {
      width = sourceElement.videoWidth;
      height = sourceElement.videoHeight;
    } else if (sourceElement instanceof HTMLImageElement) {
      width = sourceElement.naturalWidth || sourceElement.width;
      height = sourceElement.naturalHeight || sourceElement.height;
    } else if (sourceElement instanceof HTMLCanvasElement) {
      width = sourceElement.width;
      height = sourceElement.height;
    }
    if (!width || !height) return null;

    // Strategy 1: native BarcodeDetector (fast, hardware accelerated – Chrome/Android/Edge)
    const native = await QREngine._getNativeDetector();
    if (native) {
      try {
        const codes = await native.detect(sourceElement);
        if (codes && codes.length && codes[0].rawValue) return codes[0].rawValue.trim();
      } catch (e) { /* fall through to jsQR */ }
    }

    // Strategy 2: jsQR on a (down-scaled) pixel buffer – works in every browser incl. iOS Safari
    if (typeof jsQR === 'undefined') return null;
    const maxSide = 900;
    const scale = Math.min(1, maxSide / Math.max(width, height));
    const w = Math.round(width * scale);
    const h = Math.round(height * scale);

    const canvas = QREngine._getCanvas();
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
    const ctx = QREngine._ctx;
    try {
      ctx.drawImage(sourceElement, 0, 0, w, h);
      const imageData = ctx.getImageData(0, 0, w, h);
      const code = jsQR(imageData.data, w, h, {
        inversionAttempts: thorough ? 'attemptBoth' : 'dontInvert'
      });
      if (code && code.data && code.data.trim()) return code.data.trim();
    } catch (e) {
      console.warn('jsQR scan error:', e);
    }
    return null;
  }

  /** Short confirmation beep after a successful scan. */
  static playSuccessBeep() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      gain.gain.setValueAtTime(0.2, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.15);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.15);
    } catch (e) { /* audio needs a user gesture on some browsers */ }
    try { if (navigator.vibrate) navigator.vibrate(80); } catch (e) { /* ignore */ }
  }
}

window.QREngine = QREngine;
