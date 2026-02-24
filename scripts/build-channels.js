/**
 * build-channels.js
 *
 * Fetches channel data from four sources and merges them into:
 *   ../data/channels.json   -- channel list indexed by category
 *   ../data/url_history.json -- curated URL bookmarks for the Roku URL dialog
 *
 * Sources:
 *   1. iptv-org/iptv  -- free M3U streams, no API key
 *   2. YouTube Data API v3  -- topic-matched videos (YOUTUBE_API_KEY)
 *   3. TMDB API  -- movie/show metadata by genre (TMDB_API_KEY)
 *   4. custom_channels.json -- hand-maintained list (always included)
 *   5. user_channels.json   -- user-created list (always included)
 */

const axios  = require('axios');
const fs     = require('fs');
const path   = require('path');

const DRY_RUN        = process.argv.includes('--dry-run');
const DATA_DIR       = path.join(__dirname, '..', 'data');
const YOUTUBE_KEY    = process.env.YOUTUBE_API_KEY || '';
const TMDB_KEY       = process.env.TMDB_API_KEY    || '';

// ── Category definitions ──────────────────────────────────────────────────
// Maps BlogTV article categories to:
//   iptv_groups  : group-title strings used in iptv-org M3U files
//   yt_query     : YouTube search query
//   tmdb_genre_id: TMDB genre ID (https://api.themoviedb.org/3/genre/tv/list)
const CATEGORIES = {
  news:        { iptv_groups: ['News','General'],              yt_query: 'news live stream',           tmdb_genre_id: 10763 },
  technology:  { iptv_groups: ['Science / Technology'],       yt_query: 'technology documentary',     tmdb_genre_id: 10759 },
  science:     { iptv_groups: ['Science / Technology'],       yt_query: 'science documentary',        tmdb_genre_id: 99    },
  history:     { iptv_groups: ['Education'],                  yt_query: 'history documentary',        tmdb_genre_id: 99    },
  sports:      { iptv_groups: ['Sports'],                     yt_query: 'sports live stream',         tmdb_genre_id: 10759 },
  music:       { iptv_groups: ['Music'],                      yt_query: 'music live stream',          tmdb_genre_id: 10749 },
  entertainment:{ iptv_groups: ['Entertainment','Lifestyle'], yt_query: 'entertainment live stream',  tmdb_genre_id: 10751 },
  nature:      { iptv_groups: ['Science / Technology'],       yt_query: 'nature wildlife documentary',tmdb_genre_id: 99    },
  cooking:     { iptv_groups: ['Lifestyle'],                  yt_query: 'cooking show',               tmdb_genre_id: 10751 },
  travel:      { iptv_groups: ['Travel'],                     yt_query: 'travel documentary',         tmdb_genre_id: 10749 },
  politics:    { iptv_groups: ['News','General'],              yt_query: 'politics documentary',       tmdb_genre_id: 10763 },
  business:    { iptv_groups: ['Business'],                   yt_query: 'business finance documentary',tmdb_genre_id: 10763 },
  health:      { iptv_groups: ['Lifestyle'],                  yt_query: 'health wellness documentary',tmdb_genre_id: 10751 },
  kids:        { iptv_groups: ['Kids'],                       yt_query: 'kids educational show',      tmdb_genre_id: 10762 },
  animation:   { iptv_groups: ['Animation'],                  yt_query: 'animation show',             tmdb_genre_id: 16    },
  general:     { iptv_groups: ['General'],                    yt_query: 'documentary',                tmdb_genre_id: 99    },
};

// ── Helper: safe HTTP GET with timeout ───────────────────────────────────
async function get(url, params = {}, timeout = 15000) {
  try {
    const r = await axios.get(url, { params, timeout });
    return r.data;
  } catch (e) {
    console.warn(`  WARN: GET failed for ${url}: ${e.message}`);
    return null;
  }
}

