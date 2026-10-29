// Bot monitor: reads the metrics each bot writes to ~/bot-metrics and serves a
// status dashboard with uptime, traffic, and error charts.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const METRICS_DIR = process.env.METRICS_DIR || path.join(os.homedir(), 'bot-metrics');
const PORT = Number(process.env.PORT || 3939);
const PUBLIC_DIR = path.join(__dirname, 'public');

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const STALE_MS = 3 * MIN; // no heartbeat for this long means the bot is down
const RECENT_ERROR_MS = 10 * MIN; // an error this recent marks the bot as degraded

const BOTS = [
  {
    id: 'charm-log-bot',
    name: 'Charm Log Bot',
    file: 'charm-log-bot.jsonl',
    trafficTypes: ['charm', 'command', 'cooldown'],
  },
  {
    id: 'pokemmo-berry-bot',
    name: 'PokeMMO Berry Bot',
    file: 'pokemmo-berry-bot.jsonl',
    trafficTypes: ['plant', 'watered', 'alert'],
  },
];

// Returns the entries from the last day, or null if the bot has never written a file.
function readEntries(file, since) {
  let text;
  try {
    text = fs.readFileSync(path.join(METRICS_DIR, file), 'utf8');
  } catch {
    return null;
  }
  const entries = [];
  for (const line of text.split('\n')) {
    if (!line) continue;
    try {
      const entry = JSON.parse(line);
      if (entry.t >= since) entries.push(entry);
    } catch {
      // A partly written line is skipped; the next read picks it up whole.
    }
  }
  return entries;
}

function summarize(bot, now) {
  const since = now - DAY;
  const entries = readEntries(bot.file, since);
  if (entries === null) {
    return { id: bot.id, name: bot.name, status: 'no-data', hasData: false };
  }

  const heartbeats = entries.filter((e) => e.type === 'heartbeat');
  const lastHeartbeat = heartbeats.at(-1) ?? null;
  const lastSeen = lastHeartbeat ? lastHeartbeat.t : null;
  const isUp = lastSeen !== null && now - lastSeen <= STALE_MS;

  const errors = entries.filter((e) => e.type === 'error');
  const recentErrors = errors.filter((e) => now - e.t <= RECENT_ERROR_MS);

  let status = 'up';
  if (!isUp) status = 'down';
  else if (recentErrors.length > 0) status = 'degraded';

  // Uptime: 1-minute slots over the day that had at least one heartbeat.
  const minuteSlots = new Set(heartbeats.map((e) => Math.floor(e.t / MIN)));
  const uptime24h = minuteSlots.size / (DAY / MIN);

  // Timeline: 5-minute bars over the day. 1 = heartbeat seen, 0 = missed, null = before this bot's data started.
  const TIMELINE_STEP = 5 * MIN;
  const timelineStart = now - DAY;
  const firstSeen = entries.length ? entries[0].t : now;
  const timelineHeartbeat = new Array(DAY / TIMELINE_STEP).fill(0);
  for (const hb of heartbeats) {
    const i = Math.floor((hb.t - timelineStart) / TIMELINE_STEP);
    if (i >= 0 && i < timelineHeartbeat.length) timelineHeartbeat[i] = 1;
  }
  const timeline = timelineHeartbeat.map((value, i) => {
    const bucketEnd = timelineStart + (i + 1) * TIMELINE_STEP;
    return bucketEnd <= firstSeen ? null : value;
  });

  // Traffic and errors per hour over the last day (24 buckets).
  const HOURS = 24;
  const hourStart = Math.floor(now / HOUR) * HOUR - (HOURS - 1) * HOUR;
  const hourLabels = Array.from({ length: HOURS }, (_, i) =>
    new Date(hourStart + i * HOUR).toLocaleTimeString([], { hour: 'numeric' })
  );
  const traffic = Object.fromEntries(bot.trafficTypes.map((type) => [type, new Array(HOURS).fill(0)]));
  const errorsByHour = new Array(HOURS).fill(0);
  for (const e of entries) {
    const i = Math.floor((e.t - hourStart) / HOUR);
    if (i < 0 || i >= HOURS) continue;
    if (e.type === 'error') errorsByHour[i] += 1;
    else if (traffic[e.type]) traffic[e.type][i] += 1;
  }

  const trafficTotal = Object.values(traffic).reduce(
    (sum, series) => sum + series.reduce((a, b) => a + b, 0),
    0
  );

  return {
    id: bot.id,
    name: bot.name,
    hasData: true,
    status,
    lastSeen,
    guilds: lastHeartbeat?.guilds ?? null,
    memoryMb: lastHeartbeat?.rssMb ?? null,
    uptime24h,
    errors24h: errors.length,
    recentErrorCount: recentErrors.length,
    trafficTotal,
    timeline,
    hourLabels,
    traffic,
    errorsByHour,
    recentErrors: errors.slice(-20).reverse(),
  };
}

function buildStatus(now) {
  return { generatedAt: now, bots: BOTS.map((bot) => summarize(bot, now)) };
}

const server = http.createServer((req, res) => {
  if (req.url === '/api/status') {
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify(buildStatus(Date.now())));
    return;
  }

  if (req.url === '/' || req.url === '/index.html') {
    fs.readFile(path.join(PUBLIC_DIR, 'index.html'), (err, html) => {
      if (err) {
        res.writeHead(500).end('Dashboard file missing');
        return;
      }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(html);
    });
    return;
  }

  res.writeHead(404).end('Not found');
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Bot monitor running at http://localhost:${PORT} (reading ${METRICS_DIR})`);
});
