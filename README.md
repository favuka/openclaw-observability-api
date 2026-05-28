# OpenClaw Observability API

API local read-only para alimentar o dashboard "OpenClaw Observability".

## Rodar

```bash
npm install
npm run dev
```

Servidor: `http://127.0.0.1:4317`

## Endpoints

- `GET /health`
- `GET /api/agents`
- `GET /api/runs`
- `GET /api/runs/:id`
- `GET /api/runs/:id/events`
- `GET /api/status-summary`

## Segurança

- Bind somente em `127.0.0.1`.
- CORS somente para `localhost` e `127.0.0.1`.
- Leitura apenas de `agents/*/sessions/sessions.json`, `*.trajectory.jsonl` e fontes cron.
- Transcripts brutos `agents/*/sessions/*.jsonl` não são lidos no MVP.
- Respostas passam por sanitização central antes de sair via HTTP.
