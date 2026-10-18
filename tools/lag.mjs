// A bad network for a joined @colyseus/sdk room in Node, for tools/net-feel.mjs and
// tools/bot-clients.mjs: the same order-keeping delay and jitter that @colyseus/sdk/debug's
// latency simulator adds in the browser, plus loss as it looks over a WebSocket (TCP resends a
// lost segment, so a message comes `stall` ms late and everything behind it waits).
//
//   lag(room, { rtt: 150, jitter: 30, loss: 0.01 });   // after join; both directions
//
// `rtt` and `jitter` are round trips, split evenly between the two directions. Every message,
// state patch and input is delayed; nothing is reordered or dropped (each direction is one
// queue with one timer: timers round to whole milliseconds and could swap two messages, and a
// swapped state patch doesn't decode).
export function lag(room, { rtt = 0, jitter = 0, loss = 0, stall = 200, rand = Math.random } = {}) {
  if (!rtt && !jitter && !loss) return;
  const half = rtt / 2, jit = jitter / 2;
  let left = false;
  room.onLeave(() => { left = true; });
  // Messages wait in order; each leaves at max(its own time, the one before it).
  const queue = (deliver) => {
    const q = [];
    let last = 0, timer = null;
    const run = () => {
      timer = null;
      const now = performance.now();
      while (q.length && q[0].at <= now + 0.25) deliver(q.shift().data);
      if (q.length) timer = setTimeout(run, Math.max(0, q[0].at - now));
    };
    return (data) => {
      const now = performance.now();
      const j = jit ? (rand() * 2 - 1) * jit : 0;
      last = Math.max(now + half + j + (loss && rand() < loss ? stall : 0), last);
      q.push({ at: last, data });
      if (!timer) timer = setTimeout(run, Math.max(0, q[0].at - now));
    };
  };
  const conn = room.connection, events = conn.events;
  const onmessage = events.onmessage, onclose = events.onclose;
  // A close comes in behind whatever is still on its way.
  const inbound = queue((m) => { if (m.close) onclose?.(m.close); else if (!left) onmessage({ data: m }); });
  events.onmessage = (ev) => inbound(ev.data);
  events.onclose = (ev) => inbound({ close: ev });
  const send = conn.send.bind(conn);
  // The SDK reuses its send buffers, so each message is copied before it waits.
  const outbound = queue((data) => { if (conn.isOpen) send(data); });
  conn.send = (data) => outbound(Uint8Array.from(data));
}
