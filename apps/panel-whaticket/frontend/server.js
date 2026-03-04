//simple express server to run frontend production build;
const express = require("express");
const path = require("path");
const app = express();
const buildDir = path.join(__dirname, "build");

// Serve static files (Vite build output is in ./build)
app.use(express.static(buildDir, { index: false }));

// SPA fallback ONLY for navigation requests. For asset/module requests,
// return 404 instead of index.html to avoid MIME type errors.
app.get("/*", function (req, res) {
	const accept = String(req.headers.accept || "");
	if (accept.includes("text/html")) {
		return res.sendFile(path.join(buildDir, "index.html"));
	}
	return res.status(404).end();
});
app.listen(3333);