// ── Source 1: iptv-org M3U ────────────────────────────────────────────────
// Uses the index.m3u endpoint which has ALL channels with group-title tags.
// We parse it in memory - no npm M3U parser needed, simple regex is fine.
async function fetchIptvOrg() {
  console.log('Fetching iptv-org...');
  const raw = await get(
    'https://iptv-org.github.io/iptv/index.m3u',
    {}, 30000
  );
  if (!raw) return {};

  const byGroup = {};
  const lines   = raw.split('\n');
  let current   = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('#EXTINF')) {
      // Extract group-title
      const groupMatch = trimmed.match(/group-title="([^"]*)"/i);
      const nameMatch  = trimmed.match(/,(.+)$/);
      const logoMatch  = trimmed.match(/tvg-logo="([^"]*)"/i);
      const idMatch    = trimmed.match(/tvg-id="([^"]*)"/i);
      current = {
        name:   nameMatch  ? nameMatch[1].trim()  : 'Unknown',
        logo:   logoMatch  ? logoMatch[1].trim()  : '',
        id:     idMatch    ? idMatch[1].trim()    : '',
        group:  groupMatch ? groupMatch[1].trim() : 'General',
        source: 'iptv-org',
        type:   'live',
      };
    } else if (trimmed.startsWith('http') && current) {
      current.url = trimmed;
      const g = current.group;
      if (!byGroup[g]) byGroup[g] = [];
      // Cap at 60 per group to keep file size manageable
      if (byGroup[g].length < 60) byGroup[g].push({ ...current });
      current = null;
    }
  }

  console.log(`  iptv-org: ${Object.keys(byGroup).length} groups, ${Object.values(byGroup).flat().length} channels`);
  return byGroup;
}

// ── Source 2: YouTube Data API v3 ────────────────────────────────────────
async function fetchYouTube() {
  if (!YOUTUBE_KEY) {
    console.log('  YouTube: no API key, skipping');
    return {};
  }
  console.log('Fetching YouTube...');
  const byCategory = {};

  for (const [cat, def] of Object.entries(CATEGORIES)) {
    const data = await get('https://www.googleapis.com/youtube/v3/search', {
      key:        YOUTUBE_KEY,
      q:          def.yt_query,
      part:       'snippet',
      type:       'video',
      maxResults: 8,
      videoCategoryId: 0,
      videoEmbeddable: true,
    });
    if (!data || !data.items) continue;

    byCategory[cat] = data.items
      .filter(i => i.id && i.id.videoId)
      .map(i => ({
        name:   i.snippet.title,
        url:    `https://www.youtube.com/watch?v=${i.id.videoId}`,
        logo:   i.snippet.thumbnails?.default?.url || '',
        desc:   i.snippet.description?.slice(0, 120) || '',
        source: 'youtube',
        type:   'vod',
      }));

    console.log(`  YouTube [${cat}]: ${byCategory[cat].length} videos`);
    // Respect quota - small delay between requests
    await new Promise(r => setTimeout(r, 250));
  }
  return byCategory;
}

// ── Source 3: TMDB ───────────────────────────────────────────────────────
async function fetchTMDB() {
  if (!TMDB_KEY) {
    console.log('  TMDB: no API key, skipping');
    return {};
  }
  console.log('Fetching TMDB...');
  const byCategory = {};
  const seen = new Set();

  for (const [cat, def] of Object.entries(CATEGORIES)) {
    if (seen.has(def.tmdb_genre_id)) continue;
    seen.add(def.tmdb_genre_id);

    const data = await get('https://api.themoviedb.org/3/discover/tv', {
      api_key:     TMDB_KEY,
      with_genres: def.tmdb_genre_id,
      sort_by:     'popularity.desc',
      page:        1,
    });
    if (!data || !data.results) continue;

    byCategory[cat] = data.results.slice(0, 8).map(r => ({
      name:   r.name || r.original_name,
      url:    `https://www.themoviedb.org/tv/${r.id}`,
      logo:   r.poster_path ? `https://image.tmdb.org/t/p/w92${r.poster_path}` : '',
      desc:   (r.overview || '').slice(0, 120),
      source: 'tmdb',
      type:   'info',  // TMDB links are info pages, not direct streams
    }));

    console.log(`  TMDB [${cat}]: ${byCategory[cat].length} shows`);
    await new Promise(r => setTimeout(r, 150));
  }
  return byCategory;
}

// ── Source 4 & 5: Custom + User JSON files ───────────────────────────────
function loadLocal(filename) {
  const p = path.join(DATA_DIR, filename);
  if (!fs.existsSync(p)) return {};
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    console.warn(`  WARN: could not parse ${filename}: ${e.message}`);
    return {};
  }
}

