# The Board — personal draft rankings

A single-page tool that blends consensus rankings from multiple sources (weighted by how much you trust each one), then re-sorts them for your league's scoring/roster and your personal draft-day preferences (positional scarcity, risk tolerance, injury flags, rookie bias, manual overrides).

Ships with two sources pre-configured — **FantasyPros** (supports live fetch) and **Draft Sharks** (CSV paste) — and you can add more from the app itself.

## What's in here

- `index.html` — the whole app (frontend). This is what goes on GitHub Pages.
- `worker.js` — a Cloudflare Worker that fetches pages server-side (both FantasyPros' specific format and, generically, any URL you point it at) so the browser can pull "live" data without hitting a CORS block.

## 1. Publish the frontend on GitHub Pages

1. Create a new repo (or use an existing one), add `index.html` to the root (or a `/docs` folder).
2. Repo Settings → Pages → set source to the branch/folder containing `index.html`.
3. Your site will be live at `https://<username>.github.io/<repo>/`.

That alone gets you the full tool with **CSV paste** working for every source — no other setup needed. Live fetch (step 2 below) is optional but shared by every source.

## 2. (Optional) Set up live fetch via Cloudflare Worker

Sites generally don't offer a public rankings API, and browsers block direct cross-site requests, so a plain static page can't pull data from other domains automatically. `worker.js` is a small proxy that runs server-side on your behalf. One deployed Worker powers live fetch for every source card in the app — FantasyPros gets a dedicated, more reliable extraction; anything else (Draft Sharks, or a source you add yourself) uses a generic "find the biggest table on the page" parser.

1. Sign up (free) at [dash.cloudflare.com](https://dash.cloudflare.com).
2. Workers & Pages → Create → Create Worker.
3. Delete the default code, paste in `worker.js`.
4. Edit the `ALLOWED_ORIGIN` constant near the top to your GitHub Pages URL (e.g. `https://gil.github.io`) — tightening this from `"*"` stops other sites from riding on your Worker, and matters more now that it's a general-purpose fetcher.
5. Deploy. Copy the Worker's URL (looks like `https://the-board.<you>.workers.dev`).
6. Open your published site, paste that URL into the **Worker URL** field on the FantasyPros card — every other source's "Live fetch" button reuses it automatically.

**Heads up on reliability:**
- FantasyPros' live fetch finds a JSON blob they embed in their page source — a standard scraping technique, but not an official integration, and can silently break if they change their site.
- The generic live fetch (used for every other source) only sees plain HTML — the same as "View Source." Pages that build their table with JavaScript won't have any rows in that HTML, and the fetch will report it couldn't find a table.
- The Worker has no login session, so it can't reach anything behind a paywall or login. For those, export the data yourself while logged in and paste the CSV in.

Either way, the app is built to fail gracefully — the status line under each source tells you to fall back to CSV paste, and everything else (settings, weighting, flags) keeps working exactly the same regardless of how the data got in. This is meant for personal, occasional use, not frequent automated polling.

## 3. Getting each source's CSV

**FantasyPros** — on the [Half PPR Cheatsheet](https://www.fantasypros.com/nfl/rankings/half-point-ppr-cheatsheets.php), look for an Export/CSV option (available to free accounts on most rankings pages).

**Draft Sharks** — their [Half-PPR rankings](https://www.draftsharks.com/rankings/half-ppr) are behind a login, and most of the list beyond the top ~25 players is a paid Insider feature. Log into your own account, export/copy the rankings, and paste them into the Draft Sharks card in the app.

**Any other source** — click "+ Add another source" in the app, name it, and either point it at a live page URL or paste its CSV. Any reasonably standard rankings table (columns for rank and player name, at minimum) should parse fine either way.

## Your league is pre-loaded as the default

Half-PPR scoring, 12 teams (adjust if wrong), QB/2RB/3WR/TE/1FLEX(W-R-T)/K/DEF starters, 5 bench + 1 IR. Everything is editable in the **League settings** panel if your league changes or you want to reuse this for a different league.

## How the ranking adjustments work

- **Blending**: each source's rankings are converted to a percentile within that source's own list, then combined as a weighted average using the trust weight on each source card. A player found in only one source is scored on that source alone (marked with `*` in the table).
- **Positional scarcity**: compares your league's per-team demand at each position (starters + a share of the flex spot) against a standard 12-team/1QB/2RB/2WR/1TE/1FLEX baseline. Positions your league makes scarcer get pulled up the board.
- **Risk tolerance**: combines FantasyPros' own expert-disagreement figure (rank std. dev., when available) with how much your sources disagree with each other on a player's rank — both used as a boom/bust signal.
- **Injury flag / rookie flag**: you manually flag specific players in the table; the sliders control how much weight those flags carry.
- **Team factors** (new): a **Team Factors** table at the bottom lets you enter 1–32 ranks per team for offensive-line run blocking, offensive-line pass protection, QB strength, and strength of schedule split by RB / WR-TE / QB. Four sliders control how much each factor moves a player:
  - *Run-blocking O-line* boosts/downgrades RBs based on their team's run-blocking rank.
  - *Pass-protection O-line* boosts/downgrades QB/WR/TE based on their team's pass-protection rank.
  - *QB support* boosts/downgrades WR/TE based on their own team's QB-strength rank.
  - *Strength of schedule* boosts/downgrades every skill position using the matching SOS list for their position.
  - You can paste a CSV (`TEAM,OL_RUN,OL_PASS,QB_STRENGTH,DEF_STRENGTH,SOS_RB,SOS_WRTE,SOS_QB`) or edit the 32-team table directly in the browser. Teams left at the neutral default (16) get no adjustment.
  - *Game script* (new): uses the Defense rank column. A bad defense means a team trails more, boosting pass volume for its QB/WR/TE; a good defense means a team leads more, boosting rush volume for its RB.
- **Projections and VORP**: paste raw stat projections (and/or last season's actual raw stats, blended via the History Weight slider) in the **Fantasy point projections** section. Projected Points run through your exact League Scoring Rules, then VORP (Value Over Replacement) compares each player's points to the last realistic starter at his position — the correct signal for maximizing your starting lineup's total expected points, not just raw points or consensus rank.
- **Manual override**: type a rank directly into a player's row to lock them there, ignoring every other factor.

## Auditing why a player moved

Click **▸ why** next to any player to see exactly which sliders moved them and by how much — positional scarcity, risk tolerance, each team factor, VORP, everything. No need to reverse-engineer it by eye; the tool shows its work per player.

This is a heuristic tool, not a formal value-based-drafting calculator — it's meant to nudge the consensus board toward your judgment, not replace it.

## Version 2 automatic-data additions

This package now loads `data/rankings.json`, `data/team-context.json`, and `data/yahoo-history-2025.json` automatically. The scheduled workflow in `.github/workflows/update-rankings.yml` refreshes configured licensed feeds without exposing API credentials to the browser.

Custom league scoring now includes imported 40+ yard pass-completion, rushing, and receiving bonuses. The board retains separate controls for run blocking, pass protection, QB support for WR/TE, team defense/game script, and position-specific strength of schedule. See `SETUP.md` for the minimal deployment steps.
