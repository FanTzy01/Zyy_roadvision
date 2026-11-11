/* ZYY-ROAD VISION v3.0 — browser-only computer vision prototype.
 * Distance is an uncalibrated pinhole-camera estimate; depth is relative.
 * Do not use any output for collision avoidance or driving decisions.
 */
'use strict';

const $ = id => document.getElementById(id);
const video = $('camera');
const canvas = $('display');
const ctx = canvas.getContext('2d', { alpha: false });
const depthCanvas = $('depthCanvas');
const dctx = depthCanvas.getContext('2d', { alpha: false });
const laneInput = document.createElement('canvas');
const laneInputCtx = laneInput.getContext('2d', { willReadFrequently: true });
const depthInput = document.createElement('canvas');
const depthInputCtx = depthInput.getContext('2d');
const CLASSES = ['car', 'motorcycle', 'bus', 'truck', 'bicycle', 'person'];
const NAMES = { car: 'MOBIL', motorcycle: 'MOTOR', bus: 'BUS', truck: 'TRUK', bicycle: 'SEPEDA', person: 'MANUSIA' };
const COLORS = { car: '#13e9ff', motorcycle: '#ffc971', bus: '#7cffb4', truck: '#f4a6ff', bicycle: '#89baff', person: '#7bffd5' };
const COUNTERS = { car: 'countCar', motorcycle: 'countMotorcycle', bus: 'countBus', truck: 'countTruck', bicycle: 'countBicycle' };
const OBJECT_WIDTHS_M = { car: 1.8, motorcycle: .75, bus: 2.5, truck: 2.5, bicycle: .6 };
const MAX_RECORD_MS = 5 * 60 * 1000;

let stream = null, mediaMode = null, fileUrl = null, facingMode = 'environment';
let model = null, modelPromise = null, cameraBusy = false, cameraSession = 0;
let animationId = null, detectionTimer = null, laneTimer = null, depthTimer = null, badgeTimer = null;
let lastRafTime = 0, displayedFps = 0, inferenceErrorCount = 0;
let detections = [], tracks = [], nextTrackId = 1, everTracked = 0;
let laneMarkers = { left: null, right: null }, laneLastUpdated = 0;
let confidenceThreshold = .55, hfovDeg = 68;
let showLane = true, showTrail = true, showDepthOverlay = true;
let depthEnabled = false, depthLoading = false, depthPipe = null, depthRawImage = null, depthValid = false;
let depthGeneration = 0, depthBusy = false;
let recorder = null, recorderStream = null, recording = false, recordChunks = [];
let recordStartedAt = 0, recordingTimer = null;
let lastRecordingBlob = null, lastRecordingFilename = '', lastRecordingUrl = null;
let toastTimeout = null;
const LOG_STORAGE_KEY = 'zyy-road-vision-v3-event-log';
const KNOWN_BADGE = 'ZYYRV3:ZYY:badge-01';
let eventLog = [], nextLogNumber = 1;
let barcodeDetector = null, badgeScannerType = 'none', badgeBusy = false;
let heightCalibration = null;
let lastPeopleSelectKey = '';


const isSecureCameraContext = () => window.isSecureContext && !!navigator.mediaDevices?.getUserMedia;
const isActive = () => mediaMode !== null;
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const timestampForFile = () => {
  const d = new Date(), p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth()+1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
};
const fmtDuration = ms => {
  const seconds = Math.floor(Math.max(0, ms) / 1000);
  return `${String(Math.floor(seconds / 60)).padStart(2,'0')}:${String(seconds % 60).padStart(2,'0')}`;
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
  const active = isActive();
  $('startBtn').disabled = active || cameraBusy;
  $('activateBtn').disabled = cameraBusy;
  $('uploadBtn').disabled = active || cameraBusy;
  $('stopBtn').disabled = !active || cameraBusy || recording;
  $('flipBtn').disabled = mediaMode !== 'camera' || cameraBusy || recording;
  $('shotBtn').disabled = !active;
  $('recordBtn').disabled = !active || cameraBusy || (!recording && (!window.MediaRecorder || !canvas.captureStream));
  $('recordBtn').classList.toggle('recording', recording);
  $('recordBtn').innerHTML = recording ? '■ &nbsp; Hentikan Rekaman' : '● &nbsp; Mulai Rekam';
  $('recBadge').textContent = recording ? 'RECORDING' : 'READY';
  $('recIndicator').hidden = !recording;
  $('downloadBtn').disabled = !lastRecordingBlob;
  $('stateDot').classList.toggle('live', active);
  $('headerStatus').textContent = active ? (model ? 'AI ONLINE' : 'VIDEO ONLINE') : 'STANDBY';
  $('cameraLabel').textContent = !active ? 'CAMERA OFFLINE' : (mediaMode === 'file' ? 'LOCAL VIDEO' : (facingMode === 'environment' ? 'REAR CAMERA' : 'FRONT CAMERA'));
  $('cameraStatus').textContent = !active ? 'Offline' : (mediaMode === 'file' ? 'Video lokal' : 'Kamera aktif');
  $('cameraFloating').hidden = !active || !model;
  $('laneFloating').hidden = !active || !showLane;
  $('assignZyyBtn').disabled = !getSelectedPersonTrack();
  $('calibrateBtn').disabled = !getSelectedPersonTrack();
  $('depthBtn').disabled = depthLoading;
  $('depthBtn').textContent = depthLoading ? '◈ Memuat model Depth…' : (depthEnabled ? '■ Nonaktifkan Depth AI' : '◈ Aktifkan Depth AI');
}

function resetSessionAnalytics() {
  detections = []; tracks = []; nextTrackId = 1; everTracked = 0;
  heightCalibration=null; updateCalibrationLabel();
  laneMarkers = {left:null, right:null}; laneLastUpdated = 0;
  $('uniqueVehicles').textContent = '00';
  $('trackingStatus').textContent = 'Menunggu deteksi';
  $('leftLaneStatus').textContent = '—';
  $('rightLaneStatus').textContent = '—';
  $('nearestDistance').textContent = '—';
  $('laneStatus').textContent = 'Memindai marka jalan…';
  $('laneFloatingText').textContent = 'SCANNING';
  updateAnalytics();
}

function updateAnalytics() {
  const filtered = detections.filter(d => d.score >= confidenceThreshold);
  const vehicles = filtered.filter(d=>d.class!=='person');
  const humans = filtered.filter(d=>d.class==='person');
  $('totalVehicles').textContent = String(vehicles.length).padStart(2,'0');
  for (const [type,id] of Object.entries(COUNTERS)) $(id).textContent = String(vehicles.filter(d=>d.class===type).length);
  const activeTracks=tracks.filter(t=>performance.now()-t.seen<1400&&t.score>=confidenceThreshold);
  $('visiblePeople').textContent=String(humans.length).padStart(2,'0');
  $('unknownPeople').textContent=String(activeTracks.filter(t=>t.class==='person'&&!t.personId).length).padStart(2,'0');
  $('trackingStatus').textContent=filtered.length ? `${activeTracks.length} ID aktif` : 'Tidak ada objek terdeteksi';
  const distances = vehicles.map(estimateDistance).filter(Number.isFinite);
  $('nearestDistance').textContent = distances.length ? '~'+Math.min(...distances).toFixed(1)+' m*' : '—';
  updateObjectTotals();
  refreshPersonSelector();
}

