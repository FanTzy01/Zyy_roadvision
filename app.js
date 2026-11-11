/* ZYY-ROAD VISION v1.0 — seluruh analisis AI dan perekaman berjalan di browser. */
'use strict';

const $ = id => document.getElementById(id);
const video = $('camera');
const canvas = $('display');
const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
const CLASSES = ['car', 'motorcycle', 'bus', 'truck', 'bicycle'];
const NAMES = { car: 'MOBIL', motorcycle: 'MOTOR', bus: 'BUS', truck: 'TRUK', bicycle: 'SEPEDA' };
const COLORS = { car: '#15e6fb', motorcycle: '#ffd36d', bus: '#73ffbb', truck: '#f7a1ff', bicycle: '#8ab5ff' };
const COUNTERS = { car: 'countCar', motorcycle: 'countMotorcycle', bus: 'countBus', truck: 'countTruck', bicycle: 'countBicycle' };
const MAX_RECORD_MS = 5 * 60 * 1000;

let stream = null;
let model = null;
let modelPromise = null;
let cameraActive = false;
let cameraBusy = false;
let facingMode = 'environment';
let detections = [];
let cameraSession = 0;
let animationId = null;
let detectionTimer = null;
let lastRafTime = 0;
let displayedFps = 0;
let recorder = null;
let recorderStream = null;
let recording = false;
let recordChunks = [];
let recordStartedAt = 0;
let recordingTimer = null;
let lastRecordingBlob = null;
let lastRecordingFilename = '';
let lastRecordingUrl = null;
let toastTimeout = null;
let showGuide = true;
let confidenceThreshold = 0.55;

const isSecureCameraContext = () => window.isSecureContext && !!navigator.mediaDevices?.getUserMedia;
const timestampForFile = () => {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
};
const fmtDuration = seconds => {
  const n = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;
};

function toast(message, error = false) {
  const el = $('toast');
  el.textContent = message;
  el.classList.toggle('error', error);
  el.classList.add('show');
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => el.classList.remove('show'), 5200);
}

function refreshButtons() {
  $('startBtn').disabled = cameraActive || cameraBusy;
  $('activateBtn').disabled = cameraBusy;
  $('stopBtn').disabled = !cameraActive || recording;
  $('flipBtn').disabled = !cameraActive || recording || cameraBusy;
  $('shotBtn').disabled = !cameraActive;
  $('recordBtn').disabled = !cameraActive || cameraBusy || (!recording && (!window.MediaRecorder || !canvas.captureStream));
  $('recordBtn').classList.toggle('recording', recording);
  $('recordBtn').innerHTML = recording ? '■ &nbsp; Hentikan Rekaman' : '● &nbsp; Mulai Rekam';
  $('recBadge').textContent = recording ? 'RECORDING' : 'READY';
  $('recIndicator').hidden = !recording;
  $('downloadBtn').disabled = !lastRecordingBlob;
  $('stateDot').classList.toggle('live', cameraActive);
  $('headerStatus').textContent = cameraActive ? (model ? 'AI ONLINE' : 'CAMERA ONLINE') : 'STANDBY';
  $('cameraLabel').textContent = cameraActive ? (facingMode === 'environment' ? 'REAR CAMERA' : 'FRONT CAMERA') : 'CAMERA OFFLINE';
  $('cameraStatus').textContent = cameraActive ? 'Online' : 'Offline';
  $('cameraFloating').hidden = !cameraActive || !model;
}
function clearAnalytics() {
  detections = [];
  $('totalVehicles').textContent = '00';
  for (const id of Object.values(COUNTERS)) $(id).textContent = '0';
}
function updateAnalytics() {
  const filtered = detections.filter(d => d.score >= confidenceThreshold);
  $('totalVehicles').textContent = String(filtered.length).padStart(2, '0');
  for (const [type, id] of Object.entries(COUNTERS)) {
    $(id).textContent = String(filtered.filter(d => d.class === type).length);
  }
}

