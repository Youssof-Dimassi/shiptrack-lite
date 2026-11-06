# ShipTrack Lite

A simplified shipment-tracking web application, built step by step as a hands-on software engineering learning project.

## Tech stack

- **Frontend:** HTML, CSS, JavaScript
- **Backend:** Node.js + Express
- **Database:** SQLite (planned)

## Project structure

```text
shiptrack-lite/
├── public/          Files sent to the browser (HTML, CSS, browser JavaScript)
│   ├── index.html
│   ├── style.css
│   └── app.js       Browser code: sends the tracking form to the API, shows the result
├── src/             Server code (runs on the server, never sent to the browser)
│   ├── server.js
│   └── data/
│       └── shipments.js   Sample shipment data
├── package.json     Project info, scripts, and dependencies
└── README.md
```

## Requirements

- [Node.js](https://nodejs.org/) version 20 or newer

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

The data is sample data for now (in `src/data/shipments.js`); a database comes later.

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
