# Tambola Assistant

A private web app for playing 3–6 Tambola tickets at once. It is fully standalone: no AI service and no running costs. Photograph your tickets, check the scanned grids, then type each number as it's called. The app marks every ticket, tells you which tickets and rows hold the number, and highlights any ticket that is **1 number away** from a prize.

## Using it at a game
1. Log in and tap **Scan ticket photos**. One straight, well-lit photo per ticket gives the best results. A whole-sheet photo also works, but single-digit numbers in the first column may be missed there. **Type 3/6 tickets** lets you enter them by hand instead.
2. **Check your tickets.** Red cells break a ticket rule (5 numbers per row, column ranges 1–9 … 80–90, no duplicates, columns in increasing order). Fix any by tapping the cell. Write T1, T2… on your paper tickets.
3. **Start game** (hold the phone in landscape).
   - Left half: number box, keypad, the "where is it" line, the last 5 numbers, Undo, and the prize chips.
   - Right half: all tickets, with a badge on each.
   - Two-digit numbers go in straight away. For 1–9, press ↵.
   - Tap a prize chip to switch it off once it's claimed, and tap again to switch it back on.
   - "1 to go" alerts: the ticket glows, the missing number shows in yellow, and the phone vibrates once.
   - Early 7 alerts wait until 7 numbers have been called, and Full House alerts until 15. You can change both in ⚙.
4. **⚙ → Reset game…** clears everything, after asking you to confirm.

The game state lives in the browser (localStorage), so a page refresh doesn't lose it, and nothing is sent to the server during play.

## How scanning works
Scanning runs **on the phone**, using [Tesseract.js](https://github.com/naptha/tesseract.js), a free, open-source text reader. The first scan downloads its reader (a few MB) from a CDN, and after that the browser caches it. Photos never leave the phone.
- A number's value fixes its column (47 → the 40s column), so only the row has to come from the photo.
- Each photo is read at a few sizes, with and without the ticket's grid lines erased, and the reading that best fits the ticket rules wins.
- The review screen is the safety net: any ticket that breaks a rule shows in red until you fix it.

## Local run
```bash
python -m venv .venv
.venv/Scripts/pip install -r requirements.txt
.venv/Scripts/python -m app.hashpw
```
Copy `.env.example` to `.env`, then fill in `APP_USERNAME`, `APP_PASSWORD_HASH` (the output of the step above) and `SESSION_SECRET`, and keep `DEV_MODE=1`. Then start the server:
```bash
.venv/Scripts/python -m uvicorn app.main:app --port 8765 --env-file .env
```

## Tests
```bash
node --test tests/prizes.test.js tests/ocr.test.js
```
```bash
.venv/Scripts/python -m pytest -q tests
```

## Deploy on Render
1. Push this folder to a GitHub repo, then in Render choose **New → Blueprint** and point it at that repo (it uses `render.yaml`).
2. Set the env vars in the Render dashboard: `APP_USERNAME` and `APP_PASSWORD_HASH`. `SESSION_SECRET` is generated automatically. Do not set `DEV_MODE`.
3. Free-tier services sleep and take about 50 seconds to wake. Open the app a few minutes before the game starts.

