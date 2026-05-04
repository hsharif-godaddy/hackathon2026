### Health
- The app must respond to health checks within 30 seconds of startup.
- A slow or blocking startup (e.g. synchronous migrations, network calls before `listen`) will cause the supervisor to mark the deployment failed.