async function createCamera() {
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: { ideal: facingMode },
        width: { ideal: 1280 },
        height: { ideal: 720 },
        frameRate: { ideal: 30, max: 30 }
      }
    });
  } catch (error) {
    if (error.name !== 'OverconstrainedError' && error.name !== 'NotFoundError') throw error;
    return navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: facingMode } } });
  }
}

async function startCamera() {
  if (cameraActive || cameraBusy) return;
  if (!isSecureCameraContext()) {
    toast('Kamera hanya dapat diakses lewat HTTPS atau localhost. Upload website ke hosting HTTPS untuk membuka di HP.', true);
    return;
  }
  cameraBusy = true;
  refreshButtons();
  $('cameraHint').textContent = 'Meminta izin akses kamera…';
  try {
    const newStream = await createCamera();
    stream = newStream;
    video.srcObject = stream;
    await video.play();
    if (!video.videoWidth || !video.videoHeight) {
      await new Promise(resolve => video.addEventListener('loadedmetadata', resolve, { once: true }));
    }
    const scale = Math.min(1, 1280 / video.videoWidth, 1280 / video.videoHeight);
    canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
    canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
    $('dimensionLabel').textContent = `${canvas.width} × ${canvas.height}`;
    $('viewport').classList.add('active');
    $('viewport').style.minHeight = '0';
    cameraActive = true;
    const currentSession = ++cameraSession;
    refreshButtons();
    $('cameraHint').textContent = 'Kamera aktif • AI diproses langsung di perangkat';
    drawFrame();
    await loadModel();
    if (cameraActive && currentSession === cameraSession && model) detectFrame(currentSession);
  } catch (error) {
    if (stream) stream.getTracks().forEach(track => track.stop());
    stream = null;
    video.srcObject = null;
    cameraActive = false;
    $('cameraHint').textContent = 'Gagal mengaktifkan kamera';
    let info = 'Kamera tidak dapat diakses: ' + (error.message || error.name);
    if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') info = 'Izin kamera ditolak. Izinkan kamera di pengaturan situs browser, lalu coba kembali.';
    if (error.name === 'NotReadableError') info = 'Kamera sedang digunakan aplikasi lain. Tutup aplikasi tersebut dan ulangi.';
    toast(info, true);
  } finally {
    cameraBusy = false;
    refreshButtons();
  }
}

function stopCamera() {
  if (recording) { toast('Hentikan rekaman terlebih dahulu.'); return; }
  cameraSession++;
  cameraActive = false;
  cancelAnimationFrame(animationId);
  clearTimeout(detectionTimer);
  if (stream) stream.getTracks().forEach(track => track.stop());
  stream = null;
  video.pause();
  video.srcObject = null;
  $('viewport').classList.remove('active');
  $('viewport').style.minHeight = '';
  $('dimensionLabel').textContent = '— × —';
  $('fpsLabel').textContent = '— FPS';
  $('cameraHint').textContent = 'Kamera dimatikan • Tidak ada gambar yang diunggah';
  clearAnalytics();
  refreshButtons();
}

async function switchCamera() {
  if (!cameraActive || recording || cameraBusy) return;
  stopCamera();
  facingMode = facingMode === 'environment' ? 'user' : 'environment';
  await startCamera();
}

function injectScript(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.onload = resolve;
    script.onerror = () => reject(new Error('Gagal mengunduh library AI. Periksa koneksi internet.'));
    document.head.appendChild(script);
  });
}

async function loadModel() {
  if (model) return model;
  if (modelPromise) return modelPromise;
  $('aiStatus').textContent = 'Memuat model…';
  modelPromise = (async () => {
    if (!window.tf) await injectScript('https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.22.0/dist/tf.min.js');
    if (!window.cocoSsd) await injectScript('https://cdn.jsdelivr.net/npm/@tensorflow-models/coco-ssd@2.2.3/dist/coco-ssd.min.js');
    try { await tf.setBackend('webgl'); } catch (_) { await tf.setBackend('cpu'); }
    await tf.ready();
    model = await cocoSsd.load({ base: 'lite_mobilenet_v2' });
    $('aiStatus').textContent = 'Aktif (' + tf.getBackend().toUpperCase() + ')';
    refreshButtons();
    toast('Model AI aktif. Deteksi kendaraan siap digunakan.');
    return model;
  })();
  try { return await modelPromise; }
  catch (error) {
    modelPromise = null;
    $('aiStatus').textContent = 'Gagal dimuat';
    toast('Kamera aktif, tetapi deteksi AI gagal: ' + error.message + '. Periksa koneksi internet.', true);
    return null;
  }
}