async function createCamera() {
  try {
    return await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:facingMode},width:{ideal:1280},height:{ideal:720},frameRate:{ideal:30,max:30}}});
  } catch (error) {
    if (!['OverconstrainedError','NotFoundError'].includes(error.name)) throw error;
    return navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:facingMode}}});
  }
}

async function prepareVideo(session) {
  // Video metadata can be emitted before a listener is installed.
  if (!video.videoWidth || !video.videoHeight) {
    await new Promise((resolve,reject) => {
      const t = setTimeout(() => { cleanup(); reject(new Error('Metadata video tidak tersedia.')); }, 14000);
      const onReady = () => { cleanup(); resolve(); };
      const onError = () => { cleanup(); reject(new Error('Video tidak dapat diputar oleh browser.')); };
      const cleanup = () => {clearTimeout(t);video.removeEventListener('loadedmetadata',onReady);video.removeEventListener('error',onError);};
      video.addEventListener('loadedmetadata',onReady);video.addEventListener('error',onError);
    });
  }
  await video.play();
  if (cameraSession !== session) return;
  const scale = Math.min(1, 1280 / video.videoWidth, 1280 / video.videoHeight);
  canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
  canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
  $('dimensionLabel').textContent = `${canvas.width} × ${canvas.height}`;
  $('viewport').classList.add('active');
  $('viewport').style.minHeight = '0';
  lastRafTime = 0; displayedFps = 0;
  resetSessionAnalytics();
  refreshButtons();
  drawFrame();
  beginLaneLoop(session);
  beginBadgeLoop(session);
  if (depthEnabled && depthPipe) beginDepthLoop(session);
  loadModel().then(() => {
    if (cameraSession === session && isActive() && model) detectFrame(session);
  }).catch(error => console.warn('Vehicle model:', error));
}

async function startCamera() {
  if (isActive() || cameraBusy) return;
  if (!isSecureCameraContext()) {toast('Kamera membutuhkan HTTPS atau localhost. Gunakan alamat GitHub Pages, bukan file:// atau HTTP biasa.',true);return;}
  cameraBusy = true; refreshButtons();
  $('cameraHint').textContent = 'Meminta izin kamera…';
  const session = ++cameraSession;
  try {
    stream = await createCamera();
    if (session !== cameraSession) {stream?.getTracks().forEach(t => t.stop());return;}
    video.srcObject = stream;
    mediaMode = 'camera';
    $('cameraHint').textContent = 'Kamera aktif • analisis diproses di perangkat';
    await prepareVideo(session);
  } catch (error) {
    closeSource();
    let info = 'Kamera gagal dibuka: ' + (error.message || error.name);
    if (['NotAllowedError','PermissionDeniedError'].includes(error.name)) info = 'Izin kamera ditolak. Izinkan kamera pada pengaturan situs, lalu ulangi.';
    if (error.name === 'NotReadableError') info = 'Kamera sedang digunakan aplikasi lain. Tutup aplikasi lain dan coba kembali.';
    toast(info,true);
  } finally {cameraBusy = false;refreshButtons();}
}

async function useFile(file) {
  if (!file || !file.type.startsWith('video/') || isActive() || cameraBusy) return;
  cameraBusy = true; refreshButtons();
  const session = ++cameraSession;
  try {
    fileUrl = URL.createObjectURL(file);
    video.srcObject = null;
    video.src = fileUrl;
    video.loop = false; // Jangan otomatis menghitung ulang objek di klip yang diputar berulang.
    mediaMode = 'file';
    $('cameraHint').textContent = 'Video lokal untuk pengujian • tidak diunggah';
    await prepareVideo(session);
    toast('Video pengujian aktif. Model mendeteksi kendaraan dari rekaman lokal.');
  } catch(error) {closeSource();toast('Tidak dapat membuka video: '+error.message,true);}
  finally {cameraBusy = false;refreshButtons();$('videoInput').value='';}
}

function closeSource() {
  cameraSession++;
  cancelAnimationFrame(animationId); clearTimeout(detectionTimer); clearTimeout(laneTimer); clearTimeout(depthTimer); clearTimeout(badgeTimer);
  stream?.getTracks().forEach(t=>t.stop()); stream=null;
  video.pause();video.srcObject=null;video.removeAttribute('src');video.load();
  if(fileUrl) URL.revokeObjectURL(fileUrl);fileUrl=null;
  mediaMode=null;inferenceErrorCount=0;
  depthValid=false;
  $('depthPlaceholder').hidden=false;
  if(depthEnabled){$('depthBadge').textContent='READY';$('depthStatus').textContent='Depth model siap. Aktifkan kamera atau pilih video.';}
  $('laneEngineStatus').textContent='Standby';
  $('viewport').classList.remove('active');$('viewport').style.minHeight='';
  $('dimensionLabel').textContent='— × —';$('fpsLabel').textContent='— FPS';
  $('cameraHint').textContent='Sensor offline • tidak ada rekaman yang diunggah ke server';
  resetSessionAnalytics();
  $('laneStatus').textContent='Belum dianalisis';
  $('trackingStatus').textContent='Menunggu kamera';
  refreshButtons();
}
function stopCamera() {if(recording){toast('Hentikan rekaman sebelum menutup kamera.');return;}closeSource();}
async function switchCamera(){if(mediaMode!=='camera'||cameraBusy||recording)return;closeSource();facingMode=facingMode==='environment'?'user':'environment';await startCamera();}

function injectScript(src) {
  return new Promise((resolve,reject)=>{
    const script=document.createElement('script');script.async=true;script.src=src;
    script.onload=resolve;script.onerror=()=>reject(new Error('Gagal memuat library AI. Periksa internet.'));
    document.head.appendChild(script);
  });
}
async function loadModel() {
  if (model) return model;
  if (modelPromise) return modelPromise;
  $('aiStatus').textContent='Memuat model…';
  modelPromise=(async()=>{
    if(!window.tf)await injectScript('https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.22.0/dist/tf.min.js');
    if(!window.cocoSsd)await injectScript('https://cdn.jsdelivr.net/npm/@tensorflow-models/coco-ssd@2.2.3/dist/coco-ssd.min.js');
    try{await tf.setBackend('webgl');}catch(_){await tf.setBackend('cpu');}
    await tf.ready();model=await cocoSsd.load({base:'lite_mobilenet_v2'});
    $('aiStatus').textContent='Aktif ('+tf.getBackend().toUpperCase()+')';
    toast('Vehicle AI siap. ID kendaraan akan dilacak selama sesi.');refreshButtons();
    return model;
  })();
  try{return await modelPromise;}catch(error){modelPromise=null;$('aiStatus').textContent='Gagal memuat';toast('Model kendaraan gagal dimuat: '+error.message,true);return null;}
}

