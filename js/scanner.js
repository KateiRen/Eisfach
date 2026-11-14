const libraries = new Map();

function library(file, globalName) {
  if (!libraries.has(file)) {
    libraries.set(file, new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = new URL(`../assets/vendor/${file}`, import.meta.url).href;
      script.onload = () => resolve(window[globalName]);
      script.onerror = () => {
        libraries.delete(file);
        script.remove();
        reject(new Error('QR-Bibliothek konnte nicht geladen werden.'));
      };
      document.head.append(script);
    }));
  }
  return libraries.get(file);
}

export async function renderQR(container, value) {
  const qrcode = await library('qrcode.js', 'qrcode');
  const qr = qrcode(0, 'M');
  qr.addData(value);
  qr.make();
  const documentSVG = new DOMParser().parseFromString(qr.createSvgTag(5, 12), 'image/svg+xml');
  const svg = document.importNode(documentSVG.documentElement, true);
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'QR-Code');
  container.replaceChildren(svg);
}

export async function scanQR() {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('Kamera benötigt HTTPS und einen unterstützten Browser. Bitte Daten manuell eingeben.');
  }
  const dialog = document.createElement('dialog');
  const heading = document.createElement('h2');
  heading.textContent = 'QR-Code scannen';
  const video = document.createElement('video');
  video.setAttribute('playsinline', '');
  video.muted = true;
  const cancel = document.createElement('button');
  cancel.textContent = 'Abbrechen';
  dialog.append(heading, video, cancel);
  document.body.append(dialog);
  dialog.showModal();
  let stream;
  let stopped = false;
  let close;
  const cancelled = new Promise((resolve) => { close = () => { stopped = true; resolve(null); }; });
  cancel.onclick = close;
  dialog.addEventListener('cancel', (event) => { event.preventDefault(); close(); });
  try {
    // Falls der Kameradialog später beantwortet wird, auch nach Abbruch alle Tracks stoppen.
    const acquiring = navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false })
      .then((value) => {
        if (stopped) value.getTracks().forEach((track) => track.stop());
        else stream = value;
        return value;
      });
    const result = await Promise.race([acquiring, cancelled]);
    if (!result || stopped) return null;
    video.srcObject = stream;
    await video.play();
    const formats = 'BarcodeDetector' in window ? await BarcodeDetector.getSupportedFormats() : [];
    const detector = formats.includes('qr_code') ? new BarcodeDetector({ formats: ['qr_code'] }) : null;
    const decode = detector ? null : await library('jsQR.js', 'jsQR');
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d', { willReadFrequently: true });
    const scanning = async () => {
      while (!stopped) {
        if (video.readyState >= 2 && video.videoWidth) {
          if (detector) {
            const codes = await detector.detect(video);
            if (codes[0]) return codes[0].rawValue;
          } else {
            const scale = Math.min(1, 960 / video.videoWidth);
            canvas.width = Math.round(video.videoWidth * scale);
            canvas.height = Math.round(video.videoHeight * scale);
            context.drawImage(video, 0, 0, canvas.width, canvas.height);
            const image = context.getImageData(0, 0, canvas.width, canvas.height);
            const code = decode(image.data, image.width, image.height);
            if (code) return code.data;
          }
        }
        await new Promise((resolve) => setTimeout(resolve, 150));
      }
      return null;
    };
    return await Promise.race([scanning(), cancelled]);
  } finally {
    stopped = true;
    stream?.getTracks().forEach((track) => track.stop());
    dialog.remove();
  }
}
