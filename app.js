const DEFAULTS = { accent: '#f5a623', base: '#0c0c0c' };
const STORAGE_KEY = 'stay-on-brand-colors';

const accent = document.querySelector('#accent');
const base = document.querySelector('#base');
const fileInput = document.querySelector('#file');
const dropZone = document.querySelector('#drop-zone');
const results = document.querySelector('#results');
const status = document.querySelector('#status');
let sourceImage = null;
const blobs = {};

function storedColors() {
  try {
    const colors = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return /^#[0-9a-f]{6}$/i.test(colors?.accent) && /^#[0-9a-f]{6}$/i.test(colors?.base) ? colors : DEFAULTS;
  } catch {
    return DEFAULTS;
  }
}

function hexToRgb(hex) {
  return [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16));
}

function syncColors() {
  document.documentElement.style.setProperty('--accent', accent.value);
  document.documentElement.style.setProperty('--base', base.value);
  document.querySelector('#accent-value').textContent = accent.value;
  document.querySelector('#base-value').textContent = base.value;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ accent: accent.value, base: base.value }));
  } catch {}
  if (sourceImage) render(sourceImage);
}

function render(image) {
  const source = document.createElement('canvas');
  source.width = image.naturalWidth;
  source.height = image.naturalHeight;
  const context = source.getContext('2d', { willReadFrequently: true });
  context.drawImage(image, 0, 0);
  const input = context.getImageData(0, 0, source.width, source.height);
  const histogram = new Uint32Array(256);

  for (let index = 0; index < input.data.length; index += 4) {
    histogram[Math.round(input.data[index] * 0.2126 + input.data[index + 1] * 0.7152 + input.data[index + 2] * 0.0722)]++;
  }

  const cutoff = input.data.length / 4 * 0.02;
  let low = 0;
  let high = 255;
  let count = 0;
  while (count + histogram[low] < cutoff) count += histogram[low++];
  count = 0;
  while (count + histogram[high] < cutoff) count += histogram[high--];
  const range = Math.max(1, high - low);

  const accentRgb = hexToRgb(accent.value);
  const baseRgb = hexToRgb(base.value);
  const outputA = new ImageData(source.width, source.height);
  const outputB = new ImageData(source.width, source.height);
  for (let index = 0; index < input.data.length; index += 4) {
    const luminance = input.data[index] * 0.2126 + input.data[index + 1] * 0.7152 + input.data[index + 2] * 0.0722;
    const amount = Math.max(0, Math.min(1, 1 - (luminance - low) / range)) * input.data[index + 3] / 255;
    for (let channel = 0; channel < 3; channel++) {
      outputA.data[index + channel] = baseRgb[channel] + (accentRgb[channel] - baseRgb[channel]) * amount;
      outputB.data[index + channel] = accentRgb[channel] + (baseRgb[channel] - accentRgb[channel]) * amount;
    }
    outputA.data[index + 3] = 255;
    outputB.data[index + 3] = 255;
  }

  [[document.querySelector('#version-a'), outputA], [document.querySelector('#version-b'), outputB]].forEach(([canvas, output]) => {
    canvas.width = source.width;
    canvas.height = source.height;
    canvas.getContext('2d').putImageData(output, 0, 0);
    // Encode up front so share and clipboard calls stay inside the tap's user gesture on iOS.
    blobs[canvas.id] = new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  });
  results.hidden = false;
}

function loadFile(file) {
  if (!file?.type.startsWith('image/')) {
    status.textContent = 'Please choose an image file.';
    return;
  }

  const url = URL.createObjectURL(file);
  const image = new Image();
  image.onload = () => {
    URL.revokeObjectURL(url);
    sourceImage = image;
    render(image);
    status.textContent = file.name;
    results.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  image.onerror = () => {
    URL.revokeObjectURL(url);
    status.textContent = 'That image could not be opened.';
  };
  image.src = url;
}

Object.assign(accent, { value: storedColors().accent });
Object.assign(base, { value: storedColors().base });
syncColors();

[accent, base].forEach((input) => input.addEventListener('input', syncColors));
document.querySelector('#swap').addEventListener('click', () => {
  [accent.value, base.value] = [base.value, accent.value];
  syncColors();
});
fileInput.addEventListener('change', () => loadFile(fileInput.files[0]));
document.querySelector('#change-image').addEventListener('click', () => fileInput.click());

['dragenter', 'dragover'].forEach((eventName) => dropZone.addEventListener(eventName, (event) => {
  event.preventDefault();
  dropZone.classList.add('is-dragging');
}));
['dragleave', 'drop'].forEach((eventName) => dropZone.addEventListener(eventName, (event) => {
  event.preventDefault();
  dropZone.classList.remove('is-dragging');
}));
dropZone.addEventListener('drop', (event) => loadFile(event.dataTransfer.files[0]));

document.querySelectorAll('.download').forEach((button, index) => button.addEventListener('click', async () => {
  const blob = await blobs[button.dataset.canvas];
  const file = new File([blob], `stay-on-brand-${index + 1}.png`, { type: 'image/png' });

  // iOS ignores the download attribute, so hand the file to the share sheet ("Save Image").
  if (matchMedia('(pointer: coarse)').matches && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return;
    } catch (error) {
      if (error.name === 'AbortError') return;
    }
  }

  const link = document.createElement('a');
  link.download = file.name;
  link.href = URL.createObjectURL(file);
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 10000);
}));

document.querySelectorAll('.copy').forEach((button) => {
  if (!window.ClipboardItem || !navigator.clipboard?.write) {
    button.hidden = true;
    return;
  }
  button.addEventListener('click', async () => {
    try {
      // Safari needs the ClipboardItem created synchronously in the gesture, with the blob as a promise.
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blobs[button.dataset.canvas] })]);
      button.textContent = 'Copied!';
    } catch {
      button.textContent = 'Copy failed';
    }
    setTimeout(() => { button.textContent = 'Copy'; }, 1600);
  });
});

document.querySelectorAll('.share').forEach((button, index) => {
  if (!navigator.canShare?.({ files: [new File([''], 'test.png', { type: 'image/png' })] })) {
    button.hidden = true;
    return;
  }
  button.addEventListener('click', async () => {
    const blob = await blobs[button.dataset.canvas];
    try {
      await navigator.share({ files: [new File([blob], `stay-on-brand-${index + 1}.png`, { type: 'image/png' })] });
    } catch {}
  });
});

console.assert(JSON.stringify(hexToRgb('#f5a623')) === '[245,166,35]');
