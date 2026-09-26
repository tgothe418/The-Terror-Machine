import express, { Express } from "express";
import path from "path";
import cors from "cors";
import rateLimit from "express-rate-limit";

import voiceRoutes from "./routes/voice";
import forgeRoutes from "./routes/forge";
import { turnRouter, turnStreamRouter } from "./routes/turn";
import chatRoutes from "./routes/chat";
import { aiConfigRouter } from "./routes/aiConfig";
import { mcpRouter } from "./mcp/mcpRoute";
import { REFERENCE_IMPORT_JSON_LIMIT } from "../src/lib/referenceImportPolicy";
import { payloadErrorHandler } from "./middleware/payloadErrorHandler";
import { apiErrorHandler } from "./middleware/apiErrorHandler";

export const API_DIAGNOSTIC_HEADER_NAME = "X-TTM-API";
export const API_DIAGNOSTIC_HEADER_VALUE = "express";

export interface CreateAppOptions {
  enableSpaFallback?: boolean;
}

export async function createApp(options: CreateAppOptions = { enableSpaFallback: true }): Promise<Express> {
  const app = express();

  app.set("trust proxy", 1);
  
  app.use(cors({ 
    origin: process.env.CORS_ORIGIN || ['http://localhost:5173', 'http://localhost:3000'],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']
  }));

  // Diagnostic marker middleware on all /api routes
  app.use("/api", (req, res, next) => {
    res.setHeader(API_DIAGNOSTIC_HEADER_NAME, API_DIAGNOSTIC_HEADER_VALUE);
    next();
  });

  // Route-specific parser for large reference knowledgebase uploads (up to 20 MiB decoded / 28 MB Base64 payload)
  app.use("/api/extract-blueprint", express.json({ limit: REFERENCE_IMPORT_JSON_LIMIT }));

  // General parsers retaining the default 5 MB limit for standard JSON endpoints
  app.use(express.json({ limit: "5mb" }));
  app.use(express.urlencoded({ extended: true, limit: "5mb" }));

  const isDev = process.env.NODE_ENV !== 'production';
  const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: isDev ? 10000 : 500,
    message: { error: 'Cognitive bandwidth exceeded. The anomaly is resting. Try again shortly.' },
    validate: { xForwardedForHeader: false },
    skip: (req) => {
      // Never rate-limit in development, or for loopback localhost callers
      if (isDev) return true;
      const ip = req.ip || req.socket.remoteAddress || '';
      if (ip === '127.0.0.1' || ip === '::1' || ip.includes('127.0.0.1')) {
        return true;
      }
      return false;
    }
  });

  // Fast diagnostic health endpoint
  app.get("/api/health", (req, res) => {
    res.json({
      status: "ok",
      service: "ttm-engine",
      runtime: "express",
      timestamp: Date.now(),
    });
  });

  // API configuration and local model discovery routes FIRST (unthrottled)
  app.use("/api/ai", aiConfigRouter);

  // TTM MCP Server endpoint (unthrottled, bypassing the standard /api rate limiter)
  app.use("/mcp", mcpRouter);

  // Throttled API endpoints
  app.use("/api/turn", apiLimiter, turnRouter);
  app.use("/api/turn-stream", apiLimiter, turnStreamRouter);
  app.use("/api", apiLimiter, voiceRoutes);
  app.use("/api", apiLimiter, forgeRoutes);
  app.use("/api", apiLimiter, chatRoutes);

  // Structured error handling for parser-level payload overages
  app.use(payloadErrorHandler);

  // Structured JSON error handling for uncaught errors under /api
  app.use("/api", apiErrorHandler);

  // Strict JSON 404 handler for all unmapped /api routes - prevents falling through to Vite SPA index.html!
  app.all(["/api", "/api/*"], (req, res) => {
    res.status(404).json({
      error: `API route not found: ${req.method} ${req.originalUrl || req.path}`,
      code: "API_ROUTE_NOT_FOUND",
    });
  });

  if (options.enableSpaFallback) {
    // Vite middleware for development
    if (process.env.NODE_ENV !== "production") {
      const { createServer: createViteServer } = await import("vite");
      const vite = await createViteServer({
        server: { middlewareMode: true },
        appType: "spa",
      });
      app.use(vite.middlewares);
    } else {
      const distPath = path.join(process.cwd(), "dist");
      app.use(express.static(distPath));
      app.get("*", (req, res) => {
        if (req.path.startsWith("/api")) {
          return res.status(404).json({
            error: `API route not found: ${req.method} ${req.originalUrl || req.path}`,
            code: "API_ROUTE_NOT_FOUND",
          });
        }
        res.sendFile(path.join(distPath, "index.html"));
      });
    }
  }

  return app;
}
