"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
Object.defineProperty(exports, "__esModule", { value: true });
// Load environment variables
require("dotenv/config");
var dotenv_1 = require("dotenv");
(0, dotenv_1.config)({ path: '.env.local' });
var http_1 = require("http");
var url_1 = require("url");
var next_1 = require("next");
var dev = process.env.NODE_ENV !== 'production';
var hostname = 'localhost';
var port = 3000;
// when using middleware `hostname` and `port` must be provided below
var app = (0, next_1.default)({ dev: dev, hostname: hostname, port: port });
var handle = app.getRequestHandler();
function startServer() {
    return __awaiter(this, void 0, void 0, function () {
        var setupWebSocketServer, httpServer, error_1;
        var _this = this;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    _a.trys.push([0, 3, , 4]);
                    return [4 /*yield*/, Promise.resolve().then(function () { return require('../lib/websocket-server.js'); })];
                case 1:
                    setupWebSocketServer = (_a.sent()).setupWebSocketServer;
                    return [4 /*yield*/, app.prepare()];
                case 2:
                    _a.sent();
                    httpServer = (0, http_1.createServer)(function (req, res) { return __awaiter(_this, void 0, void 0, function () {
                        var parsedUrl, err_1;
                        return __generator(this, function (_a) {
                            switch (_a.label) {
                                case 0:
                                    _a.trys.push([0, 2, , 3]);
                                    parsedUrl = (0, url_1.parse)(req.url, true);
                                    return [4 /*yield*/, handle(req, res, parsedUrl)];
                                case 1:
                                    _a.sent();
                                    return [3 /*break*/, 3];
                                case 2:
                                    err_1 = _a.sent();
                                    console.error('Error occurred handling', req.url, err_1);
                                    res.statusCode = 500;
                                    res.end('internal server error');
                                    return [3 /*break*/, 3];
                                case 3: return [2 /*return*/];
                            }
                        });
                    }); });
                    // Setup WebSocket server
                    setupWebSocketServer(httpServer);
                    httpServer
                        .once('error', function (err) {
                        console.error(err);
                        process.exit(1);
                    })
                        .listen(port, function () {
                        console.log("\uD83D\uDE80 Server ready on http://".concat(hostname, ":").concat(port));
                        console.log("\uD83D\uDCE1 WebSocket server ready for connections");
                        console.log("\uD83E\uDD16 AI Playground is running!");
                    });
                    return [3 /*break*/, 4];
                case 3:
                    error_1 = _a.sent();
                    console.error('Failed to start server:', error_1);
                    process.exit(1);
                    return [3 /*break*/, 4];
                case 4: return [2 /*return*/];
            }
        });
    });
}
startServer();
