from flask import Flask
from .main import configure_app

def create_app() -> Flask:
    app = Flask(__name__)
    configure_app(app)
    return app
