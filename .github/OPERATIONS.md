# Operational Guide

## Deployment

Refer to `DEPLOYMENT.md` for deployment instructions.

## Monitoring

*   Check logs for errors.
*   Monitor server health using the `/api/health` endpoint.
*   Monitor database connectivity using the `/api/ready` endpoint.

## Maintenance

*   Regularly update dependencies: `npm update` (be careful with breaking changes).
*   Run database migrations: `npm run db:migrate`.
*   Run tests regularly: `npm test`.

## Troubleshooting

*   **Database issues:** Check connection string and database status.
*   **Indexer issues:** Verify API keys and URLs.
*   **Downloader issues:** Verify connection settings and credentials.
