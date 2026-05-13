import http from "node:http";

const port = Number(process.env.PORT ?? 4000);

const server = http.createServer((_req, res) => {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(
    JSON.stringify({
      ok: true,
      mode: "deprecated-node-backend",
      message: "This project now uses Supabase Edge Functions and Realtime for multiplayer backend services."
    })
  );
});

server.listen(port, "0.0.0.0", () => {
  // eslint-disable-next-line no-console
  console.log(`Placeholder server listening on 0.0.0.0:${port}`);
});
