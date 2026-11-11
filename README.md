# ShipTrack Lite

A simplified shipment-tracking web application, built step by step as a hands-on software engineering learning project.

## Tech stack

- **Frontend:** HTML, CSS, JavaScript
- **Backend:** Node.js + Express
- **Database:** SQLite (built into Node.js, via `node:sqlite`)
- **Security:** Helmet for HTTP security headers

## Project structure

```text
shiptrack-lite/
├── public/          Files sent to the browser as they are
│   ├── style.css
│   ├── theme.js           Light and dark mode
│   ├── nav.js             Shows "Log in" or the account links
│   ├── track.js           Tracking form on the home page
│   ├── account.js         Log in, sign up, password reset, and email links
│   ├── my-shipments.js    A customer's saved shipments
│   ├── admin.js           Staff dashboard
│   └── favicon.svg
├── src/             Server code (runs on the server, never sent to the browser)
│   ├── pages/             The pages. _layout.html holds the shared head, header, and footer;
│   │                      each page file only holds that page's content.
│   ├── app.js             Builds the app and connects all the pieces
│   ├── config.js          Settings that depend on the environment
│   ├── server.js          Starts the app
│   ├── routes/            Which URL does what
│   │   ├── auth.js        Register, log in, log out, "who am I?"
│   │   ├── account.js     Password reset and email confirmation
│   │   ├── admin.js       Staff-only shipment management
│   │   ├── myShipments.js A customer's saved shipments
│   │   ├── notifications.js Update email settings and unsubscribing
│   │   ├── pages.js       Builds each page from the shared layout
│   │   └── shipments.js   Shipment lookup
│   ├── auth/
│   │   ├── passwords.js   Password hashing (scrypt)
│   │   ├── middleware.js  Reads the login cookie, sets req.user
│   │   └── rateLimiting.js Shared rate limit responses and rules
│   ├── db/
│   │   ├── database.js    Opens the SQLite database and creates the tables
│   │   └── seed.js        Sample shipments, inserted on first run
│   ├── email/             Sending email and what the emails say
│   ├── jobs/              Background job queue, worker, and job types
│   ├── scripts/
│   │   └── make-admin.js  Grants admin rights from the terminal
│   └── models/            SQL queries
│       ├── shipments.js
│       ├── users.js
│       ├── sessions.js
│       ├── accountTokens.js
│       ├── savedShipments.js
│       └── rateLimits.js
├── test/            Automated tests (run with npm test)
├── package.json     Project info, scripts, and dependencies
└── README.md
```

## Requirements

