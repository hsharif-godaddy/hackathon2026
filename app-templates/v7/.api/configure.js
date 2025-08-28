// src/api-server/configure.ts
import express from "express";
var errorHandler = (error, _, res, next) => {
  if (error instanceof Error) {
    res.status(403).json({ error: error.message });
  } else {
    next(error);
  }
};
var viteServerBefore = (server) => {
  server.use(express.json());
  server.use(express.urlencoded({ extended: true }));
};
var viteServerAfter = (server) => {
  server.use(errorHandler);
};
var serverBefore = (server) => {
  server.use(express.json());
  server.use(express.urlencoded({ extended: true }));
};
var serverAfter = (server) => {
  server.use(errorHandler);
};
var handlerBefore = () => {
};
var handlerAfter = () => {
};
var callbackBefore = (callback) => {
  return callback;
};
var serverListening = () => {
  console.log(`Server Running`);
};
var serverError = (_, error) => {
  console.log(`Server Error: `, error);
};
export {
  callbackBefore,
  handlerAfter,
  handlerBefore,
  serverAfter,
  serverBefore,
  serverError,
  serverListening,
  viteServerAfter,
  viteServerBefore
};
