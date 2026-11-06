# ShipTrack Lite

A simplified shipment-tracking web application, built step by step as a hands-on software engineering learning project.

## Tech stack

- **Frontend:** HTML, CSS, JavaScript
- **Backend:** Node.js + Express
- **Database:** SQLite (built into Node.js, via `node:sqlite`)

## Project structure

```text
shiptrack-lite/
├── public/          Files sent to the browser (HTML, CSS, browser JavaScript)
│   ├── index.html
│   ├── style.css
│   └── app.js       Browser code: sends the tracking form to the API, shows the result
├── src/             Server code (runs on the server, never sent to the browser)
│   ├── server.js          Routes: decides how to answer each request
│   ├── db/
│   │   ├── database.js    Opens the SQLite database and creates the tables
│   │   └── seed.js        Sample shipments, inserted on first run
│   └── models/
│       └── shipments.js   SQL queries for shipments
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
| `/` | The landing page |
| `/api/health` | `{"status":"ok"}` (checks the server is running) |
| `/api/shipments/:trackingNumber` | One shipment as JSON. `400` if the number is badly formatted, `404` if it doesn't exist |

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
