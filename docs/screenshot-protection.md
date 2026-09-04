# Screenshot protection

## The one thing to understand

Screenshots **can** be blocked outright — but only for a **native window**,
and only by the operating system. Every platform that supports it does so
through a flag the app sets on its own window:

| Platform | Mechanism | Result |
|---|---|---|
| Windows | `SetWindowDisplayAffinity(WDA_EXCLUDEFROMCAPTURE)` — Electron exposes it as `win.setContentProtection(true)` | Screenshots and screen recordings come out **black or empty**. Enforced by the compositor. |
| macOS | `NSWindowSharingNone` — same Electron call | Window is **excluded** from captures and screen shares. |
| Android | `WindowManager.LayoutParams.FLAG_SECURE` | Screenshot **refused** ("can't take screenshot"), recording blanked, recents thumbnail blank. |
| iOS | *nothing* | Apple provides no equivalent. Screenshots can only be **detected after the fact**. |
| **Any web browser** | *nothing* | No API exists, on any OS. A tab cannot refuse capture. |

That last row is the whole problem. The CRM is a website served from GitHub
Pages. **As long as it is opened in a browser tab, screenshots cannot be
prevented — on a laptop or on a phone.** There is no setting, no library, and
no trick that changes this. Anything sold as a web "screenshot blocker" is a
watermark plus a focus trick, which is exactly what `js/screenshield.js` is.

**So "no screenshots whatsoever" has one path: wrap the CRM in a native app
and stop using the browser.** That gets you Windows, macOS and Android fully
blocked, and iOS detected-and-logged. Nothing gets you iOS blocked.

## What ships today (`js/screenshield.js`)

Now armed on **every screen**, not just the lead screens — accounts, contacts,
opportunities and billing are the same data in a different layout.

| Layer | What it does | Where it actually works |
|---|---|---|
| Cover on focus loss | Data goes behind an opaque panel the instant the browser loses focus, so region-capture tools grab the panel | Desktop — real |
| Watermark | Tiles the viewer's name, email and the current minute over everything, modals included | Everywhere, phones included |
| PrintScreen | Swallows the key, overwrites the clipboard with a notice, logs it | Windows desktop |
| Print blocking | `Ctrl+P` blocked; printing renders a notice | Desktop |
| Attempt log | Last 50 attempts in `localStorage` — `ScreenShield.log()` | Per browser |

**Why the cover works on desktop:** Snipping Tool, `Win+Shift+S`,
`Cmd+Shift+4`, Greenshot and Lightshot all have to take focus from the browser
to let you drag a region. The moment focus leaves, the cover drops and the
capture gets the cover.

**Why it does nothing on a phone:** Android and iOS screenshot without
notifying the page — no event, no visibility change. The page cannot know, so
it cannot hide first. On a phone browser the watermark is the entire
protection, and it is traceability, not prevention. The one thing it does buy:
backgrounding the CRM fires a visibility change, so the **app-switcher
thumbnail** is the cover rather than a lead list.

**What none of it stops, anywhere:** a phone camera pointed at the screen, a
capture card on a second machine, or an OBS-style full-screen grab that never
steals focus.

## The wrapper: how to actually block it

The web app stays exactly as it is. The wrapper loads it in a native window
and sets the OS flag.

### Desktop — Electron

```js
// main.js
const win = new BrowserWindow({
  webPreferences: { preload: path.join(__dirname, 'preload.js') }
})
win.setContentProtection(true)           // Windows + macOS hard block
win.loadURL('https://crm.thinkfirststudios.com')
```

```js
// preload.js — tells the web app it is running somewhere protected
contextBridge.exposeInMainWorld('TFS_SECURE_CLIENT', true)
```

Distribute as a signed `.exe` / `.dmg` — no app store involved. Code signing
certificates cost roughly $100–400/year, or ship unsigned and accept the
SmartScreen warning on first run.

### Android — Capacitor

```java
// MainActivity.onCreate, before super.onCreate
getWindow().setFlags(
    WindowManager.LayoutParams.FLAG_SECURE,
    WindowManager.LayoutParams.FLAG_SECURE);
```

Same flag banking apps use. Distribute through Play Internal Testing — no
public listing, no review queue. $25 one-time developer fee.

### iOS — detection only

No block exists. The available pieces:

- `UIApplication.userDidTakeScreenshotNotification` — fires *after* the
  screenshot exists. Log it, warn the user, notify an admin.
- `UIScreen.isCaptured` — true during screen recording or AirPlay, so the
  WebView can be blanked while recording is active.
- Blank the window on `sceneWillResignActive` to protect the app-switcher
  snapshot.
- The `isSecureTextEntry` overlay trick hides a view from the capture buffer.
  Undocumented, works today, Apple can break it in any release. Not a
  foundation for a policy.

TestFlight for distribution; $99/year developer program.

### Then close the browser door

`js/screenshield.js` has a switch for this:

```js
var REQUIRE_SECURE_CLIENT = false;   // set true once the wrapper ships
```

When true, the CRM refuses to render records in a plain browser and shows an
"open the CRM in the app" panel instead. It looks for `TFS_SECURE_CLIENT` (set
by the preload above) or a `TFSCRM-Secure` token in the user agent.

**Do not turn it on before the wrapper exists** — it locks everyone out,
including you. That is the point of it.

Be clear about what the gate is: it stops the team casually using the browser.
It is not a security boundary. Someone who opens the console can set the global
by hand, and the Supabase API answers to any valid session token no matter what
the page renders.

## Rough scope

Electron shell + Capacitor Android + iOS detection, all pointing at the
existing web app: a few days of work. Ongoing cost $25 one-time (Play) and
$99/year (Apple), plus optional desktop code signing. No changes to the CRM
itself beyond the flag above.

## What the wrapper still will not fix

Worth saying plainly, because "no screenshots" can create false confidence
about where the real exposure is:

- A phone camera aimed at the screen. Unfixable, everywhere, always.
- iOS. Detected, never blocked.
- Copy and paste — deliberately left working, because reps need to paste phone
  numbers into a dialer all day. Anyone who can read a lead can copy it.
- **The Supabase API.** Anyone signed in can pull the entire lead table with
  one HTTP request. The shield is a UI layer; row-level security in
  `supabase/schema.sql` is what actually limits who reads what.
- **Exports.** Admin → Data & Backup downloads the whole database as JSON.

If the worry is leads walking out the door rather than a shoulder-surfer, RLS
rules and export permissions are the controls that bite. Screen protection
raises the effort; access control sets the ceiling.

## Turning things off

- Whole shield off: `SHIELD_ENABLED = false` in `js/screenshield.js`.
- Back to lead screens only: `PROTECT_EVERY_SCREEN = false` (the `PROTECTED`
  map below it lists which routes stay covered).

Bump `CRM_BUILD` in `index.html` after any change, or GitHub Pages serves the
old file for ten minutes.
