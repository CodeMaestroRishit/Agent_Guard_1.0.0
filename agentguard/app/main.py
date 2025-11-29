import os
import threading
from flask import Flask, send_from_directory, jsonify, request
from .enforcement import EnforcementService
from .policy_store import PolicyStore, seed_demo_policy
from .tool_registry import ToolRegistry
from .auditor import AuditorService
from .utils import init_db_command, get_db
from .generator import run_policy_generator

# NOTE:
# create_app() returns a fully-configured Flask app WITHOUT starting
# background threads. This is test-friendly and allows pytest to create
# app contexts without side-effects. When running as __main__ we call
# start_background_services() and run() as before.
#
# configure_app() is provided for backwards compatibility with tests
# that create their own Flask app instance and need to register blueprints.

def create_app(config: dict | None = None) -> Flask:
    """
    Create and configure a Flask application instance.
    Does NOT start background threads (test-friendly).
    
    Args:
        config: Optional dict to update app.config
        
    Returns:
        Fully configured Flask app with all blueprints registered
    """
    init_db_command()  # ensure DB/tables exist
    app = Flask(__name__, static_folder=os.path.join(os.path.dirname(__file__), "static"))
    # allow config overrides for tests
    if config:
        app.config.update(config)

    # Register all components via configure_app
    configure_app(app)

    return app

def configure_app(flask_app: Flask) -> None:
    """
    Register AgentGuard blueprints and components onto an existing Flask app.
    This is a backwards-compatible function for tests that create their own app.
    
    Args:
        flask_app: Existing Flask application instance
    """
    # core components
    policy_store = PolicyStore()
    tool_registry = ToolRegistry()
    enforcement_service = EnforcementService(policy_store, tool_registry)
    auditor = AuditorService()

    # register blueprints
    flask_app.register_blueprint(enforcement_service.blueprint)
    flask_app.register_blueprint(policy_store.blueprint)
    flask_app.register_blueprint(tool_registry.blueprint)
    flask_app.register_blueprint(auditor.blueprint)

    # static file routes (safe defaults)
    @flask_app.route("/static/<path:filename>")
    def static_files(filename: str):
        return send_from_directory(flask_app.static_folder, filename)

    @flask_app.route("/")
    def root():
        return send_from_directory(flask_app.static_folder, "dashboard.html")

    # AI Policy Generator endpoint
    @flask_app.route("/generate_policy", methods=["POST"])
    def generate_policy_endpoint():
        data = request.get_json(silent=True) or {}
        nl = data.get("nl")
        model = data.get("model") or os.getenv("GEMINI_MODEL", "models/gemini-2.5-pro")

        if not nl or not isinstance(nl, str):
            return jsonify({"status": "error", "error": "missing_nl"}), 400

        ok, result = run_policy_generator(nl, model=model)
        if not ok:
            return jsonify({"status": "error", **result}), 500

        return jsonify({"status": "ok", "policy": result}), 200

    # expose components for testing introspection
    flask_app.extensions = getattr(flask_app, "extensions", {})
    flask_app.extensions["agentguard_components"] = {
        "policy_store": policy_store,
        "tool_registry": tool_registry,
        "enforcement_service": enforcement_service,
        "auditor": auditor,
    }

def start_background_services(app: Flask) -> None:
    """
    Start any background services (auditor thread, seeder).
    This is invoked only when running the module directly (not during tests).
    
    Args:
        app: Flask application instance
    """
    with app.app_context():
        # ensure DB and demo policies exist
        get_db()
        # Only seed if AUTO_SEED env var is set (or when running as main)
        # Tests should NOT trigger automatic seeding
        if os.getenv("AUTO_SEED", "true").lower() == "true":
            try:
                seed_demo_policy()
            except Exception:
                # seeding is best-effort in case tests use a separate DB
                pass
    auditor = app.extensions["agentguard_components"]["auditor"]
    threading.Thread(target=auditor.run, args=(app,), daemon=True).start()

if __name__ == "__main__":
    # Run app normally (for local dev)
    app = create_app()
    start_background_services(app)
    port = int(os.getenv("AGENTGUARD_PORT", os.getenv("PORT", 5073)))
    app.run(host="0.0.0.0", port=port)
