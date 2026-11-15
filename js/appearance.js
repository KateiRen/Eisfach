const APPEARANCE_KEY = 'eisfach.appearance';
const DEFAULT_PRIMARY = '#126b73';
const hexColor = /^#[0-9a-f]{6}$/i;

function validateAppearance(value) {
  if (!value || typeof value.primary !== 'string' || !hexColor.test(value.primary) ||
      (value.secondary !== null && (typeof value.secondary !== 'string' || !hexColor.test(value.secondary)))) {
    throw new Error('Ungültige Farbeinstellung. Bitte unter Einstellungen → Aussehen die Standardfarben speichern.');
  }
  return { primary: value.primary.toLowerCase(), secondary: value.secondary?.toLowerCase() ?? null };
}

export function loadAppearance() {
  const stored = localStorage.getItem(APPEARANCE_KEY);
  if (stored === null) return { primary: DEFAULT_PRIMARY, secondary: null };
  let value;
  try { value = JSON.parse(stored); } catch {
    throw new Error('Farbeinstellung konnte nicht gelesen werden. Bitte unter Einstellungen → Aussehen die Standardfarben speichern.');
  }
  return validateAppearance(value);
}

export function saveAppearance(value) {
  localStorage.setItem(APPEARANCE_KEY, JSON.stringify(validateAppearance(value)));
}

function channels(color) {
  return [1, 3, 5].map((start) => parseInt(color.slice(start, start + 2), 16));
}

function luminance(color) {
  return channels(color).reduce((sum, channel, index) => {
    const value = channel / 255;
    const linear = value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4;
    return sum + linear * [.2126, .7152, .0722][index];
  }, 0);
}

export function appearanceColors(value) {
  const { primary, secondary } = validateAppearance(value);
  const light = luminance(primary);
  const foreground = (light + .05) / .05 > 1.05 / (light + .05) ? '#000000' : '#ffffff';
  let link = secondary ?? primary;
  // The navigation hover background is the darkest surface used behind accent text.
  while ((luminance('#e2f1f1') + .05) / (luminance(link) + .05) < 4.5) {
    link = `#${channels(link).map((channel) => Math.floor(channel * .9).toString(16).padStart(2, '0')).join('')}`;
  }
  return { primary, foreground, link };
}

export function applyAppearance(value) {
  const { primary, foreground, link } = appearanceColors(value);
  const style = document.documentElement.style;
  style.setProperty('--accent', primary);
  style.setProperty('--accent-foreground', foreground);
  style.setProperty('--accent-link', link);
  const theme = document.querySelector('meta[name="theme-color"]');
  if (theme) theme.content = primary;
}

export function initAppearance() {
  const form = document.querySelector('#appearance-form');
  const primary = form.elements.namedItem('primary');
  const secondary = form.elements.namedItem('secondary');
  const useSecondary = document.querySelector('#use-secondary');
  const message = document.querySelector('#status');
  function values() {
    return { primary: primary.value, secondary: useSecondary.checked ? secondary.value : null };
  }
  function preview() {
    secondary.disabled = !useSecondary.checked;
    document.querySelector('#secondary-color').hidden = !useSecondary.checked;
    document.querySelector('#primary-value').textContent = primary.value;
    document.querySelector('#secondary-value').textContent = secondary.value;
    applyAppearance(values());
  }
  function fill(value) {
    primary.value = value.primary;
    secondary.value = value.secondary ?? value.primary;
    useSecondary.checked = value.secondary !== null;
    preview();
  }
  try { fill(loadAppearance()); } catch (error) {
    fill({ primary: DEFAULT_PRIMARY, secondary: null });
    message.textContent = error.message;
  }
  form.addEventListener('input', () => {
    preview();
    message.textContent = 'Vorschau – noch nicht gespeichert.';
  });
  document.querySelector('#reset-appearance').addEventListener('click', () => {
    fill({ primary: DEFAULT_PRIMARY, secondary: null });
    message.textContent = 'Standardfarben als Vorschau. Zum Übernehmen bitte speichern.';
  });
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    try {
      saveAppearance(values());
      message.textContent = 'Aussehen in diesem Browser gespeichert.';
    } catch (error) {
      message.textContent = `Aussehen konnte nicht gespeichert werden: ${error.message}`;
    }
  });
}