const boxIou=(a,b)=>{
  const [ax,ay,aw,ah]=a,[bx,by,bw,bh]=b;
  const intersection=Math.max(0,Math.min(ax+aw,bx+bw)-Math.max(ax,bx))*Math.max(0,Math.min(ay+ah,by+bh)-Math.max(ay,by));
  return intersection/(aw*ah+bw*bh-intersection||1);
};
const centroid=box=>[box[0]+box[2]/2,box[1]+box[3]/2];
function updateTracking(objects) {
  const now=performance.now(),vw=video.videoWidth||1,vh=video.videoHeight||1;
  const matched=new Set();
  for(const obj of objects) {
    let selected=null,best=-1;
    for(const tr of tracks){
      if(tr.class!==obj.class||matched.has(tr.id))continue;
      const iou=boxIou(obj.bbox,tr.bbox);
      const c=centroid(obj.bbox),old=centroid(tr.bbox);
      const dist=Math.hypot((c[0]-old[0])/vw,(c[1]-old[1])/vh);
      const maxDist=.085 + .18*Math.max(obj.bbox[2]/vw,obj.bbox[3]/vh);
      if(iou<.14 && dist>maxDist)continue;
      const score=iou*1.5-dist*1.2;
      if(score>best){best=score;selected=tr;}
    }
    if(selected){
      selected.bbox=obj.bbox.slice();selected.score=obj.score;selected.seen=now;
      selected.history.push(centroid(obj.bbox));
      if(selected.class==='person') syncHeightForTrack(selected);
      if(selected.history.length>20)selected.history.shift();
      matched.add(selected.id);
    }else{
      const id=nextTrackId++;
      const track={id,class:obj.class,bbox:obj.bbox.slice(),score:obj.score,seen:now,history:[centroid(obj.bbox)],personId:null};
      tracks.push(track); matched.add(id); everTracked++;
      registerNewObject(track);
    }
  }
  tracks=tracks.filter(t=>now-t.seen<6500);
}
function estimateDistance(obj) {
  if(!obj||!video.videoWidth)return NaN;
  const pxWidth=obj.bbox[2];
  if(pxWidth<=0||pxWidth<video.videoWidth*.006)return NaN;
  // Pinhole approximation: vehicle width assumed frontal and camera HFOV assumed.
  const focal=video.videoWidth/(2*Math.tan(hfovDeg*Math.PI/360));
  return clamp((OBJECT_WIDTHS_M[obj.class]||1.8)*focal/pxWidth,.3,200);
}
async function detectFrame(session) {
  if(!model||!isActive()||session!==cameraSession)return;
  const started=performance.now();
  try {
    if(video.readyState>=2){
      const results=await model.detect(video,30,Math.min(.3,confidenceThreshold*.65));
      if(session===cameraSession && isActive()){
        detections=results.filter(d=>CLASSES.includes(d.class));
        updateTracking(detections.filter(d=>d.score>=confidenceThreshold));
        updateAnalytics();inferenceErrorCount=0;
      }
    }
  }catch(error){
    inferenceErrorCount++;
    console.warn('Vehicle inference:',error);
    if(inferenceErrorCount===3)toast('Deteksi tersendat. Coba tutup aplikasi lain atau matikan Depth AI.',true);
  }
  if(isActive()&&session===cameraSession){
    const elapsed=performance.now()-started;
    detectionTimer=setTimeout(()=>detectFrame(session),Math.max(90,480-elapsed));
  }
}

// Lightweight, real image-edge lane *marking* detector; no fake fixed-guide geometry.
// Scores possible left/right road-line segments using brightness gradients on the actual video.
function calculateLaneMarkers() {
  const iw=320,ih=Math.max(112,Math.round(iw*video.videoHeight/video.videoWidth));
  laneInput.width=iw;laneInput.height=ih;
  laneInputCtx.drawImage(video,0,0,iw,ih);
  const rgba=laneInputCtx.getImageData(0,0,iw,ih).data;
  const grey=new Uint8Array(iw*ih), mag=new Uint16Array(iw*ih);
  for(let i=0,j=0;i<rgba.length;i+=4,j++)grey[j]=(rgba[i]*77+rgba[i+1]*150+rgba[i+2]*29)>>8;
  const horizon=Math.round(ih*.51),low=Math.round(ih*.95);
  for(let y=horizon;y<ih-1;y++)for(let x=2;x<iw-2;x++){
    const p=y*iw+x;
    const gx=grey[p+1-iw]+2*grey[p+1]+grey[p+1+iw]-grey[p-1-iw]-2*grey[p-1]-grey[p-1+iw];
    const gy=grey[p+iw-1]+2*grey[p+iw]+grey[p+iw+1]-grey[p-iw-1]-2*grey[p-iw]-grey[p-iw+1];
    mag[p]=Math.abs(gx)+Math.abs(gy);
  }
  const vw=video.videoWidth,vh=video.videoHeight;
  const masked=(x,y)=>detections.some(d=>d.score>=confidenceThreshold &&
    x>=d.bbox[0]/vw*iw-2&&x<=(d.bbox[0]+d.bbox[2])/vw*iw+2 &&
    y>=d.bbox[1]/vh*ih-2&&y<=(d.bbox[1]+d.bbox[3])/vh*ih+2);
  function bestFor(side) {
    let best=null;
    const xBottomMin=side==='left'?.05:.53,xBottomMax=side==='left'?.49:.96;
    const xTopMin=side==='left'?.30:.48,xTopMax=side==='left'?.52:.70;
    for(let bt=xBottomMin;bt<xBottomMax;bt+=.023){
      for(let tp=xTopMin;tp<xTopMax;tp+=.016){
        if(side==='left'&&tp<=bt+.035)continue;
        if(side==='right'&&tp>=bt-.035)continue;
        let supported=0,valid=0,total=0,bins=[0,0,0];
        for(let i=0;i<30;i++){
          const t=i/29,y=Math.round(horizon+(low-horizon)*t);
          const x=Math.round(iw*(tp+(bt-tp)*t));
          if(x<4||x>=iw-4||masked(x,y))continue;
          valid++;
          const p=y*iw+x;
          const strength=Math.max(mag[p-2],mag[p-1],mag[p],mag[p+1],mag[p+2]);
          if(strength>165){supported++;total+=Math.min(1,strength/350);bins[Math.min(2,Math.floor(i/10))]++;}
        }
        if(valid<12)continue;
        const support=supported/valid,score=.72*support+.28*(total/valid);
        if(support>.45 && bins.filter(v=>v>=3).length>=2 && (!best || score>best.score)) {
          best={x1:tp*iw,y1:horizon,x2:bt*iw,y2:low,score};
        }
      }
    }
    return best && best.score>.41?{
      x1:best.x1/iw*vw,y1:best.y1/ih*vh,
      x2:best.x2/iw*vw,y2:best.y2/ih*vh,score:best.score
    }:null;
  }
  return {left:bestFor('left'),right:bestFor('right')};
}
function updateLaneUI() {
  const l=!!laneMarkers.left,r=!!laneMarkers.right;
  $('leftLaneStatus').textContent=l?'TERDETEKSI':'TIDAK ADA';
  $('rightLaneStatus').textContent=r?'TERDETEKSI':'TIDAK ADA';
  const label=l&&r?'2 marka terdeteksi':(l||r?'1 marka terdeteksi':'Marka tidak ditemukan');
  $('laneStatus').textContent=label;
  $('laneFloatingText').textContent=l&&r?'DUA SISI':(l||r?'SATU SISI':'NOT FOUND');
  $('laneEngineStatus').textContent='Analisis citra aktif';
}
function beginLaneLoop(session) {
  clearTimeout(laneTimer);
  const tick=()=>{
    if(!isActive()||cameraSession!==session)return;
    try{if(video.readyState>=2 && video.videoWidth){
      const next=calculateLaneMarkers();
      // Light smoothing when both detections are continuously found.
      for(const side of ['left','right']){
        if(next[side]&&laneMarkers[side]){
          for(const k of ['x1','y1','x2','y2'])next[side][k]=.3*next[side][k]+.7*laneMarkers[side][k];
        }
      }
      laneMarkers=next;laneLastUpdated=performance.now();updateLaneUI();
    }}catch(e){console.warn('Lane analyzer:',e);$('laneEngineStatus').textContent='Gagal analisis';}
    if(isActive()&&cameraSession===session)laneTimer=setTimeout(tick,750);
  };
  laneTimer=setTimeout(tick,350);
}

