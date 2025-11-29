"""
WSGI entry point for AgentGuard Flask application.
This module provides the app instance that gunicorn will use.
"""
import os
from .main import create_app as _create_app, start_background_services

def create_app():
    """
    Create and configure the Flask application for production deployment.
    
    Background services (auditor, seeder) are started automatically
    unless SKIP_BACKGROUND_SERVICES is set (useful for tests).
    """
    app = _create_app()
    
    # Start background services unless explicitly disabled
    # (tests should set SKIP_BACKGROUND_SERVICES=true)
    if os.getenv("SKIP_BACKGROUND_SERVICES", "false").lower() != "true":
        start_background_services(app)
    
    return app

# Create the app instance for gunicorn
# Gunicorn will use this as: gunicorn app:app
app = create_app()
