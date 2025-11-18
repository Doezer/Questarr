# Deployment Guide

## Overview

GameRadarr can be deployed using the automated GitHub Actions workflow for on-demand deployment. The workflow builds a Docker image and pushes it to the GitHub Container Registry (GHCR).

## Manual Deployment (On-Demand)

### Triggering a Deployment

1. Go to the [Actions tab](../../actions) in the GitHub repository
2. Select "Deploy Web App" from the workflow list
3. Click "Run workflow"
4. Configure the deployment:
   - **Environment**: Choose `production` or `staging`
   - **Tag** (optional): Specify a custom Docker image tag, or leave empty for auto-generated tags
5. Click "Run workflow" to start the deployment

### Deployment Process

The workflow performs the following steps:

1. **Build**: Compiles the application using the Dockerfile
2. **Tag**: Creates multiple tags for the Docker image:
   - `{environment}-latest`: Always points to the latest build for the environment
   - `{environment}-sha-{short-sha}`: Short SHA version tag (first 7 characters of commit SHA)
   - Custom tag if specified
3. **Push**: Uploads the Docker image to GitHub Container Registry
4. **Summary**: Provides pull and run instructions in the workflow summary

### Accessing the Deployed Image

After deployment, the Docker image is available at:

```
ghcr.io/doezer/gameradarr:{tag}
```

#### Example: Pull and Run

```bash
# Pull the latest production image
docker pull ghcr.io/doezer/gameradarr:production-latest

# Run the container
docker run -d -p 5000:5000 \
  -e DATABASE_URL=postgresql://user:password@host:5432/gameradarr \
  -e IGDB_CLIENT_ID=your_igdb_client_id \
  -e IGDB_CLIENT_SECRET=your_igdb_client_secret \
  -e PORT=5000 \
  -e HOST=0.0.0.0 \
  ghcr.io/doezer/gameradarr:production-latest
```

### Using Docker Compose

You can update the `docker-compose.yml` to use the deployed image:

```yaml
services:
  app:
    image: ghcr.io/doezer/gameradarr:production-latest
    ports:
      - "${PORT}:${PORT}"
    environment:
      - NODE_ENV=production
      - PORT=${PORT}
      - DATABASE_URL=${DATABASE_URL}
      - IGDB_CLIENT_ID=${IGDB_CLIENT_ID}
      - IGDB_CLIENT_SECRET=${IGDB_CLIENT_SECRET}
      - HOST=0.0.0.0
    depends_on:
      - db
    restart: unless-stopped
  
  db:
    image: postgres:16-alpine
    # ... rest of the configuration
```

## Environment Variables

The following environment variables are required:

| Variable | Description | Required |
|----------|-------------|----------|
| `DATABASE_URL` | PostgreSQL connection string | Yes |
| `IGDB_CLIENT_ID` | IGDB API client ID | Yes |
| `IGDB_CLIENT_SECRET` | IGDB API client secret | Yes |
| `PORT` | Port to run the application on | No (default: 5000) |
| `HOST` | Host interface to bind to | No (default: localhost, use 0.0.0.0 for Docker) |
| `NODE_ENV` | Node environment | No (default: production) |

## Deployment Platforms

### Container Registry (GHCR)

The workflow automatically pushes images to GitHub Container Registry. Images are public by default.

To make images private:
1. Go to Package settings in GitHub
2. Change visibility to private

### Cloud Deployment Options

The deployed Docker image can be used with various cloud platforms:

#### Railway

```bash
railway up --image ghcr.io/doezer/gameradarr:production-latest
```

#### Render

Use the "Deploy from Docker Hub" option and specify:
```
ghcr.io/doezer/gameradarr:production-latest
```

#### AWS ECS / Azure Container Instances / Google Cloud Run

Use the image URL in your container configuration:
```
ghcr.io/doezer/gameradarr:production-latest
```

## Rollback

To rollback to a previous version:

1. Find the git SHA of the previous working deployment
2. Run the workflow again, or update your deployment to use:
   ```
   ghcr.io/doezer/gameradarr:production-{git-sha}
   ```

## Monitoring Deployments

- Check the Actions tab for deployment status
- View workflow summaries for pull/run commands
- Monitor container logs in your deployment environment

## Troubleshooting

### Authentication Issues

If you can't pull the image:

```bash
# Login to GHCR
echo $GITHUB_TOKEN | docker login ghcr.io -u USERNAME --password-stdin
```

### Image Not Found

Ensure the package visibility is set correctly in GitHub package settings.

### Build Failures

Check the workflow logs in the Actions tab for detailed error messages.

## Security Notes

- Docker images are stored in GitHub Container Registry using the automatically provided GITHUB_TOKEN
- Package visibility settings can be configured in GitHub package settings
- Never commit sensitive environment variables to the repository
- Configure production credentials (e.g., DATABASE_URL, IGDB_CLIENT_ID, etc.) in your deployment platform's environment variables, not in the repository or GitHub Secrets for this workflow