function drawLaneLines(w,h) {
  if(!showLane||!video.videoWidth)return;
  const sx=w/video.videoWidth,sy=h/video.videoHeight;
  ctx.save();
  for(const [side,line] of Object.entries(laneMarkers)){
    if(!line)continue;
    const x1=line.x1*sx,y1=line.y1*sy,x2=line.x2*sx,y2=line.y2*sy;
    ctx.lineCap='round';ctx.lineWidth=Math.max(3,w/270);ctx.strokeStyle='#ffe776';
    ctx.shadowColor='#ffdd2b';ctx.shadowBlur=10;
    ctx.beginPath();ctx.moveTo(x1,y1);ctx.lineTo(x2,y2);ctx.stroke();
    ctx.shadowBlur=0;ctx.lineWidth=Math.max(1,w/650);ctx.strokeStyle='#fff5c1';ctx.stroke();
    ctx.font=`700 ${Math.max(10,w/88)}px system-ui`;
    ctx.fillStyle='#fff2ac';ctx.fillText(side==='left'?'LANE L':'LANE R',x2+8,clamp(y2-10,15,h-10));
  }
  ctx.restore();
}
function drawTracking(w,h) {
  if(!video.videoWidth)return;
  const sx=w/video.videoWidth,sy=h/video.videoHeight;
  const font=Math.max(11,Math.min(19,w/63));
  const now=performance.now();
  for(const tr of tracks){
    if(now-tr.seen>1350 || tr.score<confidenceThreshold)continue;
    const color=COLORS[tr.class]||'#20dbff';
    const [ox,oy,ow,oh]=tr.bbox;
    const x=ox*sx,y=oy*sy,bw=ow*sx,bh=oh*sy;
    if(bw<=2||bh<=2)continue;
    ctx.save();
    if(showTrail&&tr.history.length>1){
      ctx.strokeStyle=color+'aa';ctx.lineWidth=Math.max(2,w/560);
      ctx.beginPath();tr.history.forEach(([px,py],i)=>i?ctx.lineTo(px*sx,py*sy):ctx.moveTo(px*sx,py*sy));ctx.stroke();
    }
    ctx.strokeStyle=color;ctx.lineWidth=Math.max(2,w/600);
    ctx.strokeRect(x,y,bw,bh);
    const corner=Math.min(23,Math.max(8,Math.min(bw,bh)*.18));ctx.lineWidth*=1.7;
    for(const [px,py,dx,dy] of [[x,y,1,1],[x+bw,y,-1,1],[x,y+bh,1,-1],[x+bw,y+bh,-1,-1]]){
      ctx.beginPath();ctx.moveTo(px+dx*corner,py);ctx.lineTo(px,py);ctx.lineTo(px,py+dy*corner);ctx.stroke();
    }
    const dist=tr.class==='person'?NaN:estimateDistance(tr);
    const label=`#${String(tr.id).padStart(2,'0')} ${NAMES[tr.class]} ${Math.round(tr.score*100)}%`;
    ctx.font=`750 ${font}px system-ui,sans-serif`;
    const labelWidth=ctx.measureText(label).width+15;
    const ly=Math.max(font+10,y);
    ctx.fillStyle=color;ctx.fillRect(x,ly-font-9,labelWidth,font+12);
    ctx.fillStyle='#001826';ctx.fillText(label,x+7,ly-5);
    if(tr.class==='person'){
      const identity=tr.personId==='ZYY'?'Zyy • Zyy System Development':'TIDAK DIKENALI';
      const height=estimatePersonHeight(tr);
      const heightText=Number.isFinite(height)?` • tinggi ~${Math.round(height)} cm*`:' • tinggi: belum terukur';
      ctx.font=`700 ${Math.max(10,font*.8)}px system-ui,sans-serif`;
      const sub=identity+heightText;
      const subWidth=ctx.measureText(sub).width+14;
      const subY=Math.min(h-20,ly+3);
      ctx.fillStyle='rgba(0,29,35,.9)';ctx.fillRect(x,subY,Math.min(w-x,subWidth),font+12);
      ctx.fillStyle='#d5fff1';ctx.fillText(sub,x+6,subY+font+1);
    }
    if(Number.isFinite(dist)){
      const distanceLabel=`~${dist.toFixed(1)} m*`;
      ctx.font=`750 ${Math.max(10,font*.85)}px system-ui`;
      const tagWidth=ctx.measureText(distanceLabel).width+12;
      ctx.fillStyle='rgba(2,21,38,.85)';ctx.fillRect(x,Math.min(h-18,y+bh+3),tagWidth,font+7);
      ctx.fillStyle='#fbf5db';ctx.fillText(distanceLabel,x+6,Math.min(h-6,y+bh+font+3));
    }
    ctx.restore();
  }
}
function drawDepthInset(w,h){
  if(!showDepthOverlay||!depthEnabled||!depthValid)return;
  const boxW=w*.27,boxH=boxW*(depthCanvas.height/depthCanvas.width);
  const margin=Math.max(12,w*.024),x=w-margin-boxW,y=h*.16;
  ctx.save();ctx.fillStyle='rgba(0,18,33,.9)';ctx.fillRect(x-4,y-19,boxW+8,boxH+24);
  ctx.drawImage(depthCanvas,x,y,boxW,boxH);
  ctx.strokeStyle='#59bdeb';ctx.strokeRect(x,y,boxW,boxH);
  ctx.font=`700 ${Math.max(9,w*.010)}px system-ui`;ctx.fillStyle='#c9f8ff';ctx.fillText('AI DEPTH / RELATIVE',x,y-6);ctx.restore();
}
function drawHud(w,h){
  const font=Math.max(10,Math.round(w/90)),p=Math.max(8,Math.round(w/70));
  ctx.save();ctx.font=`750 ${font}px ui-monospace,monospace`;
  ctx.fillStyle='#b7fdff';ctx.shadowColor='#000';ctx.shadowBlur=5;
  ctx.fillText('ZYY / ROAD VISION V3.0',p,p+font);
  ctx.textAlign='right';ctx.fillText(new Date().toLocaleTimeString('id-ID',{hour12:false}),w-p,p+font);
  ctx.shadowBlur=0;ctx.fillStyle='rgba(3,15,27,.76)';ctx.fillRect(0,h-2*p-font,w,2*p+font);
  ctx.fillStyle='#b6ebf9';ctx.textAlign='left';
  ctx.fillText(`${String(detections.filter(d=>d.score>=confidenceThreshold).length).padStart(2,'0')} VISIBLE | ${countUniqueLog()} UNIQUE`,p,h-p);
  ctx.textAlign='right';ctx.fillText('DISTANCE APPROX. / DEPTH RELATIVE',w-p,h-p);
  if(recording){ctx.fillStyle='#ff526a';ctx.beginPath();ctx.arc(w/2,p+font-5,font*.42,0,2*Math.PI);ctx.fill();}
  ctx.restore();
}
function drawFrame(timestamp=0){
  if(!isActive())return;
  if(video.readyState>=2&&canvas.width&&canvas.height){
    const w=canvas.width,h=canvas.height;
    ctx.drawImage(video,0,0,w,h);
    drawLaneLines(w,h);
    drawTracking(w,h);
    drawDepthInset(w,h);
    drawHud(w,h);
  }
  if(timestamp&&lastRafTime){
    const delta=timestamp-lastRafTime;
    if(delta>0){displayedFps=displayedFps*.9+1000/delta*.1;
      if(Math.floor(timestamp/1000)!==Math.floor(lastRafTime/1000))$('fpsLabel').textContent=Math.round(clamp(displayedFps,0,99))+' FPS';}
  }
  lastRafTime=timestamp;
  animationId=requestAnimationFrame(drawFrame);
}

