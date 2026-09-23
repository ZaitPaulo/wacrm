/* eslint-disable */
// ============================================================
// Service worker del CRM — avisos push.
//
// Alcance: "/" (todo el sitio). Solo maneja avisos: NO intercepta
// `fetch`, así que no cachea nada ni cambia cómo carga ninguna página.
//
// El payload lo arma `src/lib/push/payload.ts`:
//   { title, body, tag, renotify, url, notificationId, type, test }
// Cambiar un nombre de campo allá exige cambiarlo aquí.
//
// Se prueba tal cual en `src/lib/push/service-worker.test.ts`.
// ============================================================

// Rutas del CRM (no de la vitrina pública). Tocar un aviso reutiliza una
// pestaña que esté en alguna de estas; una pestaña de la vitrina no sirve.
var CRM_PATHS = [
  '/inbox', '/dashboard', '/notifications', '/contacts', '/pipelines',
  '/broadcasts', '/automations', '/flows', '/settings', '/inventory',
  '/agents', '/documents', '/instagram',
];

self.addEventListener('install', function () {
  // Una versión nueva del service worker entra sin esperar a que se
  // cierren todas las pestañas: no cachea nada, así que no hay mezcla
  // de versiones que temer.
  self.skipWaiting();
});

self.addEventListener('activate', function (event) {
  event.waitUntil(self.clients.claim());
});

// Safari (macOS) y todo iOS usan el servicio de push de Apple, que
// REVOCA la suscripción si un push no muestra un aviso. Ahí se muestra
// siempre, y es la app la que se abstiene de su aviso emergente.
function isApplePush() {
  var ua = (self.navigator && self.navigator.userAgent) || '';
  if (/iPhone|iPad|iPod/.test(ua)) return true;
  return /Safari/.test(ua) && /AppleWebKit/.test(ua) &&
    !/Chrome|Chromium|CriOS|Edg|OPR|Firefox|FxiOS|Android/.test(ua);
}

function isCrmUrl(href) {
  try {
    var u = new URL(href);
    if (u.origin !== self.location.origin) return false;
    return CRM_PATHS.some(function (p) {
      return u.pathname === p || u.pathname.indexOf(p + '/') === 0;
    });
  } catch (e) {
    return false;
  }
}

function safeUrl(raw) {
  try {
    var u = new URL(raw || '/inbox', self.location.origin);
    if (u.origin !== self.location.origin) return new URL('/inbox', self.location.origin);
    return u;
  } catch (e) {
    return new URL('/inbox', self.location.origin);
  }
}

function readPayload(data) {
  if (!data) return {};
  try {
    return data.json() || {};
  } catch (e) {
    try {
      return { body: data.text() };
    } catch (e2) {
      return {};
    }
  }
}

self.addEventListener('push', function (event) {
  var p = readPayload(event.data);
  event.waitUntil(
    (async function () {
      // Con el CRM visible, el aviso emergente de la app (que llega por
      // Realtime) ya avisa y suena: el del sistema sería un duplicado.
      // Chrome no penaliza omitirlo cuando hay una pestaña visible.
      if (!p.test && !isApplePush()) {
        var wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
        var visible = wins.some(function (c) {
          return c.visibilityState === 'visible' && isCrmUrl(c.url);
        });
        if (visible) return;
      }
      var tag = p.tag || 'crm';
      await self.registration.showNotification(p.title || 'Aviso', {
        body: p.body || '',
        // Una notificación por conversación: la siguiente reemplaza a
        // la anterior, y `renotify` hace que vuelva a sonar/vibrar.
        tag: tag,
        renotify: true,
        icon: '/icons/icon-192.png',
        badge: '/icons/badge-96.png',
        vibrate: [200, 100, 200],
        timestamp: Date.now(),
        data: { url: safeUrl(p.url).pathname + safeUrl(p.url).search },
      });
    })()
  );
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  var target = safeUrl(event.notification.data && event.notification.data.url);
  event.waitUntil(
    (async function () {
      var wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      var tab = wins.find(function (c) { return isCrmUrl(c.url); });
      if (tab) {
        // Enfocar y pedirle a la app que navegue con su router: no
        // recarga la página ni abre una pestaña más.
        await tab.focus();
        tab.postMessage({ type: 'navigate', url: target.pathname + target.search });
        return;
      }
      await self.clients.openWindow(target.href);
    })()
  );
});

// El navegador renovó la suscripción por su cuenta (pasa con FCM de vez
// en cuando): se registra la nueva para no quedarse sin avisos.
self.addEventListener('pushsubscriptionchange', function (event) {
  event.waitUntil(
    (async function () {
      try {
        var old = event.oldSubscription;
        var key = old && old.options && old.options.applicationServerKey;
        if (!key) return;
        var sub = event.newSubscription ||
          (await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key }));
        await fetch('/api/push/subscriptions', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(sub.toJSON()),
        });
      } catch (e) {
        // Sin sesión o sin red: la tarjeta de avisos lo detectará la
        // próxima vez que el asesor abra el CRM.
      }
    })()
  );
});