async function detectFrame(session) {
  if (!model || !cameraActive || session !== cameraSession) return;
  const start = performance.now();
  try {
    if (video.readyState >= 2) {
      const results = await model.detect(video, 30, 0.25);
      if (cameraActive && session === cameraSession) {
        detections = results.filter(item => CLASSES.includes(item.class));
        updateAnalytics();
      }
    }
  } catch (error) {
    console.warn('Deteksi AI gagal:', error);
  }
  if (cameraActive && session === cameraSession) {
    const elapsed = performance.now() - start;
    detectionTimer = setTimeout(() => detectFrame(session), Math.max(70, 450 - elapsed));
  }
}

function drawGuides(w, h) {
  ctx.save();
  const gradient = ctx.createLinearGradient(0, h * 0.5, 0, h);
  gradient.addColorStop(0, 'rgba(22,234,252,.18)');
  gradient.addColorStop(1, 'rgba(22,234,252,.72)');
  ctx.strokeStyle = gradient;
  ctx.lineWidth = Math.max(1.5, w / 420);
  ctx.setLineDash([w * .012, w * .013]);
  const horizon = h * .48;
  [[.465, .18], [.535, .82]].forEach(([x1, x2]) => {
    ctx.beginPath();
    ctx.moveTo(w * x1, horizon);
    ctx.lineTo(w * x2, h);
    ctx.stroke();
  });
  ctx.setLineDash([]);
  ctx.strokeStyle = 'rgba(22,234,252,.25)';
  [0.67, 0.81].forEach(y => {ctx.beginPath();ctx.moveTo(w * (.465 - (y - .48) * .38), h * y);ctx.lineTo(w * (.535 + (y - .48) * .38), h * y);ctx.stroke();});
  ctx.restore();
}

function drawBoxes(w, h) {
  const sx = w / video.videoWidth;
  const sy = h / video.videoHeight;
  const font = Math.max(11, Math.min(20, w / 60));
  for (const item of detections) {
    if (item.score < confidenceThreshold) continue;
    let [x, y, bw, bh] = item.bbox;
    x = Math.max(0, x * sx); y = Math.max(0, y * sy);
    bw = Math.min(w - x, bw * sx); bh = Math.min(h - y, bh * sy);
    if (bw <= 0 || bh <= 0) continue;
    const color = COLORS[item.class] || '#16dcff';
    const corner = Math.max(9, Math.min(25, bw * .2, bh * .2));
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(2, w / 500);
    ctx.strokeRect(x, y, bw, bh);
    ctx.lineWidth *= 2;
    for (const [px, py, dx, dy] of [[x, y, 1, 1], [x + bw, y, -1, 1], [x, y + bh, 1, -1], [x + bw, y + bh, -1, -1]]) {
      ctx.beginPath();ctx.moveTo(px + dx * corner, py);ctx.lineTo(px, py);ctx.lineTo(px, py + dy * corner);ctx.stroke();
    }
    const label = `${NAMES[item.class]} ${Math.round(item.score * 100)}%`;
    ctx.font = `700 ${font}px system-ui,sans-serif`;
    const labelW = ctx.measureText(label).width + 16;
    const labelY = Math.max(font + 16, y);
    ctx.fillStyle = color;
    ctx.fillRect(x, labelY - font - 13, labelW, font + 14);
    ctx.fillStyle = '#001a2b';
    ctx.fillText(label, x + 8, labelY - 10);
    ctx.restore();
  }
}