function depthPalette(v){
  // Monocular depth predictions are *relative*; this ramp is visual only.
  const stops=[[8,34,100],[21,100,220],[39,181,214],[122,240,160],[255,222,99],[255,95,89]];
  const f=clamp(v,0,1)*(stops.length-1),j=Math.min(stops.length-2,Math.floor(f)),t=f-j;
  return stops[j].map((x,k)=>Math.round(x+(stops[j+1][k]-x)*t));
}
function renderDepthMap(depth) {
  if(!depth||!depth.width||!depth.height||!depth.data)throw new Error('Output peta kedalaman tidak dikenali.');
  const w=depth.width,h=depth.height,n=w*h,channels=depth.channels||1;
  // downscale depth on canvas to reduce allocation on mobile.
  const id=dctx.createImageData(w,h),out=id.data,source=depth.data;
  let min=255,max=0;
  for(let i=0;i<n;i++){const v=source[i*channels];min=Math.min(min,v);max=Math.max(max,v);}
  const spread=Math.max(1,max-min);
  for(let i=0;i<n;i++){
    const v=(source[i*channels]-min)/spread;
    const [r,g,b]=depthPalette(v);
    out[i*4]=r;out[i*4+1]=g;out[i*4+2]=b;out[i*4+3]=255;
  }
  depthCanvas.width=w;depthCanvas.height=h;
  dctx.putImageData(id,0,0);
  depthValid=true;$('depthPlaceholder').hidden=true;
  $('depthStatus').textContent='AI Depth berjalan pada frame sampel. Warna menunjukkan kedalaman relatif, bukan meter. Pembaruan tidak setiap frame.';
  $('depthBadge').textContent='AI ACTIVE';$('depthEngineStatus').textContent='Relatif / aktif';
}
async function toggleDepth() {
  if(depthLoading)return;
  if(depthEnabled){
    depthEnabled=false;depthGeneration++;clearTimeout(depthTimer);depthValid=false;
    $('depthPlaceholder').hidden=false;
    $('depthBadge').textContent='OFF';$('depthEngineStatus').textContent='Nonaktif';
    $('depthStatus').textContent='Depth AI dinonaktifkan. Aktifkan lagi untuk melanjutkan.';
    refreshButtons();return;
  }
  depthLoading=true;refreshButtons();
  $('depthStatus').textContent='Mengunduh model Depth Anything V2 dan runtime ke browser. Perlu internet dan memori bebas.';
  $('depthEngineStatus').textContent='Memuat…';
  try {
    if(!depthPipe){
      const {pipeline, RawImage}=await import('https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.2');
      depthRawImage=RawImage;
      // q8 uses the ~27MB quantized model. WASM is broadly supported, though slower on phones.
      depthPipe=await pipeline('depth-estimation','onnx-community/depth-anything-v2-small',{device:'wasm',dtype:'q8'});
    }
    depthEnabled=true;depthGeneration++;
    $('depthStatus').textContent=isActive()?'Model siap. Memproses kedalaman relatif…':'Model siap. Aktifkan kamera atau pilih video.';
    $('depthBadge').textContent='READY';$('depthEngineStatus').textContent='Siap';
    toast('Depth model siap. Peta kedalaman akan memperbarui beberapa detik sekali.');
    if(isActive())beginDepthLoop(cameraSession);
  } catch(error){
    console.error('Depth pipeline load:',error);
    $('depthStatus').textContent='Depth AI tidak dapat dijalankan di perangkat/browser ini. Deteksi kendaraan dan marka tetap tersedia.';
    $('depthEngineStatus').textContent='Tidak tersedia';
    toast('Gagal memuat Depth AI: '+(error.message||'model tidak didukung'),true);
  } finally{depthLoading=false;refreshButtons();}
}
function beginDepthLoop(session){
  clearTimeout(depthTimer);
  const generation=depthGeneration;
  const tick=async()=>{
    if(!isActive()||!depthEnabled||!depthPipe||generation!==depthGeneration||session!==cameraSession)return;
    if(depthBusy){depthTimer=setTimeout(tick,1000);return;}
    depthBusy=true;
    try{
      if(video.readyState>=2){
        depthInput.width=320;depthInput.height=Math.round(320*video.videoHeight/video.videoWidth);
        depthInputCtx.drawImage(video,0,0,depthInput.width,depthInput.height);
        const output=await depthPipe(depthRawImage.fromCanvas(depthInput));
        if(generation===depthGeneration&&session===cameraSession&&depthEnabled){
          renderDepthMap(output.depth);
        }
      }
    }catch(error){
      console.warn('Depth inference:',error);
      $('depthEngineStatus').textContent='Gagal inferensi';
      $('depthStatus').textContent='Inferensi depth gagal. Matikan fitur jika HP melambat. '+(error.message||'');
      // Avoid retry loops that overheat a phone.
      depthEnabled=false;depthGeneration++;depthValid=false;
      $('depthPlaceholder').hidden=false; $('depthBadge').textContent='OFF';
      toast('Depth tidak berhasil dijalankan, dinonaktifkan otomatis.',true);
      refreshButtons();
    }finally{depthBusy=false;}
    if(depthEnabled&&isActive()&&generation===depthGeneration&&session===cameraSession)depthTimer=setTimeout(tick,4800);
  };
  depthTimer=setTimeout(tick,500);
}

