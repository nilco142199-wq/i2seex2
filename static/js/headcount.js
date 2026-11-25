/**
 * HeadCounter
 * Counts the people in a class photo, entirely in the instructor's browser (the photo never
 * leaves the device). Uses face-api (TensorFlow.js, SSD-MobileNet-v1 face detector), loaded
 * on first use from the jsDelivr CDN.
 *
 * Lecture-hall photos have many small faces, so large photos are split into overlapping
 * tiles, each tile is analysed separately, and duplicate boxes are merged (non-max suppression).
 *
 * The count NEVER marks anyone present – it is only compared with the number of check-ins.
 */
class HeadCounter {
  static LIB_URL = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1/dist/face-api.js';
  static MODEL_URL = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1/model/';

  /** Loads the library + model once. Throws a readable error when offline. */
  static async ensureModel(onStatus = () => {}) {
    if (HeadCounter._ready) return HeadCounter._ready;
    HeadCounter._ready = (async () => {
      if (typeof window.faceapi === 'undefined') {
        onStatus('Downloading the face-detection library (first time only)…');
        await new Promise((resolve, reject) => {
          const script = document.createElement('script');
          script.src = HeadCounter.LIB_URL;
          script.async = true;
          script.onload = resolve;
          script.onerror = () => reject(new Error('Could not download the face-detection library. Check the internet connection.'));
          document.head.appendChild(script);
        });
      }
      onStatus('Loading the face-detection model…');
      await window.faceapi.nets.ssdMobilenetv1.loadFromUri(HeadCounter.MODEL_URL);
      return true;
    })();
    try {
      return await HeadCounter._ready;
    } catch (err) {
      HeadCounter._ready = null; // allow a retry
      throw err;
    }
  }

  /** Splits a W×H image into overlapping tiles of roughly `tile` px. */
  static tiles(width, height, tile = 900, overlap = 0.25) {
    const step = Math.round(tile * (1 - overlap));
    const xs = [], ys = [];
    for (let x = 0; ; x += step) { xs.push(Math.min(x, Math.max(0, width - tile))); if (x + tile >= width) break; }
    for (let y = 0; ; y += step) { ys.push(Math.min(y, Math.max(0, height - tile))); if (y + tile >= height) break; }
    const out = [];
    for (const y of [...new Set(ys)]) for (const x of [...new Set(xs)]) {
      out.push({ x, y, w: Math.min(tile, width), h: Math.min(tile, height) });
    }
    return out;
  }

  static iou(a, b) {
    const x1 = Math.max(a.x, b.x), y1 = Math.max(a.y, b.y);
    const x2 = Math.min(a.x + a.width, b.x + b.width), y2 = Math.min(a.y + a.height, b.y + b.height);
    const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
    const union = a.width * a.height + b.width * b.height - inter;
    return union > 0 ? inter / union : 0;
  }

  /** Overlap measured against the SMALLER box (catches a face cut in half by a tile edge). */
  static overlapOfSmaller(a, b) {
    const x1 = Math.max(a.x, b.x), y1 = Math.max(a.y, b.y);
    const x2 = Math.min(a.x + a.width, b.x + b.width), y2 = Math.min(a.y + a.height, b.y + b.height);
    const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
    const smaller = Math.min(a.width * a.height, b.width * b.height);
    return smaller > 0 ? inter / smaller : 0;
  }

  /**
   * Merges duplicate detections (same face seen in two overlapping tiles).
   * Two boxes are the same face if they overlap a lot (IoU) or one lies mostly inside the other;
   * the larger (= uncut) box is kept.
   */
  static mergeBoxes(boxes, iouThreshold = 0.3, containThreshold = 0.6) {
    const sorted = [...boxes].sort((a, b) => (b.score - a.score) || (b.width * b.height - a.width * a.height));
    const kept = [];
    for (const box of sorted) {
      const idx = kept.findIndex(k => HeadCounter.iou(k, box) > iouThreshold ||
                                      HeadCounter.overlapOfSmaller(k, box) > containThreshold);
      if (idx === -1) {
        kept.push(box);
      } else if (box.width * box.height > kept[idx].width * kept[idx].height) {
        kept[idx] = { ...box, score: Math.max(box.score, kept[idx].score) }; // keep the uncut face
      }
    }
    return kept;
  }

  /**
   * Detects faces in an <img>. Returns { count, boxes, width, height }.
   * @param {HTMLImageElement} img
   */
  static async countFaces(img, { minConfidence = 0.35, onStatus = () => {} } = {}) {
    await HeadCounter.ensureModel(onStatus);
    const faceapi = window.faceapi;
    const width = img.naturalWidth, height = img.naturalHeight;

    // Small photo: analyse it in one go. Large photo: tiles (finds small faces in the back rows).
    const regions = Math.max(width, height) <= 1100 ? [{ x: 0, y: 0, w: width, h: height }] : HeadCounter.tiles(width, height);
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const options = new faceapi.SsdMobilenetv1Options({ minConfidence, maxResults: 300 });

    let raw = [];
    for (let i = 0; i < regions.length; i++) {
      const r = regions[i];
      onStatus(`Looking for faces… ${regions.length > 1 ? `(part ${i + 1}/${regions.length})` : ''}`);
      canvas.width = r.w;
      canvas.height = r.h;
      ctx.drawImage(img, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
      const detections = await faceapi.detectAllFaces(canvas, options);
      raw = raw.concat(detections.map(d => ({
        x: d.box.x + r.x, y: d.box.y + r.y, width: d.box.width, height: d.box.height, score: d.score
      })));
    }
    const boxes = HeadCounter.mergeBoxes(raw);
    // Number faces in reading order: row by row (rows ≈ one face height), left to right
    const rowH = boxes.length ? boxes.reduce((t, b) => t + b.height, 0) / boxes.length : 1;
    boxes.sort((a, b) => (Math.round(a.y / rowH) - Math.round(b.y / rowH)) || (a.x - b.x));
    return { count: boxes.length, boxes, width, height };
  }

  /** Draws the photo with a numbered box around every detected face. */
  static drawResult(canvas, img, boxes) {
    const maxW = 1200;
    const scale = Math.min(1, maxW / img.naturalWidth);
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    ctx.lineWidth = Math.max(2, canvas.width / 400);
    ctx.font = `bold ${Math.max(11, Math.round(canvas.width / 70))}px system-ui, sans-serif`;
    boxes.forEach((b, i) => {
      ctx.strokeStyle = '#22c55e';
      ctx.strokeRect(b.x * scale, b.y * scale, b.width * scale, b.height * scale);
      const label = String(i + 1);
      const tw = ctx.measureText(label).width + 6;
      ctx.fillStyle = '#22c55e';
      ctx.fillRect(b.x * scale, b.y * scale - 16, tw, 16);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(label, b.x * scale + 3, b.y * scale - 3);
    });
  }
}

window.HeadCounter = HeadCounter;
