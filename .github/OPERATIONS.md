# Operational Guidelines

## Deployment

-   **Docker**: The project is containerized. Use `docker-compose up -d` to start the services.
-   **Environment Variables**: Refer to `.env.example` for required environment variables.

## Maintenance

-   **Logs**: Check application logs for errors.
-   **Database**: Regular backups of the PostgreSQL database are recommended.
-   **Updates**: Keep dependencies up to date using `npm update`.

## Troubleshooting

-   **Common Issues**:
    -   *Database connection failed*: Check `DATABASE_URL` and ensure Postgres is running.
    -   *Build failed*: Check for type errors or missing dependencies.

## Monitoring

-   **Health Check**: `/api/health` returns `200 OK` if the server is responsive.
-   **Readiness Check**: `/api/ready` checks database and external service connectivity.