function selectedMimeType(){
  if(!window.MediaRecorder)return '';
  const candidates=['video/mp4;codecs="avc1.42E01E"','video/webm;codecs=vp8','video/webm;codecs=vp9','video/mp4','video/webm'];
  return candidates.find(t=>MediaRecorder.isTypeSupported(t))||'';
}
function startRecording(){
  if(!isActive()||recording)return;
  if(!window.MediaRecorder||!canvas.captureStream){toast('Browser ini tidak mendukung perekaman canvas.',true);return;}
  try{
    const captured=canvas.captureStream(24);recorderStream=captured;
    const mime=selectedMimeType(),opts={videoBitsPerSecond:2500000};if(mime)opts.mimeType=mime;
    recorder=new MediaRecorder(captured,opts);recordChunks=[];
    const current=recorder;
    current.ondataavailable=e=>{if(e.data?.size)recordChunks.push(e.data);};
    current.onerror=e=>toast('Perekaman gagal: '+(e.error?.message||'MediaRecorder'),true);
    current.onstop=()=>{
      const format=current.mimeType||mime||'video/webm';
      if(recordChunks.length){
        lastRecordingBlob=new Blob(recordChunks,{type:format});
        lastRecordingFilename=`ZYY-ROAD-VISION-v3_${timestampForFile()}.${format.includes('mp4')?'mp4':'webm'}`;
        if(lastRecordingUrl)URL.revokeObjectURL(lastRecordingUrl);
        lastRecordingUrl=URL.createObjectURL(lastRecordingBlob);
        $('recordNote').textContent=`Rekaman siap (${(lastRecordingBlob.size/1048576).toFixed(1)} MB). Periksa folder Unduhan; klik Simpan Rekaman Terakhir jika perlu.`;
        refreshButtons();downloadRecording();
      }else toast('Tidak ada data video. Coba lagi dengan browser yang lain.',true);
      recordChunks=[];captured.getTracks().forEach(t=>t.stop());
      if(recorderStream===captured)recorderStream=null;
    };
    current.start(1000);recording=true;recordStartedAt=Date.now();
    $('recordSub').textContent='Sedang merekam overlay AI + manusia';
    document.querySelector('.rec-dial > span').classList.add('recording');
    updateRecordTime();recordingTimer=setInterval(updateRecordTime,500);refreshButtons();
    toast('Rekaman dimulai. Kotak tracking, jalur, dan inset depth (jika aktif) disertakan.');
  }catch(error){recorderStream?.getTracks().forEach(t=>t.stop());recorderStream=null;toast('Gagal memulai: '+error.message,true);}
}
function updateRecordTime(){
  if(!recording)return;
  const ms=Date.now()-recordStartedAt,label=fmtDuration(ms);
  $('recordDisplay').textContent=label;$('recTime').textContent=label;
  if(ms>=MAX_RECORD_MS){toast('Rekaman 5 menit selesai untuk membatasi penggunaan memori.');stopRecording();}
}
function stopRecording(){
  if(!recording)return;
  recording=false;clearInterval(recordingTimer);
  $('recordSub').textContent='Menyiapkan file rekaman…';
  document.querySelector('.rec-dial > span').classList.remove('recording');
  refreshButtons();
  try{if(recorder?.state!=='inactive')recorder.stop();}catch(error){toast('Gagal menghentikan rekaman: '+error.message,true);}
}
function triggerDownload(url,name){
  const link=document.createElement('a');link.href=url;link.download=name;link.rel='noopener';
  document.body.appendChild(link);link.click();link.remove();
}
function downloadRecording(){
  if(!lastRecordingBlob||!lastRecordingUrl)return;
  triggerDownload(lastRecordingUrl,lastRecordingFilename);
  $('recordSub').textContent='Rekaman siap disimpan';
  toast('Unduhan diminta. Periksa folder Unduhan/Files HP. Jika gagal, tekan Simpan Rekaman Terakhir.');
}
function takePhoto(){
  if(!isActive())return;
  canvas.toBlob(blob=>{
    if(!blob){toast('Gagal membuat foto.',true);return;}
    const url=URL.createObjectURL(blob);
    triggerDownload(url,`ZYY-ROAD-VISION-v3_${timestampForFile()}.png`);
    setTimeout(()=>URL.revokeObjectURL(url),10000);toast('Foto AI disiapkan untuk unduhan.');
  },'image/png');
}


