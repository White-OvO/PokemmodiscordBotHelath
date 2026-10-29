# Bot Monitor

A small status dashboard for Discord bots. Each bot appends a heartbeat and its events (commands, traffic, errors) to a JSON-lines file. This server reads those files and shows:

- **Status:** Up, Errors (an error in the last 10 minutes), Down (no heartbeat for 3 minutes), or No data
- **Uptime (24h)** and a 5-minute heartbeat timeline
- **Traffic per hour** by event type, and **errors per hour**
- **Recent errors** and memory and server counts

No dependencies. Requires Node 18 or newer.

## Run it

```bash
node server.js            # http://localhost:3939
PORT=4000 node server.js  # another port
METRICS_DIR=/path node server.js  # read metrics from another folder
```

By default it reads `~/bot-metrics/`. Each bot writes `<bot-name>.jsonl` there, one JSON object per line:

```json
{"t":1793250561926,"bot":"charm-log-bot","type":"heartbeat","guilds":1,"rssMb":115}
{"t":1793250561926,"bot":"charm-log-bot","type":"command","name":"log"}
{"t":1793250561926,"bot":"charm-log-bot","type":"error","source":"interaction","message":"..."}
```

To add a bot, add an entry to `BOTS` in `server.js` with its file name and the event types that count as traffic.

## Limits

- It only sees the machine it runs on. It can't tell when that machine is off.
- The status page loads Chart.js from a CDN, so the browser needs internet access.
- Metrics files are never trimmed, so they grow over time.