- [Node.js](https://nodejs.org/) version 22.13 or newer (needed for the built-in SQLite)

Check your version:

```powershell
node -v
```

## Running locally

1. Install the dependencies (only needed the first time, or after `package.json` changes):

   ```powershell
   npm install
   ```

2. Start the server:

   ```powershell
   npm run dev
   ```

3. Open <http://localhost:3000> in your browser.

`npm run dev` restarts the server automatically when you save a file.
Use `npm start` to run it without auto-restart.
Press `Ctrl + C` in the terminal to stop the server.

### Routes

| URL | What it returns |
| --- | --- |
| `GET /` | The landing page |
| `GET /login`, `GET /register` | Log-in and sign-up pages |
| `GET /api/health` | `{"status":"ok"}` (checks the server is running) |
| `GET /api/shipments/:trackingNumber` | One shipment as JSON. `400` if the number is badly formatted, `404` if it doesn't exist |
| `POST /api/auth/register` | Create an account `{ name, email, password }` and log in |
| `POST /api/auth/login` | Log in `{ email, password }` |
| `POST /api/auth/logout` | Log out |
| `GET /api/auth/me` | The logged-in user, or `401` |
| `POST /api/auth/forgot-password` | Email a reset link `{ email }` |
| `POST /api/auth/reset-password` | Set a new password `{ token, password }` |
| `POST /api/auth/confirm-email` | Confirm an email address `{ token }` |
| `POST /api/auth/resend-confirmation` | Email a new confirmation link |
| `PUT /api/notifications/preferences` | Turn update emails on or off `{ shipmentUpdates }` |
| `POST /api/notifications/unsubscribe` | Turn update emails off with the link from an email |
| `GET /my-shipments` | A customer's saved shipments |
| `GET /api/my-shipments` | The logged-in customer's saved shipments |
| `POST /api/my-shipments` | Save a shipment `{ trackingNumber }` |
| `DELETE /api/my-shipments/:trackingNumber` | Remove a saved shipment |
| `GET /api/config` | Public settings the browser needs |
| `GET /admin` | Staff dashboard |
| `GET /api/admin/shipments` | One page of shipments, with optional `page`, `search`, and `status` (admin only) |
| `POST /api/admin/shipments` | Create a shipment `{ origin, destination, estimatedDelivery }` (admin only) |
| `PUT /api/admin/shipments/:trackingNumber` | Edit a shipment `{ origin, destination, estimatedDelivery }` (admin only) |
| `GET /api/admin/shipments/:trackingNumber` | One shipment with its history (admin only) |
| `PUT /api/admin/shipments/:trackingNumber/events/:eventId` | Fix a history entry `{ location, description }` (admin only) |
| `DELETE /api/admin/shipments/:trackingNumber/events/:eventId` | Remove a history entry (admin only) |
| `DELETE /api/admin/shipments/:trackingNumber` | Delete a shipment and its history (admin only) |
| `POST /api/admin/shipments/:trackingNumber/events` | Post an update `{ status, location, description }` (admin only) |

### Becoming an admin

Sign up on the website, then run this in the terminal with your email:

```powershell
npm run make-admin -- you@example.com
```

Admin rights can only be granted from the terminal, never from the website.

### How login works

- Passwords are hashed with **scrypt** (with a random salt) before being stored. The password itself is never saved.
- On log-in, the server creates a random session token and sends it in an `HttpOnly` cookie.
  Only a hash of the token is stored in the database.
- Sessions last 7 days. Logging out deletes the session.

### Rate limits

| What's limited | Limit |
| --- | --- |
| Failed log-ins for one account from one address | 5 per 15 minutes |
| Failed log-ins from one address, across all accounts | 30 per 15 minutes |
| Sign-up attempts from one address | 20 per hour |
| Tracking number lookups from one address | 60 per minute |
| Password reset requests from one address | 10 per hour |
| Password reset emails to one account | 3 per hour |

Blocked requests get a `429` response with a `Retry-After` header.

When the app runs behind a proxy, set the `TRUST_PROXY` environment variable to the
number of proxies so the limits use each visitor's real address. Leave it unset otherwise.

### Background jobs

Slow or unreliable work, like sending email, runs in the background through a job queue
stored in the database (`src/jobs/`). The server checks it every 2 seconds. Failed jobs are
tried again after 1, 2, 4, 8... minutes, up to 5 attempts. Finished jobs keep no payload,
because email jobs can contain private links.

When staff post a shipment update, customers who saved that shipment, confirmed their email,
and kept update emails on get an email. Each email has a one-click unsubscribe link.

### Email while developing

Without `SMTP_URL`, emails are printed in the terminal, so you can copy links from there.
In production without `SMTP_URL`, emails are not sent or printed, because they contain private links.

### Environment variables

| Name | Purpose | Default |
| --- | --- | --- |
| `PORT` | The port to listen on | `3000` |
| `NODE_ENV` | Set to `production` when deployed: enables HTTPS-only cookies and headers | not set |
| `DATABASE_PATH` | Where the database file lives | `shiptrack.db` |
| `TRUST_PROXY` | How many proxies sit in front of the app | `0` |
| `APP_URL` | The site's public address, used for links in emails | `http://localhost:3000` |
| `SMTP_URL` | The mail server, e.g. `smtp://user:password@host:587` | not set |
| `EMAIL_FROM` | The sender shown on emails | `ShipTrack Lite <no-reply@shiptrack.example>` |
| `RUN_JOBS` | Set to `false` to stop the server running background jobs | runs them |
| `SEED_DEMO_DATA` | `true` or `false` to override demo mode | on, except in production |

### Testing

```powershell
npm test
```

The tests use a temporary database in memory, so they never touch `shiptrack.db`.
They also run on GitHub for every Pull Request.

### Sample tracking numbers

The first time the server starts, it creates the database file `shiptrack.db`
and fills it with these sample shipments (see `src/db/seed.js`).
The file is not committed to Git. Delete it to start over with fresh sample data.

| Tracking number | Status |
| --- | --- |
| `ST10000001` | In Transit |
| `ST10000002` | Delivered |
| `ST10000003` | Pending |

## Development workflow

Every change follows this flow:

1. Create a branch from `main`
2. Make and commit the changes
3. Push the branch and open a Pull Request
4. Review, then merge into `main`
5. Update local `main` with `git pull origin main`
