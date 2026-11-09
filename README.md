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
├── public/          Files sent to the browser (HTML, CSS, browser JavaScript)
│   ├── index.html         Home page with the tracking form
│   ├── login.html         Log-in page
│   ├── admin.html         Staff dashboard
│   ├── admin.js           Dashboard behavior
│   ├── register.html      Sign-up page
│   ├── my-shipments.html  A customer's saved shipments
│   ├── my-shipments.js    Behavior of that page
│   ├── style.css
│   ├── app.js             Tracking form: calls the API, shows the result
│   ├── account.js         Log-in and sign-up forms
│   ├── theme.js           Light and dark mode
│   └── nav.js             Shows "Log in" or "Hi, <name> · Log out"
├── src/             Server code (runs on the server, never sent to the browser)
│   ├── app.js             Builds the app and connects all the pieces
│   ├── config.js          Settings that depend on the environment
│   ├── server.js          Starts the app
│   ├── routes/            Which URL does what
│   │   ├── auth.js        Register, log in, log out, "who am I?"
│   │   ├── admin.js       Staff-only shipment management
│   │   ├── myShipments.js A customer's saved shipments
│   │   └── shipments.js   Shipment lookup
│   ├── auth/
│   │   ├── passwords.js   Password hashing (scrypt)
│   │   ├── middleware.js  Reads the login cookie, sets req.user
│   │   └── rateLimiting.js Shared rate limit responses and rules
│   ├── db/
│   │   ├── database.js    Opens the SQLite database and creates the tables
│   │   └── seed.js        Sample shipments, inserted on first run
│   ├── scripts/
│   │   └── make-admin.js  Grants admin rights from the terminal
│   └── models/            SQL queries
│       ├── shipments.js
│       ├── users.js
│       ├── sessions.js
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
| `GET /my-shipments` | A customer's saved shipments |
| `GET /api/my-shipments` | The logged-in customer's saved shipments |
| `POST /api/my-shipments` | Save a shipment `{ trackingNumber }` |
| `DELETE /api/my-shipments/:trackingNumber` | Remove a saved shipment |
| `GET /api/config` | Public settings the browser needs |
| `GET /admin` | Staff dashboard |
| `GET /api/admin/shipments` | One page of shipments, with optional `page`, `search`, and `status` (admin only) |
| `POST /api/admin/shipments` | Create a shipment `{ origin, destination, estimatedDelivery }` (admin only) |
| `PUT /api/admin/shipments/:trackingNumber` | Edit a shipment `{ origin, destination, estimatedDelivery }` (admin only) |
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

Blocked requests get a `429` response with a `Retry-After` header.

When the app runs behind a proxy, set the `TRUST_PROXY` environment variable to the
number of proxies so the limits use each visitor's real address. Leave it unset otherwise.

### Environment variables

| Name | Purpose | Default |
| --- | --- | --- |
| `PORT` | The port to listen on | `3000` |
| `NODE_ENV` | Set to `production` when deployed: enables HTTPS-only cookies and headers | not set |
| `DATABASE_PATH` | Where the database file lives | `shiptrack.db` |
| `TRUST_PROXY` | How many proxies sit in front of the app | `0` |
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
