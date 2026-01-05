import express from "express";
import { closeConnection } from "./db/client.ts";
import path from "node:path";

export const viteServerBefore = (server, viteServer) => {
  console.log("VITEJS SERVER");
  server.use(express.json());
  server.use(express.urlencoded({ extended: true }));
};

export const viteServerAfter = (server, viteServer) => {
  const errorHandler = (err, req, res, next) => {
    if (err instanceof Error) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    } else {
      next(err);
    }
  };
  server.use(errorHandler);
};

// ServerHook
export const serverBefore = (server) => {
  const shutdown = async (signal) => {
    console.log(`Got ${signal}, shutting down gracefully...`);

    try {
      // Close database connection pool before exiting
      await closeConnection();
      console.log("Database connections closed");
    } catch (error) {
      console.error("Error closing database connections:", error);
    }

    process.exit(0);
  };

  ["SIGTERM", "SIGINT"].forEach((signal) => {
    process.on(signal, shutdown);
  });

  server.use(express.json());
  server.use(express.urlencoded({ extended: true }));

  server.use(express.static("client"));
};

export const serverAfter = (server) => {
  // Add SPA fallback for client-side routing
  // This middleware serves index.html for any GET request that doesn't match
  // an API endpoint or static file, enabling React Router to handle the route
  server.use((req, res, next) => {
    // Only handle GET requests
    if (req.method !== 'GET') {
      return next();
    }

    // Skip if this is an API request
    if (req.path.startsWith('/api')) {
      return next();
    }

    // Skip if this is a static asset request (has file extension)
    if (path.extname(req.path)) {
      return next();
    }

    // For all other GET requests, serve index.html to support client-side routing
    res.sendFile(path.join(process.cwd(), 'client', 'index.html'));
  });

  const errorHandler = (err, req, res, next) => {
    if (err instanceof Error) {
      res.status(500).json({ error: err.message });
    } else {
      next(err);
    }
  };
  server.use(errorHandler);
};
