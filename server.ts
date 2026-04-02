import express from 'express';
import path from 'path';
import dotenv from 'dotenv';
import session from 'express-session';

// Load environment variables
dotenv.config();

const app = express();
const PORT = 3000;

// Middleware to parse JSON bodies
app.use(express.json({ limit: '100mb' }));

// Session middleware
app.use(session({
    secret: process.env.SESSION_SECRET || 'super-secret-key',
    resave: false,
    saveUninitialized: true,
    cookie: { secure: true, sameSite: 'none', httpOnly: true }
}));

// Health check endpoint
app.get('/api/ping', (req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
});

async function startServer() {
    // Vite middleware for development
    if (process.env.NODE_ENV !== "production") {
        const { createServer: createViteServer } = await import('vite');
        const vite = await createViteServer({
            server: { middlewareMode: true },
            appType: "spa",
        });
        app.use(vite.middlewares);
    } else {
        const distPath = path.join(process.cwd(), 'dist');
        console.log(`[Server] Production mode. Serving static files from: ${distPath}`);
        app.use(express.static(distPath));
        
        // Express 5 wildcard fix: use *all instead of (.*) or *
        app.get('*all', (req, res) => {
            res.sendFile(path.join(distPath, 'index.html'));
        });
    }

    // Always listen on the specified port in this environment
    app.listen(PORT, "0.0.0.0", () => {
        console.log(`[Server] Started successfully on http://0.0.0.0:${PORT}`);
        console.log(`[Server] Environment: ${process.env.NODE_ENV || 'development'}`);
    });
}

startServer().catch(err => {
    console.error("[Server] Critical failure during startup:", err);
    process.exit(1);
});

export default app;
