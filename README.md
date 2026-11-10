# Reztoration

An interactive 3D map of the United States drawn by Indigenous nations instead of states. Click a territory and it rises; its page gathers the nation's own sources, stories, photos and recordings from open archives, plant knowledge, and the tribal lands held today.

Read PROTOCOLS.md first.

## Run

    npm start            # http://localhost:8600  (8602 for tests)
    npm run build        # rebuild map geometry from data/raw
    npm test             # API suite: search, What land am I on?, treaties, businesses, the protocols (own server on 8602)
    npm run test:pages   # every screen in headless Chrome, counted in the live DOM (SHOTS=dir keeps screenshots)
    npm run check        # treaty checker + both suites; run before calling anything done

Or double-click **Start Reztoration.command**.

## How it fits together

- `data/raw/` : source geometry. Native Land Digital territories (565 kept inside the US) and US Census 2020 tribal lands (513: federal and state reservations, Oklahoma and Alaska Native areas). `census-gazetteer-places.txt` and `census-gazetteer-zcta.txt` are the Census 2024 Gazetteer (public domain), used by "What land am I on?" to turn a town or zip code into a point on this machine.
- `scripts/build-map.mjs` : projects them (Albers, Alaska and Hawaii insets) into `public/data/*.json`.
- `data/research/` : what the research agents gather. `nations.json`, `nativeland-crosswalk.json`, `archive-items.json`, `archives-registry.json`, `plant-uses.json`, `plants.json`.
- `scripts/harvest/` : the harvesters. Each pulls from one open source, politely (about one request a second, loc.gov one every 4), caches every response in `data/cache/` so a rerun is free, applies the sacred filter, and writes `data/research/harvest/<source>.json`:
  - `ia.mjs` Internet Archive films, recordings, books
  - `loc.mjs` Library of Congress photos, films, recordings, documents
  - `art.mjs` Art Institute of Chicago + Cleveland Museum of Art
  - `mia.mjs` Minneapolis Institute of Art
  - `journals.mjs` Directory of Open Access Journals
  - `plants.mjs` BRIT Native American Ethnobotany Database (writes `plant-uses.json`, `plants.json`)
  - `profiles.mjs` a Wikipedia introduction and picture per territory (`profiles.json`)
  Run all: `npm run harvest`. Try one on a few names: `NAMES="Crow,Hopi" node scripts/harvest/ia.mjs` (writes `trial-*`, ignored by the app).
- `data/research/search-names.json` : the names archives file a people under, for territories whose map name is in their own language. Edit this when a homeland comes up thin.
- `lib/protocols.mjs` : the sacred filter (protocol 2). Applied at harvest AND at load, so tightening it hides already-gathered items at once.
- `lib/library.mjs` : joins research onto territories by name, alias and crosswalk. Re-reads a research file when it changes, so new findings show up without a restart.
- `server.mjs` : static page plus `/api/whoami`, `/api/stats`, `/api/search`, `/api/browse?group=`, `/api/territory/:id`, `/api/territory/:id/items?group=&q=&offset=`, `/api/territory/:id/plants?use=&q=`, `/api/land/:id`.

Matching is strict on purpose: a hit counts only when the people's name sits beside a people word ("Crow Indians", "Chinook texts", "Tribe of the Fox") or is a library subject heading, so crows, Fox News and Chinook salmon stay out.
- `public/` : the three.js page.

## Hosting it

`deploy/README.md` puts the map online for free on an Oracle Cloud Always Free machine: one setup script, HTTPS through Caddy, a per-visitor request limit, and never the Native Land outlines.

## Native Land data is not in this repository

The territory outlines come from Native Land Digital (https://native-land.ca/). Their Data Sovereignty Treaty does not allow the data to be stored or redistributed without their written permission, so `data/raw/nativeland-territories.json` and the built `public/data/territories.json` are left out of git until they say yes. To run the map yourself, get the territories from the Native Land API under their terms, save them as `data/raw/nativeland-territories.json`, and run `npm run build`. See `data/research/nativeland-terms.md`.

Without the outlines the map still opens: tribal lands today, treaties, nations, businesses, "What land am I on?" and the Library all work, and the homeland layer and its pages are simply absent. `REZ_NO_HOMELANDS=1 npm start` runs a copy that has the outlines as if it did not, and the page suite checks that mode on its own server every run.
