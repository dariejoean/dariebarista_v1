import express from 'express';
import path from 'path';
import dotenv from 'dotenv';
import session from 'express-session';

// Load environment variables
dotenv.config();

const app = express();
const PORT = parseInt(process.env.PORT || '3000', 10);

// --- SECURITY: Validate required environment variables ---
if (process.env.NODE_ENV === 'production' && !process.env.SESSION_SECRET) {
      console.error('[Server] FATAL: SESSION_SECRET environment variable is not set in production!');
      process.exit(1);
}

// --- SECURITY: HTTP Security Headers Middleware ---
app.use((_req, res, next) => {
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('X-Frame-Options', 'DENY');
      res.setHeader('X-XSS-Protection', '1; mode=block');
      res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
      res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
      if (process.env.NODE_ENV === 'production') {
              res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
      }
      next();
});

// --- SECURITY: Simple in-memory rate limiter for /api routes ---
interface RateLimitRecord { count: number; resetAt: number; }
const rateLimitStore = new Map<string, RateLimitRecord>();
const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute window
const RATE_LIMIT_MAX = 60;           // max 60 requests per window

const rateLimiter = (req: express.Request, res: express.Response, next: express.NextFunction): void => {
      const ip = req.ip || req.socket.remoteAddress || 'unknown';
      const now = Date.now();
      const record = rateLimitStore.get(ip);

      if (!record || now > record.resetAt) {
              rateLimitStore.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
              return next();
      }
      record.count++;
      if (record.count > RATE_LIMIT_MAX) {
              res.status(429).json({ error: 'Too Many Requests. Please try again later.' });
              return;
      }
      next();
};

// Clean up expired rate-limit entries every 5 minutes
setInterval(() => {
      const now = Date.now();
      for (const [ip, record] of rateLimitStore.entries()) {
              if (now > record.resetAt) rateLimitStore.delete(ip);
      }
}, 5 * 60_000).unref();

// --- MIDDLEWARE ---
// Reduced body limit from 100mb to 10mb to prevent DoS abuse
app.use(express.json({ limit: '10mb' }));

// Session middleware - hardened configuration
app.use(session({
      secret: process.env.SESSION_SECRET || 'pharmabarista-dev-secret-change-in-production',
      resave: false,
      saveUninitialized: false, // SECURITY FIX: was true - prevents unnecessary session creation
      cookie: {
              secure: process.env.NODE_ENV === 'production', // Only enforce HTTPS in production
              sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
              httpOnly: true,
              maxAge: 24 * 60 * 60 * 1000 // 24 hours
      }
}));

// Apply rate limiter to API routes only
app.use('/api', rateLimiter);

// Health check endpoint
app.get('/api/ping', (_req, res) => {
      res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

async function startServer() {
      // Vite middleware for development
  if (process.env.NODE_ENV !== 'production') {
          try {
                    const { createServer: createViteServer } = await import('vite');
                    const vite = await createViteServer({
                                server: { middlewareMode: true },
                                appType: 'spa',
                    });
                    app.use(vite.middlewares);
          } catch (err) {
                    console.error('[Server] Failed to initialize Vite dev server:', err);
                    process.exit(1);
          }
  } else {
          const distPath = path.join(process.cwd(), 'dist');
          console.log(`[Server] Production mode. Serving static files from: ${distPath}`);

        // PERFORMANCE: Aggressive caching for hashed assets, no-cache for HTML
        app.use(express.static(distPath, {
                  maxAge: '1y',
                  etag: true,
                  lastModified: true,
                  setHeaders: (res, filePath) => {
                              if (filePath.endsWith('.html')) {
                                            res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
                                            res.setHeader('Pragma', 'no-cache');
                              }
                  }
        }));

        // Express 5 wildcard fix: use *all instead of (.*) or *
        app.get('*all', (_req, res) => {
                  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
                  res.sendFile(path.join(distPath, 'index.html'));
        });
  }

  const server = app.listen(PORT, '0.0.0.0', () => {
          console.log(`[Server] Started successfully on http://0.0.0.0:${PORT}`);
          console.log(`[Server] Environment: ${process.env.NODE_ENV || 'development'}`);
  });

  // --- STABILITY: Graceful Shutdown ---
  const shutdown = (signal: string) => {
          console.log(`\n[Server] ${signal} received. Shutting down gracefully...`);
          server.close(() => {
                    console.log('[Server] HTTP server closed. Exiting cleanly.');
                    process.exit(0);
          });
          // Force exit after 10s if graceful shutdown stalls
          setTimeout(() => {
                    console.error('[Server] Forced exit after graceful shutdown timeout.');
                    process.exit(1);
          }, 10_000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
      process.on('SIGINT',  () => shutdown('SIGINT'));
      process.on('uncaughtException', (err) => {
              console.error('[Server] Uncaught Exception:', err);
              shutdown('uncaughtException');
      });
      process.on('unhandledRejection', (reason) => {
              console.error('[Server] Unhandled Promise Rejection:', reason);
      });
}

startServer().catch(err => {
      console.error('[Server] Critical failure during startup:', err);
      process.exit(1);
});

export default app;
