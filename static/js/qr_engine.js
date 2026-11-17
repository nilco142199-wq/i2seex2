/**
 * QREngine
 * Universal, 100% Offline-Ready QR Generator & Scanner Engine.
 * - Standards-compliant QR rendering powered by local vendor/qrcode.min.js (David Shim)
 * - Rock-solid, universal camera frame decoding powered by local vendor/jsQR.min.js
 * - Hardware-accelerated BarcodeDetector fallback
 * - Web Audio API audio confirmation chime
 */
class QREngine {
  /**
   * Renders a real, standards-compliant QR code into containerElement.
   */
  static renderQR(containerElement, text, size = 200) {
    if (!containerElement) return;
    containerElement.innerHTML = '';

    // Primary: Use local QRCode library (David Shim)
    if (typeof QRCode !== 'undefined') {
      try {
        new QRCode(containerElement, {
          text: text,
          width: size,
          height: size,
          colorDark: '#0f172a',
          colorLight: '#ffffff',
          correctLevel: QRCode.CorrectLevel.M
        });
        return;
      } catch (e) {
        console.warn('QRCode render error:', e);
      }
    }

    // Secondary fallback: Built-in SVG matrix
    if (window.PureQREncoder) {
      try {
        const matrix = window.PureQREncoder.encode(text);
        const n = matrix.length;
        const cellSize = (size / n).toFixed(2);
        let rects = '';

        for (let r = 0; r < n; r++) {
          for (let c = 0; c < n; c++) {
            if (matrix[r][c]) {
              const x = (c * cellSize).toFixed(2);
              const y = (r * cellSize).toFixed(2);
              rects += `<rect x="${x}" y="${y}" width="${cellSize}" height="${cellSize}" fill="#0f172a" />`;
            }
          }
        }

        containerElement.innerHTML = `
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" class="mx-auto rounded-xl p-2 bg-white shadow-inner">
            <rect width="${size}" height="${size}" fill="#ffffff" rx="8" />
            ${rects}
          </svg>
        `;
        return;
      } catch (err) {
        console.error('PureQREncoder fallback failed:', err);
      }
    }

    containerElement.innerHTML = `<div class="p-4 text-xs text-rose-500">QR Engine not initialized.</div>`;
  }

  /**
   * Universal QR Decoder: Decodes from HTMLVideoElement, HTMLImageElement, or HTMLCanvasElement.
   * Uses jsQR (pure CPU pixel decoder) + native BarcodeDetector.
   */
  static async detectBarcode(sourceElement) {
    if (!sourceElement) return null;

    // Determine dimensions
    let width = 0, height = 0;
    if (sourceElement instanceof HTMLVideoElement) {
      width = sourceElement.videoWidth || 640;
      height = sourceElement.videoHeight || 480;
    } else if (sourceElement instanceof HTMLImageElement) {
      width = sourceElement.naturalWidth || sourceElement.width;
      height = sourceElement.naturalHeight || sourceElement.height;
    } else if (sourceElement instanceof HTMLCanvasElement) {
      width = sourceElement.width;
      height = sourceElement.height;
    }

    if (width === 0 || height === 0) return null;

    // Strategy 1: jsQR (100% universal across all browsers on canvas pixel buffer)
    if (typeof jsQR !== 'undefined') {
      try {
        const offCanvas = document.createElement('canvas');
        offCanvas.width = width;
        offCanvas.height = height;
        const ctx = offCanvas.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(sourceElement, 0, 0, width, height);

        const imageData = ctx.getImageData(0, 0, width, height);
        const code = jsQR(imageData.data, imageData.width, imageData.height, {
          inversionAttempts: 'dontInvert'
        });

        if (code && code.data && code.data.trim().length > 0) {
          return code.data.trim();
        }
      } catch (e) {
        console.warn('jsQR scan error:', e);
      }
    }

    // Strategy 2: Native Web BarcodeDetector API (if supported in browser)
    if ('BarcodeDetector' in window) {
      try {
        const detector = new window.BarcodeDetector({ formats: ['qr_code'] });
        const barcodes = await detector.detect(sourceElement);
        if (barcodes && barcodes.length > 0) {
          return barcodes[0].rawValue.trim();
        }
      } catch (err) {
        // Fallback tick
      }
    }

    return null;
  }

  /**
   * Plays a quick audio beep on successful QR scan.
   */
  static playSuccessBeep() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, ctx.currentTime); // A5
      gain.gain.setValueAtTime(0.2, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.15);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.15);
    } catch (e) {
      // Audio not allowed without user gesture
    }
  }
}

window.QREngine = QREngine;