// ── Merge all sources into final channels.json ───────────────────────────
function mergeAll(iptvByGroup, ytByCategory, tmdbByCategory, custom, user) {
  const output = {
    updated:    new Date().toISOString(),
    version:    '1.0',
    categories: {},
  };

  for (const [cat, def] of Object.entries(CATEGORIES)) {
    const entries = [];

    // iptv-org: map group names to this category
    for (const group of def.iptv_groups) {
      const streams = iptvByGroup[group] || [];
      // Take up to 15 per group per category
      entries.push(...streams.slice(0, 15).map(s => ({ ...s, category: cat })));
    }

    // YouTube
    const ytItems = ytByCategory[cat] || [];
    entries.push(...ytItems.map(s => ({ ...s, category: cat })));

    // TMDB
    const tmdbItems = tmdbByCategory[cat] || [];
    entries.push(...tmdbItems.map(s => ({ ...s, category: cat })));

    // Custom channels for this category
    const customItems = custom[cat] || [];
    entries.push(...customItems.map(s => ({ ...s, category: cat, source: 'custom' })));

    // User channels for this category
    const userItems = user[cat] || [];
    entries.push(...userItems.map(s => ({ ...s, category: cat, source: 'user' })));

    // Deduplicate by URL
    const seen = new Set();
    const deduped = entries.filter(e => {
      if (!e.url || seen.has(e.url)) return false;
      seen.add(e.url);
      return true;
    });

    output.categories[cat] = deduped;
    console.log(`  [${cat}]: ${deduped.length} total channels`);
  }

  return output;
}

// ── Build url_history.json ────────────────────────────────────────────────
// A curated list of interesting article URLs shown in the Roku URL dialog.
// Extend this however you like - it's just a JSON array of strings.
function buildUrlHistory(existing) {
  const defaults = [
    'https://en.wikipedia.org/wiki/Television',
    'https://en.wikipedia.org/wiki/Internet',
    'https://en.wikipedia.org/wiki/Artificial_intelligence',
    'https://en.wikipedia.org/wiki/Space_exploration',
    'https://en.wikipedia.org/wiki/Climate_change',
    'https://en.wikipedia.org/wiki/History_of_the_Internet',
    'https://en.wikipedia.org/wiki/Streaming_media',
    'https://en.wikipedia.org/wiki/Quantum_computing',
    'https://en.wikipedia.org/wiki/Renewable_energy',
    'https://en.wikipedia.org/wiki/Cryptocurrency',
  ];

  // Merge with any existing history (from user interaction, stored separately)
  const existingUrls = Array.isArray(existing) ? existing : [];
  const merged = [...new Set([...defaults, ...existingUrls])];
  return merged.slice(0, 50);  // cap at 50
}

// ── Main ──────────────────────────────────────────────────────────────────
async function main() {
  console.log('=== BlogTV Channel Builder ===');
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE'}`);
  console.log(`YouTube API: ${YOUTUBE_KEY ? 'enabled' : 'disabled'}`);
  console.log(`TMDB API:    ${TMDB_KEY    ? 'enabled' : 'disabled'}`);
  console.log('');

  // Fetch all sources in parallel where possible
  const [iptvByGroup, ytByCategory, tmdbByCategory] = await Promise.all([
    fetchIptvOrg(),
    fetchYouTube(),
    fetchTMDB(),
  ]);

  const custom = loadLocal('custom_channels.json');
  const user   = loadLocal('user_channels.json');

  console.log('\nMerging...');
  const channels = mergeAll(iptvByGroup, ytByCategory, tmdbByCategory, custom, user);

  // Load existing url_history to preserve any user additions
  const existingHistory = loadLocal('url_history.json');
  const urlHistory = buildUrlHistory(
    Array.isArray(existingHistory) ? existingHistory : existingHistory.urls
  );

  const totalChannels = Object.values(channels.categories).reduce((a,b) => a + b.length, 0);
  console.log(`\nTotal channels: ${totalChannels}`);
  console.log(`URL history entries: ${urlHistory.length}`);

  if (!DRY_RUN) {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(
      path.join(DATA_DIR, 'channels.json'),
      JSON.stringify(channels, null, 2)
    );
    fs.writeFileSync(
      path.join(DATA_DIR, 'url_history.json'),
      JSON.stringify(urlHistory, null, 2)
    );
    console.log('\nWrote data/channels.json and data/url_history.json');
  } else {
    console.log('\n[DRY RUN] Would write channels.json and url_history.json');
    console.log('Sample output:', JSON.stringify(channels.categories.news?.slice(0,2), null, 2));
  }

  console.log('\nDone!');
}

main().catch(e => {
  console.error('Fatal:', e);
  process.exit(1);
});
