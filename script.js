/* ===== ELEMENT ===== */
const fileInput = document.getElementById('fileInput');
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

/* ===== STATE ===== */
let audioCtx = null;
let origBuffer = null;
let buffers = {};
let currentSource = null;

/* ===== LOAD AUDIO ===== */
fileInput.addEventListener('change', async e=>{
  if(!audioCtx){
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if(audioCtx.state === 'suspended'){
    await audioCtx.resume();
  }

  const file = e.target.files[0];
  if(!file) return;

  origBuffer = await audioCtx.decodeAudioData(await file.arrayBuffer());

  drawWave(origBuffer, waveOrig);

  playOrig.disabled = false;
  processBtn.disabled = false;
});

/* ===== PROCESS ===== */
processBtn.addEventListener('click', async ()=>{
  if(!origBuffer) return;

  const cutoff = Number(freqInput.value);
  const q = Number(qInput.value);

  await runFilter('lowpass', cutoff, q);
  await runFilter('highpass', cutoff, q);
  await runFilter('bandpass', cutoff, q);

  renderResult('lowpass', waveLow, snrLow);
  renderResult('highpass', waveHigh, snrHigh);
  renderResult('bandpass', waveBand, snrBand);

  playLow.disabled = playHigh.disabled = playBand.disabled = false;
  downloadLow.disabled = downloadHigh.disabled = downloadBand.disabled = false;
});

/* ===== FILTER ===== */
async function runFilter(type, freq, q){
  const offline = new OfflineAudioContext(
    origBuffer.numberOfChannels,
    origBuffer.length,
    origBuffer.sampleRate
  );

  const src = offline.createBufferSource();
  const biq = offline.createBiquadFilter();

  src.buffer = origBuffer;
  biq.type = type;
  biq.frequency.value = freq;
  biq.Q.value = q;

  src.connect(biq);
  biq.connect(offline.destination);
  src.start();

  buffers[type] = await offline.startRendering();
}

/* ===== RENDER ===== */
function renderResult(type, canvas, snrEl){
  const buf = buffers[type];
  drawWave(buf, canvas);
  snrEl.textContent = calcSNR(origBuffer, buf).toFixed(2);
}

/* ===== PLAY / STOP ===== */
function playStop(buffer, btn){
  if(currentSource){
    currentSource.stop();
    currentSource.disconnect();
    currentSource = null;
    btn.textContent = 'Play';
    return;
  }

  const src = audioCtx.createBufferSource();
  src.buffer = buffer;
  src.connect(audioCtx.destination);
  src.start();

  btn.textContent = 'Stop';
  currentSource = src;

  src.onended = ()=>{
    currentSource = null;
    btn.textContent = 'Play';
  };
}

playOrig.onclick = ()=>playStop(origBuffer, playOrig);
playLow.onclick  = ()=>playStop(buffers.lowpass, playLow);
playHigh.onclick = ()=>playStop(buffers.highpass, playHigh);
playBand.onclick = ()=>playStop(buffers.bandpass, playBand);

/* ===== WAVEFORM ===== */
function drawWave(buffer, canvas){
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;

  ctx.clearRect(0,0,w,h);
  ctx.fillStyle = '#020617';
  ctx.fillRect(0,0,w,h);

  ctx.strokeStyle = '#38bdf8';
  ctx.lineWidth = 1;
  ctx.beginPath();

  const data = buffer.getChannelData(0);
  const step = Math.ceil(data.length / w);
  const mid = h/2;

  for(let i=0;i<w;i++){
    let min=1,max=-1;
    for(let j=0;j<step;j++){
      const v = data[i*step+j] || 0;
      min = Math.min(min,v);
      max = Math.max(max,v);
    }
    ctx.moveTo(i, mid + min*mid);
    ctx.lineTo(i, mid + max*mid);
  }
  ctx.stroke();
}

/* ===== SNR ===== */
function calcSNR(orig, proc){
  const o = orig.getChannelData(0);
  const p = proc.getChannelData(0);
  let s=0,n=0;
  for(let i=0;i<o.length;i++){
    s += p[i]*p[i];
    const e = o[i]-p[i];
    n += e*e;
  }
  return 10*Math.log10(s/(n+1e-12));
}

/* ===== DOWNLOAD ===== */
function bufferToWav(buffer){
  const len = buffer.length * 2;
  const ab = new ArrayBuffer(44 + len);
  const v = new DataView(ab);

  const write = (o,s)=>{ for(let i=0;i<s.length;i++) v.setUint8(o+i,s.charCodeAt(i)); };

  write(0,'RIFF'); v.setUint32(4,36+len,true);
  write(8,'WAVE'); write(12,'fmt ');
  v.setUint32(16,16,true);
  v.setUint16(20,1,true);
  v.setUint16(22,1,true);
  v.setUint32(24,buffer.sampleRate,true);
  v.setUint32(28,buffer.sampleRate*2,true);
  v.setUint16(32,2,true);
  v.setUint16(34,16,true);
  write(36,'data'); v.setUint32(40,len,true);

  let off=44;
  const d=buffer.getChannelData(0);
  for(let i=0;i<d.length;i++){
    v.setInt16(off, Math.max(-1,Math.min(1,d[i]))*0x7fff,true);
    off+=2;
  }
  return new Blob([v],{type:'audio/wav'});
}

function download(buffer,name){
  const url=URL.createObjectURL(bufferToWav(buffer));
  const a=document.createElement('a');
  a.href=url; a.download=name;
  a.click();
  URL.revokeObjectURL(url);
}

downloadLow.onclick  = ()=>download(buffers.lowpass,'LOW_PASS.wav');
downloadHigh.onclick = ()=>download(buffers.highpass,'HIGH_PASS.wav');
downloadBand.onclick = ()=>download(buffers.bandpass,'BAND_PASS.wav');
