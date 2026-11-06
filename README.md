# ShipTrack Lite

A simplified shipment-tracking web application, built step by step as a hands-on software engineering learning project.

## Tech stack

- **Frontend:** HTML, CSS, JavaScript
- **Backend:** Node.js (Express, coming next)
- **Database:** SQLite (planned)

## Project structure

```text
shiptrack-lite/
├── public/          Files sent to the browser (HTML, CSS, browser JavaScript)
│   ├── index.html
│   └── style.css
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

For now, open `public/index.html` in your browser.
A Node.js server will replace this in the next step.

## Development workflow

Every change follows this flow:

1. Create a branch from `main`
2. Make and commit the changes
3. Push the branch and open a Pull Request
4. Review, then merge into `main`
5. Update local `main` with `git pull origin main`
