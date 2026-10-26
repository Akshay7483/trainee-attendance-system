# Trainee Attendance System

A responsive attendance app built with **plain HTML, CSS, and JavaScript**. No React, backend, database service, subscription, or build step is needed to run the website.

**GitHub Pages address (after deployment):** https://Akshay7483.github.io/trainee-attendance-system/

## Features

- First-time administrator setup with a recovery code.
- Admin and trainee sign-in using a name and PIN.
- Six-digit temporary PINs and required first-login PIN changes.
- Trainer management, trainee registration, reassignment, and PIN reset.
- Daily IN/OUT attendance, working hours, administrator corrections, and bulk marking.
- Daily reports, monthly summaries, trainer filters, and CSV downloads.
- Light, dark, and device-based themes with responsive phone and desktop layouts.
- JSON backup download and validated, transactional backup restoration.
- Compatibility with version 1 backups from the earlier attendance project.

## Use the app

1. Open the published GitHub Pages URL.
2. Create the first admin account and save its recovery code privately.
3. Add trainers and register trainees.
4. Share each trainee's temporary PIN privately. Trainees must choose a new PIN before marking attendance.
5. Use Reports for exports and Settings for backup and restoration.

**This is a browser-local application.** Records are kept in IndexedDB for the current browser and website address. Different devices and browsers have separate records. A site update retains records on the same origin; clearing browser data removes them. Back up regularly.

PINs are stored as salted PBKDF2 hashes, but browser-only accounts are a convenience for a trusted shared device, not a server-enforced security boundary. This static GitHub Pages edition does not provide shared multi-device records or secure online authorization. Those require a separate backend.

Keep backups private because they contain account credential hashes. Restoring a backup replaces this browser's existing records and signs you out; sign in with an account from the backup afterward. Attendance history for deleted trainees is retained.

## Run locally

The website itself consists of `index.html` and the `assets` directory. Serve them with any local static HTTP server. Do not rely on opening the HTML as a `file://` URL because module scripts and browser storage work best on HTTPS or localhost.

For the included development server and tests, install Node.js 22 or later:

```sh
npm ci
npm run dev
```

Open http://127.0.0.1:5174/.

```sh
npm run check
```

Tests use an isolated in-memory IndexedDB database and do not access real browser attendance data. Node.js and test dependencies are not needed on GitHub Pages.

## Deploy to GitHub Pages

The repository includes `.github/workflows/pages.yml`. It checks JavaScript syntax, runs tests, and publishes only the static website files after a push to `main`.

In the repository's **Settings → Pages → Build and deployment**, choose **GitHub Actions**. Push to `main` or run the workflow manually. The deployment job displays the final website URL after it succeeds.

GitHub Free supports Pages for public repositories. No hosting keys, paid resources, Neon account, or Render account are needed for this static edition. See [GitHub's Pages workflow documentation](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).

All links and assets use relative paths or hash navigation so the app works under `/trainee-attendance-system/` and refreshes without server routing rules.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | Website entry point |
| `assets/styles.css` | Responsive layout and themes |
| `assets/app.js` | Interface, navigation, and attendance workflows |
| `assets/data.js` | IndexedDB storage, credential hashing, CSV, and backup validation |
| `tests/` | Storage and interface regression tests |
| `.github/workflows/pages.yml` | Test and Pages deployment workflow |

Created for [Akshay7483](https://github.com/Akshay7483).