// ====================== V3: UNIQUE OBJECT REGISTER ======================
// No face recognition is used. An identity is assigned only by user action or
// by an explicitly displayed QR badge. QR content is public and spoofable.
function loadObjectLog(){
  try{
    const saved=JSON.parse(localStorage.getItem(LOG_STORAGE_KEY)||'[]');
    if(Array.isArray(saved))eventLog=saved.filter(v=>v && typeof v.id==='string' && typeof v.class==='string' && typeof v.time==='string').slice(-500);
  }catch(_){eventLog=[];}
  nextLogNumber=1+eventLog.reduce((m,v)=>Math.max(m,Number((v.id||'').split('-').pop())||0),0);
  renderEventLog();updateObjectTotals();
}
function storeObjectLog(){
  try{localStorage.setItem(LOG_STORAGE_KEY,JSON.stringify(eventLog.slice(-500)));}
  catch(error){console.warn('Tidak bisa menyimpan localStorage',error);}
}
function getLogEvent(track){return eventLog.find(v=>v.id===track?.eventId);}
function activeLogEvents(){return eventLog.filter(v=>!v.mergedInto);}
function countUniqueLog(){return activeLogEvents().length;}
function registerNewObject(track){
  const event={id:'OBJ-'+String(nextLogNumber++).padStart(4,'0'),
    trackId:track.id,time:new Date().toISOString(),class:track.class,
    name:track.class==='person'?'Tidak dikenali':NAMES[track.class],
    status:track.class==='person'?'Tidak dikenali':'Kendaraan terdeteksi',
    heightCm:null,knownKey:null,mergedInto:null};
  track.eventId=event.id;
  eventLog.push(event);
  if(eventLog.length>500)eventLog=eventLog.slice(-500);
  storeObjectLog();renderEventLog();updateObjectTotals();
}
function updateObjectTotals(){
  const unique=activeLogEvents();
  $('uniqueAll').textContent=String(unique.length).padStart(2,'0');
  $('eventTotal').textContent=String(eventLog.length).padStart(2,'0');
  $('mergedTotal').textContent=String(eventLog.length-unique.length).padStart(2,'0');
  $('uniqueVehicles').textContent=String(unique.filter(v=>v.class!=='person').length).padStart(2,'0');
  $('uniquePeople').textContent=String(unique.filter(v=>v.class==='person').length).padStart(2,'0');
}
function renderEventLog(){
  const root=$('eventList');root.replaceChildren();
  if(!eventLog.length){const empty=document.createElement('p');empty.className='event-empty';empty.textContent='Belum ada objek yang terdeteksi.';root.appendChild(empty);}
  else for(const event of [...eventLog].reverse().slice(0,85)){
    const row=document.createElement('div');row.className='event-row'+(event.mergedInto?' is-merged':'');
    const id=document.createElement('span');id.className='event-id';id.textContent=event.id;
    const label=document.createElement('strong');label.textContent=event.name;
    const tag=document.createElement('small');const dt=new Date(event.time);
    const hh=Number.isNaN(+dt)?event.time:dt.toLocaleString('id-ID',{dateStyle:'short',timeStyle:'medium'});
    tag.textContent=`${hh} • ${event.status}${Number.isFinite(event.heightCm)?' • ~'+Math.round(event.heightCm)+' cm*':''}${event.mergedInto?' • Gabung ke '+event.mergedInto:''}`;
    const icon=document.createElement('span');icon.className='event-icon';icon.textContent=event.class==='person'?'♙':'▣';
    const info=document.createElement('div');info.className='event-info';info.append(id,label,tag);row.append(icon,info);root.appendChild(row);
  }
  const keepOptions=(selectId,defaultText)=>{
    const select=$(selectId),selection=select.value;select.replaceChildren();
    const placeholder=new Option(defaultText,'');select.add(placeholder);
    for(const ev of activeLogEvents())select.add(new Option(`${ev.id} — ${ev.name}`,ev.id));
    select.value=[...select.options].some(o=>o.value===selection)?selection:'';
  };
  keepOptions('duplicateSource','Pilih ID duplikat');
  keepOptions('duplicateTarget','Pilih ID asli');
}
function mergeLogEvent(sourceId,targetId,quiet=false){
  if(!sourceId||!targetId||sourceId===targetId){if(!quiet)toast('Pilih dua catatan berbeda.',true);return false;}
  const src=eventLog.find(x=>x.id===sourceId),target=eventLog.find(x=>x.id===targetId);
  if(!src||!target||src.mergedInto||target.mergedInto||src.class!==target.class){if(!quiet)toast('Jenis objek harus sama dan kedua catatan belum digabung.',true);return false;}
  src.mergedInto=target.id;
  storeObjectLog();renderEventLog();updateObjectTotals();
  if(!quiet)toast(`${src.id} digabung ke ${target.id}. Total unik berkurang satu.`);
  return true;
}
function clearObjectLog(){
  if(!window.confirm('Hapus seluruh daftar objek dan mulai pencatatan dari nol?'))return;
  eventLog=[];nextLogNumber=1;
  // Keep active trackers associated with an event, so they are counted again only once.
  for(const tr of tracks) registerNewObject(tr);
  storeObjectLog();renderEventLog();updateObjectTotals();toast('Daftar objek direset. Objek aktif dimasukkan kembali sekali.');
}
function exportObjectCSV(){
  const rows=[['ID','Waktu','Jenis','Nama','Status','Tinggi perkiraan (cm)','Duplikat dari','Metode identitas']];
  for(const e of eventLog)rows.push([e.id,e.time,e.class,e.name,e.status,e.heightCm??'',e.mergedInto||'',e.knownKey?'Badge QR / verifikasi manual':'Tidak ada']);
  const csv='\uFEFF'+rows.map(r=>r.map(x=>'"'+String(x).replace(/"/g,'""')+'"').join(',')).join('\r\n');
  const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));
  triggerDownload(url,`ZYY-ROAD-OBJECT-LOG_${timestampForFile()}.csv`);
  setTimeout(()=>URL.revokeObjectURL(url),20000);toast('Catatan objek diekspor menjadi CSV.');
}

// ================== V3: HUMAN ID + HEIGHT CALIBRATION ==================
function getSelectedPersonTrack(){
  const id=Number($('knownTrack').value);
  if(!id)return null;
  return tracks.find(t=>t.id===id&&t.class==='person'&&performance.now()-t.seen<2300)||null;
}
function refreshPersonSelector(){
  const select=$('knownTrack');const previous=select.value;
  const alive=tracks.filter(t=>t.class==='person'&&performance.now()-t.seen<2300 && t.score>=confidenceThreshold);
  const key=alive.map(t=>t.id+':'+(t.personId||'')).join(',');
  if(lastPeopleSelectKey!==key){
    select.replaceChildren();select.add(new Option(alive.length?'Pilih Person ID':'— Belum ada orang —',''));
    for(const tr of alive)select.add(new Option(`#${tr.id} — ${tr.personId==='ZYY'?'Zyy':'Tidak dikenali'}`,String(tr.id)));
    if(alive.some(t=>String(t.id)===previous))select.value=previous;
    lastPeopleSelectKey=key;
  }
  $('assignZyyBtn').disabled=!getSelectedPersonTrack();
  $('calibrateBtn').disabled=!getSelectedPersonTrack();
}
function assignZyyToTrack(track,method='manual'){
  if(!track||track.class!=='person')return;
  track.personId='ZYY';
  const log=getLogEvent(track);if(!log)return;
  log.name='Zyy';log.status='Zyy System Development';log.knownKey='ZYY';
  // The same registered badge/person can only contribute one unique entry.
  const existing=eventLog.find(e=>e.id!==log.id&&e.knownKey==='ZYY'&&!e.mergedInto);
  if(existing) mergeLogEvent(log.id,existing.id,true);
  storeObjectLog();renderEventLog();updateObjectTotals();refreshPersonSelector();updateAnalytics();
  $('qrStatus').textContent=method==='qr'?'QR Zyy terbaca • ID dipasang pada objek terdekat':'Identitas Zyy dipasang lewat verifikasi manual';
  if(method==='manual')toast(`Person #${track.id} ditandai Zyy (manual).`);
}
function estimatePersonHeight(track){
  if(!track||track.class!=='person'||!heightCalibration||!video.videoHeight)return NaN;
  const box=track.bbox,foot=box[1]+box[3],vh=video.videoHeight;
  // Refuse estimates if feet/head are clipped, or perspective differs too much.
  if(box[1]<vh*.014 || foot>vh*.982 || box[3]<vh*.13)return NaN;
  if(Math.abs(foot/vh-heightCalibration.footY)>0.065)return NaN;
  const h=heightCalibration.heightCm*box[3]/heightCalibration.pixelHeight;
  return h>=90&&h<=230?h:NaN;
}
function syncHeightForTrack(track){
  const h=estimatePersonHeight(track),log=getLogEvent(track);
  if(log && Number.isFinite(h) && (!Number.isFinite(log.heightCm)||Math.abs(log.heightCm-h)>3)){
    log.heightCm=Math.round(h);storeObjectLog();renderEventLog();
  }
}
function updateCalibrationLabel(){
  if(!$('heightCalibrationStatus'))return;
  $('heightCalibrationStatus').textContent=heightCalibration?
    `Kalibrasi dari #${heightCalibration.trackId}: ${heightCalibration.heightCm} cm. Hanya untuk orang pada jarak/sudut serupa.`:
    'Belum dikalibrasi. Tanpa kalibrasi, tinggi manusia tidak ditampilkan.';
}
function calibrateHeight(){
  const tr=getSelectedPersonTrack(),cm=Number($('referenceHeightCm').value);
  if(!tr){toast('Pilih person yang terlihat utuh terlebih dahulu.',true);return;}
  if(!Number.isFinite(cm)||cm<80||cm>230){toast('Masukkan tinggi acuan 80–230 cm yang benar-benar diketahui.',true);return;}
  const [x,y,w,h]=tr.bbox,vh=video.videoHeight;
  if(!vh||y<vh*.014||y+h>vh*.982||h<vh*.13){toast('Pastikan kepala sampai kaki masuk seluruh frame untuk kalibrasi.',true);return;}
  heightCalibration={trackId:tr.id,heightCm:cm,pixelHeight:h,footY:(y+h)/vh};
  updateCalibrationLabel();
  for(const person of tracks.filter(t=>t.class==='person'))syncHeightForTrack(person);
  toast('Kalibrasi tersimpan selama kamera/video ini aktif. Nilainya perkiraan, bukan hasil ukur presisi.');
}

// QR detection is voluntary and NOT facial identification. The badge can be
// copied, and not all browsers support native BarcodeDetector.
async function prepareBadgeScanner(){
  if(badgeScannerType!=='none')return;
  if('BarcodeDetector' in window){
    try{
      const formats=await BarcodeDetector.getSupportedFormats();
      if(formats.includes('qr_code')){barcodeDetector=new BarcodeDetector({formats:['qr_code']});badgeScannerType='native';$('qrStatus').textContent='QR scanner aktif (browser)';return;}
    }catch(_){/*fallback*/}
  }
  try{await injectScript('https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js');
    if(window.jsQR){badgeScannerType='jsqr';$('qrStatus').textContent='QR scanner aktif (fallback jsQR)';return;}
  }catch(error){console.warn('QR script',error);}
  badgeScannerType='unavailable';$('qrStatus').textContent='QR tidak tersedia. Gunakan Tandai pilihan sebagai Zyy.';
}
const badgeInput=document.createElement('canvas');
const badgeInputCtx=badgeInput.getContext('2d',{willReadFrequently:true});
async function scanBadgeVideo(){
  if(video.readyState<2||!video.videoWidth||badgeBusy||badgeScannerType==='unavailable')return;
  badgeBusy=true;
  try{
    let codes=[];
    if(badgeScannerType==='native'){
      codes=(await barcodeDetector.detect(video)).map(r=>({value:r.rawValue,box:r.boundingBox}));
    }else if(badgeScannerType==='jsqr'){
      const vw=video.videoWidth,vh=video.videoHeight,w=640,h=Math.max(1,Math.round(vh*640/vw));
      badgeInput.width=w;badgeInput.height=h;badgeInputCtx.drawImage(video,0,0,w,h);
      const data=badgeInputCtx.getImageData(0,0,w,h);
      const result=window.jsQR(data.data,w,h,{inversionAttempts:'dontInvert'});
      if(result){
        const pts=Object.values(result.location).filter(v=>v&&typeof v.x==='number'&&typeof v.y==='number');
        const xs=pts.map(v=>v.x*vw/w),ys=pts.map(v=>v.y*vh/h);
        if(xs.length)codes=[{value:result.data,box:{x:Math.min(...xs),y:Math.min(...ys),width:Math.max(...xs)-Math.min(...xs),height:Math.max(...ys)-Math.min(...ys)}}];
      }
    }
    for(const qr of codes){
      if(qr.value!==KNOWN_BADGE)continue;
      const cx=qr.box.x+qr.box.width/2,cy=qr.box.y+qr.box.height/2;
      const choices=tracks.filter(t=>t.class==='person'&&performance.now()-t.seen<2000).filter(t=>{
        const [x,y,w,h]=t.bbox;return cx>=x-w*.12&&cx<=x+w*1.12&&cy>=y-h*.12&&cy<=y+h*1.12;
      });
      choices.sort((a,b)=>{
        const ca=centroid(a.bbox),cb=centroid(b.bbox);
        return Math.hypot(ca[0]-cx,ca[1]-cy)-Math.hypot(cb[0]-cx,cb[1]-cy);
      });
      if(choices.length){assignZyyToTrack(choices[0],'qr');break;}
      $('qrStatus').textContent='QR Zyy terdeteksi tetapi belum berada di dalam kotak Person.';
    }
  }catch(error){console.warn('Badge scan',error);}
  finally{badgeBusy=false;}
}
function beginBadgeLoop(session){
  clearTimeout(badgeTimer);
  prepareBadgeScanner().then(()=>{
    const tick=async()=>{
      if(!isActive()||cameraSession!==session)return;
      if(badgeScannerType!=='unavailable')await scanBadgeVideo();
      if(isActive()&&cameraSession===session)badgeTimer=setTimeout(tick,1150);
    };
    if(isActive()&&cameraSession===session)tick();
  });
}

$('knownTrack').addEventListener('change',refreshPersonSelector);
$('assignZyyBtn').addEventListener('click',()=>assignZyyToTrack(getSelectedPersonTrack(),'manual'));
$('calibrateBtn').addEventListener('click',calibrateHeight);
$('mergeBtn').addEventListener('click',()=>mergeLogEvent($('duplicateSource').value,$('duplicateTarget').value));
$('clearLogBtn').addEventListener('click',clearObjectLog);
$('exportCsvBtn').addEventListener('click',exportObjectCSV);
video.addEventListener('ended',()=>{if(mediaMode==='file')$('cameraHint').textContent='Video selesai • catatan tetap tersimpan. Tekan Matikan untuk memilih ulang.';});
loadObjectLog();

$('activateBtn').addEventListener('click',startCamera);
$('startBtn').addEventListener('click',startCamera);
$('uploadBtn').addEventListener('click',()=>$('videoInput').click());
$('videoInput').addEventListener('change',e=>useFile(e.target.files?.[0]));
$('stopBtn').addEventListener('click',stopCamera);
$('flipBtn').addEventListener('click',switchCamera);
$('shotBtn').addEventListener('click',takePhoto);
$('recordBtn').addEventListener('click',()=>recording?stopRecording():startRecording());
$('downloadBtn').addEventListener('click',downloadRecording);
$('depthBtn').addEventListener('click',toggleDepth);
$('confidence').addEventListener('input',e=>{confidenceThreshold=Number(e.target.value)/100;$('confidenceValue').textContent=e.target.value+'%';updateAnalytics();});
$('cameraFov').addEventListener('input',e=>{hfovDeg=Number(e.target.value);$('fovValue').textContent=e.target.value+'°';updateAnalytics();});
$('laneSwitch').addEventListener('change',e=>{showLane=e.target.checked;refreshButtons();});
$('trailSwitch').addEventListener('change',e=>{showTrail=e.target.checked;});
$('depthOverlaySwitch').addEventListener('change',e=>{showDepthOverlay=e.target.checked;});
window.addEventListener('pagehide',()=>{
  clearInterval(recordingTimer);clearTimeout(detectionTimer);clearTimeout(laneTimer);clearTimeout(depthTimer);clearTimeout(badgeTimer);
  try{if(recorder?.state==='recording')recorder.stop();}catch(_){/*noop*/}
  stream?.getTracks().forEach(t=>t.stop());
  if(fileUrl)URL.revokeObjectURL(fileUrl);
});
window.addEventListener('beforeunload',e=>{if(recording){e.preventDefault();e.returnValue='';}});
refreshButtons();resetSessionAnalytics();
