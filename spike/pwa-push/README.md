# PWA push spike (throwaway)

Proves spec §4 option A: an installed web app can receive push notifications on an iPhone in Greece and on Android.

## Run (Windows, PowerShell)

```powershell
cd C:\Users\dimbl\Desktop\Gym_Managment_App\spike\pwa-push
npm install
npm start
```

In a second PowerShell window (install once with `winget install Cloudflare.cloudflared`):

```powershell
cloudflared tunnel --url http://localhost:3000
```

Open the `https://….trycloudflare.com` address it prints on each phone.

## Checklist

Record each result in `docs/spikes/2026-11-pwa-push.md`.

1. **iPhone:** Safari → Share → Add to Home Screen. Open the app from the icon. The status shows `standalone: true`.
2. Tap **Enable notifications** → allow. The status shows `subscribed: 201`.
3. Tap **Send test in 10 seconds**, then close the app and lock the phone. The notification appears on the lock screen.
4. **Android (Chrome):** install from the menu or prompt, then repeat steps 2–3.

Restarting the server creates new keys, so tap Enable again after a restart.
