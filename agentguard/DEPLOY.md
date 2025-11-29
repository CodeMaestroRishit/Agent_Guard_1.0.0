# AgentGuard Deployment Guide

## Render Deployment

AgentGuard is configured for easy deployment on Render.com.

### Quick Deploy

1. **Connect your repository** to Render
2. **Create a new Web Service** and select your repository
3. **Use these settings:**

   **Build Command:**
   ```bash
   pip install -r requirements.txt
   ```

   **Start Command:**
   ```bash
   gunicorn app:app --bind 0.0.0.0:$PORT --workers 2 --threads 2 --timeout 120
   ```

4. **Set Environment Variables** in Render dashboard:
   - `ENFORCEMENT_HMAC_KEY` (required) - Your HMAC secret key
   - `GEMINI_API_KEY` (optional) - For AI Policy generation feature
   - `GEMINI_MODEL` (optional) - Default: `models/gemini-2.5-pro`
   - `DATABASE_FILE` (optional) - Default: `/opt/render/project/src/agentguard.db`
   - `AUTO_SEED` (optional) - Default: `true` (seeds demo policies on startup)

5. **Deploy!** Render will automatically:
   - Install dependencies
   - Start the Flask app with gunicorn
   - Start background services (auditor, seeder)

### Using render.yaml (Recommended)

If you use `render.yaml`, Render will automatically configure everything:

```yaml
services:
  - type: web
    name: agentguard
    env: python
    buildCommand: pip install -r requirements.txt
    startCommand: gunicorn app:app --bind 0.0.0.0:$PORT --workers 2 --threads 2 --timeout 120
```

Just connect your repo and Render will read the `render.yaml` file.

### Using Procfile

Alternatively, you can use the `Procfile`:

```
web: gunicorn app:app --bind 0.0.0.0:$PORT --workers 2 --threads 2 --timeout 120
```

### Environment Variables

**Required:**
- `ENFORCEMENT_HMAC_KEY` - Secret key for HMAC signature validation

**Optional:**
- `GEMINI_API_KEY` - For AI Policy generation (leave empty if not using)
- `GEMINI_MODEL` - Gemini model to use (default: `models/gemini-2.5-pro`)
- `DATABASE_FILE` - Path to SQLite database file
- `AUTO_SEED` - Set to `"true"` to seed demo policies on startup
- `PORT` - Automatically set by Render (don't override)

### Gunicorn Configuration

The start command uses:
- `--workers 2` - 2 worker processes
- `--threads 2` - 2 threads per worker
- `--timeout 120` - 120 second timeout for requests

Adjust these based on your traffic needs.

### Testing Locally with Gunicorn

To test the production setup locally:

```bash
# Install gunicorn
pip install gunicorn

# Set environment variables
export ENFORCEMENT_HMAC_KEY="your-secret-key"
export PORT=5073

# Run with gunicorn
gunicorn app:app --bind 0.0.0.0:5073 --workers 2 --threads 2 --timeout 120
```

### Background Services

The WSGI entry point (`app/__init__.py`) automatically starts:
- **Auditor Service**: Background thread for processing audit logs
- **Policy Seeder**: Seeds demo policies if `AUTO_SEED=true`

These start automatically in production. To disable (e.g., for tests), set:
```bash
export SKIP_BACKGROUND_SERVICES=true
```

### Troubleshooting

**Issue: App won't start**
- Check that `ENFORCEMENT_HMAC_KEY` is set
- Verify `gunicorn` is in `requirements.txt`
- Check Render logs for errors

**Issue: Database errors**
- Ensure `DATABASE_FILE` path is writable
- Check file permissions on Render

**Issue: Background services not running**
- Check that `SKIP_BACKGROUND_SERVICES` is not set to `"true"`
- Review application logs for thread startup errors

### Production Checklist

- [ ] `ENFORCEMENT_HMAC_KEY` is set and secure
- [ ] `GEMINI_API_KEY` is set (if using AI Policy feature)
- [ ] Database file path is writable
- [ ] Gunicorn workers/threads are appropriate for your load
- [ ] Static files are being served correctly
- [ ] Background services are running (check logs)

