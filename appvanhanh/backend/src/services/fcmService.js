const admin = require('firebase-admin');

let initialized = false;

function init() {
  if (initialized || !process.env.FIREBASE_SERVICE_ACCOUNT) return;
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  initialized = true;
}

async function sendPush(fcmTokens, title, body, data = {}) {
  if (!process.env.FIREBASE_SERVICE_ACCOUNT) return;
  init();
  const tokens = Array.isArray(fcmTokens) ? fcmTokens.filter(Boolean) : [fcmTokens].filter(Boolean);
  if (!tokens.length) return;

  const message = {
    notification: { title, body },
    data: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v)])),
    tokens,
  };

  try {
    await admin.messaging().sendEachForMulticast(message);
  } catch (e) {
    console.error('[FCM]', e.message);
  }
}

module.exports = { sendPush };