function drawHud(w, h) {
  ctx.save();
  const f = Math.max(10, Math.round(w / 90));
  const p = Math.max(8, Math.round(w / 70));
  ctx.font = `700 ${f}px ui-monospace,monospace`;
  ctx.fillStyle = '#b7fdff';
  ctx.shadowColor = '#000';ctx.shadowBlur = 4;
  ctx.fillText('ZYY / ROAD VISION  ● AI', p, p + f);
  ctx.textAlign = 'right';
  ctx.fillText(new Date().toLocaleString('id-ID', { hour12: false }), w - p, p + f);
  ctx.textAlign = 'left';
  const bottomY = h - p;
  ctx.fillStyle = 'rgba(3,15,28,.66)';
  ctx.fillRect(0, h - 2 * p - f, w, 2 * p + f);
  ctx.fillStyle = '#abecf9';
  ctx.fillText(`${String(detections.filter(item => item.score >= confidenceThreshold).length).padStart(2, '0')} KENDARAAN TERLIHAT`, p, bottomY);
  ctx.textAlign = 'right';
  ctx.fillText(showGuide ? 'GUIDE: ILUSTRASI' : 'GUIDE: OFF', w - p, bottomY);
  if (recording) {ctx.fillStyle = '#ff526a';ctx.beginPath();ctx.arc(w / 2 - 23, p + f - 5, f * .4, 0, 2 * Math.PI);ctx.fill();}
  ctx.restore();
}

function drawFrame(timestamp = 0) {
  if (!cameraActive) return;
  if (video.readyState >= 2 && canvas.width && canvas.height) {
    const w = canvas.width, h = canvas.height;
    ctx.drawImage(video, 0, 0, w, h);
    if (showGuide) drawGuides(w, h);
    drawBoxes(w, h);
    drawHud(w, h);
  }
  if (timestamp && lastRafTime) {
    const instantaneous = 1000 / (timestamp - lastRafTime || 1);
    displayedFps = displayedFps * .9 + instantaneous * .1;
    if (Math.round(timestamp / 1000) !== Math.round(lastRafTime / 1000)) $('fpsLabel').textContent = Math.round(Math.min(99, displayedFps)) + ' FPS';
  }
  lastRafTime = timestamp;
  animationId = requestAnimationFrame(drawFrame);
}

function selectedMimeType() {
  const options = [
    'video/mp4;codecs="avc1.42E01E"',
    'video/webm;codecs=vp8',
    'video/webm;codecs=vp9',
    'video/mp4',
    'video/webm'
  ];
  return options.find(type => MediaRecorder.isTypeSupported(type)) || '';
}

function startRecording() {
  if (!cameraActive || recording) return;
  if (!window.MediaRecorder || !canvas.captureStream) {toast('Fitur perekaman canvas belum didukung browser ini.', true);return;}
  try {
    const capturedStream = canvas.captureStream(24);
    recorderStream = capturedStream;
    const preferredMimeType = selectedMimeType();
    const options = { videoBitsPerSecond: 2500000 };
    if (preferredMimeType) options.mimeType = preferredMimeType;
    recorder = new MediaRecorder(capturedStream, options);
    recordChunks = [];
    const currentRecorder = recorder;
    currentRecorder.ondataavailable = event => {if (event.data?.size) recordChunks.push(event.data);};
    currentRecorder.onerror = event => {toast('Terjadi kesalahan saat merekam: ' + (event.error?.message || 'tidak diketahui'), true);};
    currentRecorder.onstop = () => {
      const mime = currentRecorder.mimeType || preferredMimeType || 'video/webm';
      if (recordChunks.length) {
        lastRecordingBlob = new Blob(recordChunks, { type: mime });
        const ext = mime.includes('mp4') ? 'mp4' : 'webm';
        lastRecordingFilename = `ZYY-ROAD-VISION_${timestampForFile()}.${ext}`;
        if (lastRecordingUrl) URL.revokeObjectURL(lastRecordingUrl);
        lastRecordingUrl = URL.createObjectURL(lastRecordingBlob);
        $('recordNote').textContent = `Rekaman siap (${(lastRecordingBlob.size / 1048576).toFixed(1)} MB). Jika unduhan otomatis tidak muncul, klik "Simpan Rekaman Terakhir".`;
        refreshButtons();
        downloadRecording();
      } else {
        toast('Tidak ada data video yang dihasilkan. Coba ulangi atau gunakan browser lain.', true);
      }
      recordChunks = [];
      capturedStream.getTracks().forEach(track => track.stop());
      if (recorderStream === capturedStream) recorderStream = null;
    };
    currentRecorder.start(1000);
    recording = true;
    recordStartedAt = Date.now();
    $('recordSub').textContent = 'Perekaman sedang berlangsung';
    const dialDot = document.querySelector('.rec-dial > span');
    if (dialDot) dialDot.classList.add('recording');
    updateRecordTime();
    recordingTimer = setInterval(updateRecordTime, 500);
    refreshButtons();
    toast('Perekaman dimulai. Kotak deteksi AI akan masuk ke dalam video.');
  } catch (error) {
    if (recorderStream) recorderStream.getTracks().forEach(track => track.stop());
    recorderStream = null;
    toast('Gagal memulai rekaman: ' + error.message, true);
  }
}

