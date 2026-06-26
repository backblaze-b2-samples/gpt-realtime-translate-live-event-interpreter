# Railway Deployment

Deploy both services (web + api) on Railway.

## Setup

1. Create a new Railway project
2. Add two services from the same repo:

### Web Service (Next.js)
- **Root Directory**: `apps/web`
- **Build Command**: `pnpm install && pnpm build`
- **Start Command**: `pnpm start`
- **Port**: `3000`

### API Service (FastAPI)
- **Root Directory**: `services/api`
- **Build Command**: `pip install -r requirements.txt`
- **Start Command**: `uvicorn main:app --host 0.0.0.0 --port $PORT`

## Environment Variables

Set these on the API service:

| Variable | Value |
|----------|-------|
| `B2_REGION` | Your B2 region (the path segment of the endpoint, e.g. `us-west-004`) |
| `B2_APPLICATION_KEY_ID` | Your B2 key ID |
| `B2_APPLICATION_KEY` | Your B2 key |
| `B2_BUCKET_NAME` | Your bucket name |
| `B2_PUBLIC_URL_BASE` | Optional public bucket or CDN base URL |
| `OPENAI_API_KEY` | Your OpenAI API key (required for the live-interpretation feature; the events explorer and `/files` work without it) |
| `OPENAI_REALTIME_MODEL` | Optional override — defaults to `gpt-realtime-translate` |
| `API_CORS_ORIGINS` | Your web service URL (e.g., `https://web-production-xxx.up.railway.app`) |

### Rolling B2 Env Rename

For deployments that still have legacy B2 variables, use an expand-contract
sequence:

1. Add `B2_APPLICATION_KEY_ID` and `B2_PUBLIC_URL_BASE` alongside existing
   legacy variables.
2. Deploy the compatible API code that accepts both old and new names.
3. Confirm the API no longer logs legacy-in-use warnings.
4. Remove `B2_KEY_ID`, `B2_PUBLIC_URL`, and `B2_ENDPOINT` after all old
   instances have drained.

Set this on the Web service:

| Variable | Value |
|----------|-------|
| `NEXT_PUBLIC_API_URL` | Your API service URL (e.g., `https://api-production-xxx.up.railway.app`) |
