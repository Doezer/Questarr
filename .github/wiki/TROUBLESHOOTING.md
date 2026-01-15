### Common Issues

**Search is disabled**
- **Cause**: Missing IGDB credentials.
- **Solution**: 
  1. Check for a red "Configuration Required" banner at the top of the dashboard.
  2. If you see a "Setup Required" screen on the Discover or Calendar pages, click "Go to Settings".
  3. Ensure valid Client ID and Secret are entered in **Settings → IGDB API**.

**Download status not updating**
- **Cause**: Cron jobs not running or hash mismatch
- **Solution**:
  1. Check logs for "Checking download status" messages
  2. Verify torrent client connection in Settings

**Can't connect to database**
- **Cause**: PostgreSQL not running or wrong credentials
- **Solution**:
  1. Check if database container is running: `docker-compose ps`
  2. Verify you are using the default credentials (`postgres`/`questarr`) or that your `.env` matches the container settings.
  3. Check database logs: `docker-compose logs -f db`
  4. Verify the port is not already used

**Port already in use**
- **Cause**: Another service using port 5000
- **Solution**: Change PORT in your docker launch command, docker compose or `.env` to an available port (e.g., 5001)

**Docker build fails**
- **Cause**: Out of disk space or corrupted cache
- **Solution**: 
  ```bash
  docker system prune -a
  docker-compose build --no-cache
  ```

**Check health status:**
```bash
curl http://localhost:5000/api/health
```

### Getting Help

- **Issues**: [GitHub Issues](https://github.com/Doezer/Questarr/issues)
- **Discussions**: [GitHub Discussions](https://github.com/Doezer/Questarr/discussions)