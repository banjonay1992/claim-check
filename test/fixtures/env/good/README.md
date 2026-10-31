# Sample Booking Service

## Configuration

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Connection string for the database |
| `API_TOKEN` | Token for the made-up partner API |
| `PORT` | Port to listen on |
| `CACHE_TTL` | Cache lifetime in seconds |
| `LOG_LEVEL` | Log verbosity |
| `FEATURE_FLAGS` | Comma-separated flags for the iOS client |
| `VITE_API_URL` | API base URL for the web client |
| `DENO_REGION` | Region for the edge worker |

Start it locally:

```sh
PORT=4000 npm start
```
