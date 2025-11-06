import express from "express";

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
    console.log(`Got ${signal}, exiting...`);
    process.exit(0);
  };

  ["SIGTERM", "SIGINT"].forEach((signal) => {
    process.on(signal, shutdown);
  });

  server.use(express.json());
  server.use(express.urlencoded({ extended: true }));
};

export const serverAfter = (server) => {
  const errorHandler = (err, req, res, next) => {
    if (err instanceof Error) {
      res.status(500).json({ error: err.message });
    } else {
      next(err);
    }
  };
  server.use(errorHandler);
};
