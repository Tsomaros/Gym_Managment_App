import { createRequire } from 'node:module';
const webpush = createRequire(import.meta.url)('web-push');

// Prints a fresh VAPID key pair for .env.
const { publicKey, privateKey } = webpush.generateVAPIDKeys();
console.log(`VAPID_PUBLIC_KEY=${publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${privateKey}`);
console.log('VAPID_SUBJECT=mailto:you@example.com');
