export async function initUpdates(reportError) {
  if (!('serviceWorker' in navigator)) return;
  const serviceWorker = navigator.serviceWorker;
  let controlled = Boolean(serviceWorker.controller);
  let activating = false;
  let reloadAvailable = false;
  let registration;
  let notice;
  let button;

  function showUpdate() {
    if (!notice) {
      notice = document.createElement('section');
      notice.className = 'notice update-notice';
      notice.setAttribute('aria-label', 'App-Aktualisierung');
      const message = document.createElement('p');
      message.setAttribute('role', 'status');
      message.textContent = 'Update verfügbar. Bitte zuerst Änderungen speichern. Beim Aktualisieren wird die Seite neu geladen.';
      button = document.createElement('button');
      button.type = 'button';
      button.textContent = 'Jetzt aktualisieren';
      button.addEventListener('click', () => {
        if (!window.confirm('Jetzt aktualisieren? Ungespeicherte Eingaben gehen beim Neuladen verloren.')) return;
        if (reloadAvailable) {
          window.location.reload();
          return;
        }
        const waiting = registration.waiting;
        if (!waiting) {
          reportError('Das Update ist nicht mehr verfügbar. Bitte die Seite neu laden.');
          return;
        }
        activating = true;
        button.disabled = true;
        button.textContent = 'Wird aktualisiert …';
        try {
          waiting.postMessage({ type: 'SKIP_WAITING' });
        } catch (error) {
          activating = false;
          button.disabled = false;
          button.textContent = 'Jetzt aktualisieren';
          reportError(`App-Update konnte nicht aktiviert werden: ${error.message}`);
        }
      });
      notice.append(message, button);
      document.querySelector('main').prepend(notice);
    }
  }

  serviceWorker.addEventListener('controllerchange', () => {
    if (controlled) {
      reloadAvailable = true;
      showUpdate();
      button.disabled = false;
      button.textContent = 'Jetzt aktualisieren';
      if (activating) {
        activating = false;
        window.location.reload();
      }
    }
    controlled = true;
  });

  registration = await serviceWorker.register('./service-worker.js', { updateViaCache: 'none' });
  function checkWaiting() {
    if (registration.waiting && serviceWorker.controller) showUpdate();
  }
  function watchInstalling() {
    registration.installing?.addEventListener('statechange', checkWaiting);
  }
  registration.addEventListener('updatefound', watchInstalling);
  watchInstalling();
  checkWaiting();

  async function checkForUpdate() {
    if (!navigator.onLine) return;
    try {
      await registration.update();
    } catch (error) {
      reportError(`App-Update konnte nicht geprüft werden: ${error.message}`);
    }
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') checkForUpdate();
  });
  window.addEventListener('online', checkForUpdate);
}
