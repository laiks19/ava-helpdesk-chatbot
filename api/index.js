process.env.VERCEL = process.env.VERCEL || "1";

const { app } = await import("../src/server/server.js");

export default app;
