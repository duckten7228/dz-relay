// Dead Zone relay: tiny pub/sub over WebSocket (Cloudflare Worker + Durable Object).
// Speaks the same protocol the game's dzConnect() uses:
//   client -> {"a":"sub","t":topic} | {"a":"pub","t":topic,"m":string} | {"a":"ping"}
//   server -> {"a":"msg","t":topic,"m":string} | {"a":"pong"}
export class Relay {
  constructor(ctx, env) {
    this.ctx = ctx;
    // answered by the runtime itself, without waking the object
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('{"a":"ping"}', '{"a":"pong"}'));
  }
  async fetch(req) {
    if (req.headers.get('Upgrade') !== 'websocket') return new Response('Dead Zone relay OK');
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ t: [] });
    return new Response(null, { status: 101, webSocket: client });
  }
  webSocketMessage(ws, msg) {
    if (typeof msg !== 'string' || msg.length > 65536) return;
    let o;
    try { o = JSON.parse(msg); } catch { return; }
    if (!o || typeof o.t !== 'string' || !o.t.startsWith('dzmq1/') || o.t.length > 80) {
      if (o && o.a === 'ping') ws.send('{"a":"pong"}');
      return;
    }
    if (o.a === 'sub') {
      const at = ws.deserializeAttachment() || { t: [] };
      if (!at.t.includes(o.t) && at.t.length < 8) { at.t.push(o.t); ws.serializeAttachment(at); }
    } else if (o.a === 'pub') {
      const out = JSON.stringify({ a: 'msg', t: o.t, m: o.m });
      for (const s of this.ctx.getWebSockets()) {
        const at = s.deserializeAttachment();
        if (at && at.t.includes(o.t)) { try { s.send(out); } catch {} }
      }
    }
  }
  webSocketClose(ws, code) { try { ws.close(code && code !== 1005 && code !== 1006 ? code : 1000, 'bye'); } catch {} }
  webSocketError() {}
}
export default {
  async fetch(req, env) {
    // plain HTTP (health check, browsers) must NOT touch the Durable Object:
    // the object is created next to the FIRST request it receives, so it should be a player's WebSocket
    if (req.headers.get('Upgrade') !== 'websocket') return new Response('Dead Zone relay OK');
    // NEW name ('r3') so a fresh object is created, with a placement hint: 'eeur' = Eastern Europe (closest region to Turkey)
    const id = env.RELAY.idFromName('r3');
    return env.RELAY.get(id, { locationHint: 'eeur' }).fetch(req);
  },
};