function updateRecordTime() {
  if (!recording) return;
  const elapsed = Date.now() - recordStartedAt;
  const label = fmtDuration(elapsed / 1000);
  $('recordDisplay').textContent = label;
  $('recTime').textContent = label;
  if (elapsed >= MAX_RECORD_MS) {toast('Batas 5 menit tercapai, rekaman dihentikan untuk menghemat memori.');stopRecording();}
}

function stopRecording() {
  if (!recording) return;
  recording = false;
  clearInterval(recordingTimer);
  $('recordSub').textContent = 'Menyiapkan file rekaman…';
  const dialDot = document.querySelector('.rec-dial > span');
  if (dialDot) dialDot.classList.remove('recording');
  refreshButtons();
  try {if (recorder?.state !== 'inactive') recorder.stop();} catch (error) {toast('Gagal mengakhiri rekaman: ' + error.message, true);}
}

function triggerDownload(blobUrl, name) {
  const link = document.createElement('a');
  link.href = blobUrl;
  link.download = name;
  link.rel = 'noopener';
  document.body.append(link);
  link.click();
  link.remove();
}
function downloadRecording() {
  if (!lastRecordingBlob || !lastRecordingUrl) return;
  triggerDownload(lastRecordingUrl, lastRecordingFilename);
  $('recordSub').textContent = 'Rekaman siap disimpan';
  toast('Permintaan unduh dikirim. Periksa folder Unduhan/Files; jika perlu klik tombol Simpan Rekaman Terakhir.');
}

function takePhoto() {
  if (!cameraActive) return;
  canvas.toBlob(blob => {
    if (!blob) {toast('Gagal menyimpan foto.', true);return;}
    const url = URL.createObjectURL(blob);
    triggerDownload(url, `ZYY-ROAD-VISION_${timestampForFile()}.png`);
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    toast('Foto dengan deteksi AI sedang diunduh.');
  }, 'image/png');
}

$('activateBtn').addEventListener('click', startCamera);
$('startBtn').addEventListener('click', startCamera);
$('stopBtn').addEventListener('click', stopCamera);
$('flipBtn').addEventListener('click', switchCamera);
$('shotBtn').addEventListener('click', takePhoto);
$('recordBtn').addEventListener('click', () => recording ? stopRecording() : startRecording());
$('downloadBtn').addEventListener('click', downloadRecording);
$('confidence').addEventListener('input', event => {
  confidenceThreshold = Number(event.target.value) / 100;
  $('confidenceValue').textContent = event.target.value + '%';
  updateAnalytics();
});
$('guideSwitch').addEventListener('change', event => {showGuide = event.target.checked;});
window.addEventListener('pagehide', () => {
  clearInterval(recordingTimer);
  if (recorder?.state === 'recording') recorder.stop();
  if (stream) stream.getTracks().forEach(track => track.stop());
});
window.addEventListener('beforeunload', event => {
  if (recording) {event.preventDefault();event.returnValue = '';}
});
refreshButtons();
