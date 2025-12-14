const fileInput = document.getElementById('fileInput');
const recordBtn = document.getElementById('recordBtn');
const stopRecordBtn = document.getElementById('stopRecordBtn');
const processBtn = document.getElementById('processBtn');

const playOrig = document.getElementById('playOrig');
const playLow  = document.getElementById('playLow');
const playHigh = document.getElementById('playHigh');
const playBand = document.getElementById('playBand');

const downloadLow  = document.getElementById('downloadLow');
const downloadHigh = document.getElementById('downloadHigh');
const downloadBand = document.getElementById('downloadBand');

const freqInput = document.getElementById('freq');
const qInput    = document.getElementById('q');

let audioCtx = null;
let origBuffer = null;
let buffers = {};
let currentSource = null;

let mediaRecorder = null;
let recordedChunks = [];

/* ===== LOAD FILE ===== */
fileInput.onchange = async e=>{
  const file = e.target.files[0];
  if(!file) return;

  audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
  if(audioCtx.state === 'suspended') await audioCtx.resume();

  origBuffer = await audioCtx.decodeAudioData(await file.arrayBuffer());
  drawWave(origBuffer, waveOrig);

  playOrig.disabled = false;
  processBtn.disabled = false;
};

/* ===== MIC RECORD ===== */
recordBtn.onclick = async ()=>{
  audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
  if(audioCtx.state === 'suspended') await audioCtx.resume();

  const stream = await navigator.mediaDevices.getUserMedia({ audio:true });
  mediaRecorder = new MediaRecorder(stream);
  recordedChunks = [];

  mediaRecorder.ondataavailable = e=>{
    if(e.data.size) recordedChunks.push(e.data);
  };

  mediaRecorder.onstop = async ()=>{
    const blob = new Blob(recordedChunks,{type:'audio/webm'});
    origBuffer = await audioCtx.decodeAudioData(await blob.arrayBuffer());
    drawWave(origBuffer, waveOrig);
    playOrig.disabled = false;
    processBtn.disabled = false;
  };

  mediaRecorder.start();
  recordBtn.disabled = true;
  stopRecordBtn.disabled = false;
};

stopRecordBtn.onclick = ()=>{
  mediaRecorder?.stop();
  mediaRecorder?.stream.getTracks().forEach(t=>t.stop());
  recordBtn.disabled = false;
  stopRecordBtn.disabled = true;
};

/* ===== PROCESS FILTER ===== */
processBtn.onclick = async ()=>{
  const f = Number(freqInput.value);
  const q = Number(qInput.value);

  await runFilter('lowpass',f,q);
  await runFilter('highpass',f,q);
  await runFilter('bandpass',f,q);

  render('lowpass',waveLow,snrLow);
  render('highpass',waveHigh,snrHigh);
  render('bandpass',waveBand,snrBand);

  playLow.disabled = playHigh.disabled = playBand.disabled = false;
  downloadLow.disabled = downloadHigh.disabled = downloadBand.disabled = false;
};

async function runFilter(type,f,q){
  const off = new OfflineAudioContext(1,origBuffer.length,origBuffer.sampleRate);
  const src = off.createBufferSource();
  const biq = off.createBiquadFilter();

  src.buffer = origBuffer;
  biq.type = type;
  biq.frequency.value = f;
  biq.Q.value = q;

  src.connect(biq);
  biq.connect(off.destination);
  src.start();

  buffers[type] = await off.startRendering();
}

/* ===== PLAY / STOP ===== */
async function playStop(buffer, btn){
  if(!buffer) return;
  if(audioCtx.state === 'suspended') await audioCtx.resume();

  if(currentSource){
    currentSource.stop();
    currentSource = null;
    btn.textContent = 'Play';
    return;
  }

  const src = audioCtx.createBufferSource();
  src.buffer = buffer;
  src.connect(audioCtx.destination);
  src.start();

  currentSource = src;
  btn.textContent = 'Stop';

  src.onended = ()=>{
    currentSource = null;
    btn.textContent = 'Play';
  };
}

playOrig.onclick = ()=>playStop(origBuffer,playOrig);
playLow.onclick  = ()=>playStop(buffers.lowpass,playLow);
playHigh.onclick = ()=>playStop(buffers.highpass,playHigh);
playBand.onclick = ()=>playStop(buffers.bandpass,playBand);

/* ===== WAVEFORM ===== */
function drawWave(buffer,canvas){
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0,0,canvas.width,canvas.height);
  ctx.fillStyle='#042f2e';
  ctx.fillRect(0,0,canvas.width,canvas.height);
  ctx.strokeStyle='#22d3ee';
  ctx.beginPath();

  const d = buffer.getChannelData(0);
  const step = Math.ceil(d.length / canvas.width);
  const mid = canvas.height / 2;

  for(let i=0;i<canvas.width;i++){
    let min=1,max=-1;
    for(let j=0;j<step;j++){
      const v = d[i*step+j] || 0;
      min = Math.min(min,v);
      max = Math.max(max,v);
    }
    ctx.moveTo(i, mid + min*mid);
    ctx.lineTo(i, mid + max*mid);
  }
  ctx.stroke();
}

/* ===== SNR ===== */
function calcSNR(o,p){
  const a=o.getChannelData(0), b=p.getChannelData(0);
  let s=0,n=0;
  for(let i=0;i<a.length;i++){
    s+=b[i]*b[i];
    n+=(a[i]-b[i])**2;
  }
  return 10*Math.log10(s/(n+1e-12));
}

function render(type,canvas,snrEl){
  drawWave(buffers[type],canvas);
  snrEl.textContent = calcSNR(origBuffer,buffers[type]).toFixed(2);
}

/* ===== DOWNLOAD ===== */
function bufferToWav(b){
  const len=b.length*2, ab=new ArrayBuffer(44+len), v=new DataView(ab);
  const w=(o,s)=>{for(let i=0;i<s.length;i++)v.setUint8(o+i,s.charCodeAt(i));};

  w(0,'RIFF'); v.setUint32(4,36+len,true);
  w(8,'WAVE'); w(12,'fmt ');
  v.setUint32(16,16,true); v.setUint16(20,1,true);
  v.setUint16(22,1,true); v.setUint32(24,b.sampleRate,true);
  v.setUint32(28,b.sampleRate*2,true);
  v.setUint16(32,2,true); v.setUint16(34,16,true);
  w(36,'data'); v.setUint32(40,len,true);

  let o=44, d=b.getChannelData(0);
  for(let i=0;i<d.length;i++){
    v.setInt16(o,Math.max(-1,Math.min(1,d[i]))*0x7fff,true);
    o+=2;
  }
  return new Blob([v],{type:'audio/wav'});
}

const dl=(buf,name)=>{
  const a=document.createElement('a');
  a.href=URL.createObjectURL(bufferToWav(buf));
  a.download=name;
  a.click();
};

downloadLow.onclick  = ()=>dl(buffers.lowpass,'LOW_PASS.wav');
downloadHigh.onclick = ()=>dl(buffers.highpass,'HIGH_PASS.wav');
downloadBand.onclick = ()=>dl(buffers.bandpass,'BAND_PASS.wav');
