# blogtv-data

Auto-updated channel and URL data for the **BlogTV** Roku channel.

## What this repo does

A GitHub Actions workflow runs every 6 hours and:
1. Fetches 8,000+ free IPTV streams from [iptv-org/iptv](https://github.com/iptv-org/iptv)
2. Fetches topic-matched videos from YouTube Data API (if key is set)
3. Fetches popular show metadata from TMDB (if key is set)
4. Merges your `custom_channels.json` and `user_channels.json`
5. Outputs `data/channels.json` and `data/url_history.json`
6. Commits and pushes — GitHub Pages serves the files instantly

## Setup

### 1. Fork or create this repo

### 2. Enable GitHub Pages
- Settings -> Pages -> Source: **Deploy from branch** -> Branch: `main` -> Folder: `/`

### 3. Add API keys as Secrets (optional but recommended)
- Settings -> Secrets and variables -> Actions -> New repository secret
  - `YOUTUBE_API_KEY` — get free at [console.cloud.google.com](https://console.cloud.google.com)
  - `TMDB_API_KEY` — get free at [themoviedb.org/settings/api](https://www.themoviedb.org/settings/api)

The channel builder works without these keys (iptv-org + custom lists only).

### 4. Run the workflow manually to build the initial data
- Actions -> Update Channel Data -> Run workflow

### 5. Update BlogTV Roku channel config
Edit `components/BlogTVScene.brs` and set your GitHub Pages URL:

```brightscript
m.dataBaseUrl = "https://YOUR_USERNAME.github.io/blogtv-data/data"
```

## File reference

| File | Purpose |
|---|---|
| `data/channels.json` | Auto-generated. Do not edit manually. |
| `data/url_history.json` | Curated URL bookmarks for Roku URL dialog. |
| `data/custom_channels.json` | **Your curated channels.** Edit this freely. |
| `data/user_channels.json` | Channels added by users through the Roku app. |
| `scripts/build-channels.js` | The merger script. |
| `.github/workflows/update-channels.yml` | Cron schedule. |

## Adding custom channels

Edit `data/custom_channels.json`:

```json
{
  "technology": [
    {
      "name": "My Tech Stream",
      "url":  "https://example.com/stream.m3u8",
      "logo": "https://example.com/logo.png",
      "desc": "Description shown in Roku UI",
      "type": "live"
    }
  ]
}
```

Types: `live` (HLS), `vod` (on-demand), `mp4` (direct file), `info` (metadata only)

## Category keywords

The Roku app maps article keywords to these categories:

`news` `technology` `science` `history` `sports` `music`
`entertainment` `nature` `cooking` `travel` `politics` `business`
`health` `kids` `animation` `general`
