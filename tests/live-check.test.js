// Tes untuk scripts/live-check.js. Jalankan dari root repo: node --test
// Tanpa jaringan: DNS dan https.request diganti tiruan.

const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("events");
const { Readable } = require("stream");

const lc = require("../scripts/live-check.js");

const PUBLIC_IP = [{ address: "93.184.215.14", family: 4 }];

// routes: "host/path" → { status, location, body: number of bytes | "infinite", hang }
function mockNetwork(routes, dnsTable = {}) {
  const calls = [];
  const resolve = async (host) => {
    if (host in dnsTable) {
      const v = dnsTable[host];
      if (v instanceof Error) throw v;
      return v;
    }
    return PUBLIC_IP;
  };
  const request = (options, onResponse) => {
    const req = new EventEmitter();
    const key = `${options.hostname}${options.path}`;
    const call = { options, key, destroyed: false, bytesSent: 0 };
    calls.push(call);
    req.destroy = () => {
      call.destroyed = true;
    };
    req.end = () => {
      const route = routes[key];
      if (!route) {
        setImmediate(() => req.emit("error", Object.assign(new Error("nope"), { code: "ECONNREFUSED" })));
        return;
      }
      if (route.hang) return; // never answers
      let remaining = route.body === "infinite" ? Infinity : route.body || 0;
      const res = new Readable({
        read() {
          if (remaining <= 0) {
            this.push(null);
            return;
          }
          const n = Math.min(16 * 1024, remaining);
          remaining -= n;
          call.bytesSent += n;
          this.push(Buffer.alloc(n));
        },
      });
      res.statusCode = route.status;
      res.headers = route.location ? { location: route.location } : {};
      const origDestroy = res.destroy.bind(res);
      res.destroy = (...args) => {
        call.destroyed = true;
        return origDestroy(...args);
      };
      setImmediate(() => onResponse(res));
    };
    return req;
  };
  return { resolve, request, calls };
}

test("plain http is rejected without any request", async () => {
  const net = mockNetwork({});
  const r = await lc.checkUrl("http://example.com/", net);
  assert.equal(r.ok, false);
  assert.equal(r.reason, "not_https");
  assert.equal(net.calls.length, 0);
});

test("ports other than 443 are rejected", async () => {
  const net = mockNetwork({});
  assert.equal((await lc.checkUrl("https://example.com:8443/", net)).reason, "port_not_allowed");
  assert.equal((await lc.checkUrl("https://example.com:443/", { ...net, request: mockNetwork({ "example.com/": { status: 200 } }).request })).ok, true);
});

test("credentials in the URL are rejected", async () => {
  const r = await lc.checkUrl("https://user:pw@example.com/", mockNetwork({}));
  assert.equal(r.reason, "credentials_in_url");
});

test("private, loopback, link-local and metadata addresses are blocked", () => {
  for (const ip of [
    "127.0.0.1", "127.255.0.9", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1",
    "169.254.169.254", "0.0.0.0", "100.64.0.1", "::1", "::", "fc00::1", "fd00:ec2::254",
    "fe80::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:10.0.0.1", "not-an-ip",
  ]) {
    assert.equal(lc.isBlockedAddress(ip), true, ip);
  }
  for (const ip of ["93.184.215.14", "8.8.8.8", "172.32.0.1", "2606:2800:21f:cb07:6820:80da:af6b:8b2c"]) {
    assert.equal(lc.isBlockedAddress(ip), false, ip);
  }
});

test("a host that resolves to a private address is rejected", async () => {
  const net = mockNetwork({}, { "internal.example": [{ address: "10.0.0.5", family: 4 }] });
  const r = await lc.checkUrl("https://internal.example/", net);
  assert.equal(r.reason, "blocked_address");
  assert.equal(net.calls.length, 0);
});

test("a host with one public and one private address is rejected", async () => {
  const net = mockNetwork({}, {
    "mixed.example": [{ address: "93.184.215.14", family: 4 }, { address: "::1", family: 6 }],
  });
  assert.equal((await lc.checkUrl("https://mixed.example/", net)).reason, "blocked_address");
});

test("DNS failure counts as a failure", async () => {
  const net = mockNetwork({}, { "tidak-ada-domain-ini.example": Object.assign(new Error("x"), { code: "ENOTFOUND" }) });
  const r = await lc.checkUrl("https://tidak-ada-domain-ini.example/", net);
  assert.deepEqual([r.ok, r.reason], [false, "dns_failed"]);
});

test("2xx and 3xx (without Location) count as responding; 4xx/5xx do not", async () => {
  const net = mockNetwork({
    "a.example/": { status: 200 },
    "b.example/": { status: 304 },
    "c.example/": { status: 404 },
    "d.example/": { status: 503 },
  });
  assert.equal((await lc.checkUrl("https://a.example/", net)).ok, true);
  assert.equal((await lc.checkUrl("https://b.example/", net)).ok, true);
  assert.equal((await lc.checkUrl("https://c.example/", net)).ok, false);
  assert.equal((await lc.checkUrl("https://d.example/", net)).reason, "http_503");
});

test("request uses GET, the fixed User-Agent, no cookie/authorization, and is pinned to the checked address", async () => {
  const net = mockNetwork({ "example.com/path?token=secret": { status: 200 } });
  await lc.checkUrl("https://example.com/path?token=secret", net);
  const { options } = net.calls[0];
  assert.equal(options.method, "GET");
  assert.equal(options.port, 443);
  assert.equal(options.headers["User-Agent"], "AgrarisLiveCheck/1.0 (+https://agraris.xyz)");
  const headerNames = Object.keys(options.headers).map((h) => h.toLowerCase());
  assert.ok(!headerNames.includes("cookie"));
  assert.ok(!headerNames.includes("authorization"));
  assert.equal(options.auth, undefined);
  await new Promise((done) =>
    options.lookup("example.com", {}, (err, address) => {
      assert.equal(address, "93.184.215.14");
      done();
    })
  );
  await new Promise((done) =>
    options.lookup("example.com", { all: true }, (err, list) => {
      assert.deepEqual(list, [{ address: "93.184.215.14", family: 4 }]);
      done();
    })
  );
});

test("redirects are followed and every hop is checked", async () => {
  const net = mockNetwork({
    "a.example/": { status: 301, location: "https://b.example/next" },
    "b.example/next": { status: 302, location: "/final" },
    "b.example/final": { status: 200 },
  });
  const r = await lc.checkUrl("https://a.example/", net);
  assert.equal(r.ok, true);
  assert.equal(net.calls.length, 3);
});

test("redirect to a private host is rejected", async () => {
  const net = mockNetwork(
    { "a.example/": { status: 302, location: "https://metadata.internal/latest" } },
    { "metadata.internal": [{ address: "169.254.169.254", family: 4 }] }
  );
  const r = await lc.checkUrl("https://a.example/", net);
  assert.equal(r.reason, "blocked_address");
  assert.equal(net.calls.length, 1);
});

test("redirect to http or a non-443 port is rejected", async () => {
  const net = mockNetwork({
    "a.example/": { status: 302, location: "http://a.example/" },
    "b.example/": { status: 302, location: "https://b.example:8080/" },
  });
  assert.equal((await lc.checkUrl("https://a.example/", net)).reason, "not_https");
  assert.equal((await lc.checkUrl("https://b.example/", net)).reason, "port_not_allowed");
});

test("more than 3 redirects is a failure", async () => {
  const net = mockNetwork({
    "r.example/0": { status: 302, location: "/1" },
    "r.example/1": { status: 302, location: "/2" },
    "r.example/2": { status: 302, location: "/3" },
    "r.example/3": { status: 302, location: "/4" },
    "r.example/4": { status: 200 },
  });
  const r = await lc.checkUrl("https://r.example/0", net);
  assert.equal(r.reason, "too_many_redirects");
  assert.equal(net.calls.length, 4);

  // Exactly 3 redirects is fine.
  const ok = await lc.checkUrl("https://r.example/1", net);
  assert.equal(ok.ok, true);
});

test("a server that never answers times out", async () => {
  const net = mockNetwork({ "slow.example/": { hang: true } });
  const started = Date.now();
  const r = await lc.checkUrl("https://slow.example/", { ...net, timeoutMs: 100 });
  assert.equal(r.reason, "timeout");
  assert.ok(Date.now() - started < 2000);
  assert.equal(net.calls[0].destroyed, true);
});

test("slow DNS also times out", async () => {
  const r = await lc.checkUrl("https://slowdns.example/", {
    resolve: () => new Promise(() => {}),
    request: () => assert.fail("must not connect"),
    timeoutMs: 100,
  });
  assert.equal(r.reason, "timeout");
});

test("the default timeout is 8 seconds", () => {
  assert.equal(lc.TIMEOUT_MS, 8000);
});

test("a huge body is cut off after about 64 KB", async () => {
  const net = mockNetwork({ "big.example/": { status: 200, body: "infinite" } });
  const r = await lc.checkUrl("https://big.example/", net);
  assert.equal(r.ok, true);
  assert.equal(net.calls[0].destroyed, true);
  assert.ok(net.calls[0].bytesSent <= lc.MAX_BODY_BYTES + 64 * 1024, `read ${net.calls[0].bytesSent} bytes`);
});

test("result never contains the response body", async () => {
  const net = mockNetwork({ "a.example/": { status: 200, body: 1000 } });
  const r = await lc.checkUrl("https://a.example/", net);
  assert.deepEqual(Object.keys(r).sort(), ["host", "ok", "reason", "status"]);
});

test("three failures in a row are needed before 'down'", () => {
  let row = { live_status: null, live_fail_count: 0 };
  row = lc.nextState(row, false);
  assert.deepEqual([row.live_status, row.live_fail_count], [null, 1]);
  row = lc.nextState(row, false);
  assert.deepEqual([row.live_status, row.live_fail_count], [null, 2]);
  row = lc.nextState(row, false);
  assert.deepEqual([row.live_status, row.live_fail_count], ["down", 3]);
  row = lc.nextState(row, false);
  assert.deepEqual([row.live_status, row.live_fail_count], ["down", 4]);
});

test("an 'up' listing stays 'up' for the first two failures", () => {
  let row = { live_status: "up", live_fail_count: 0 };
  row = lc.nextState(row, false);
  row = lc.nextState(row, false);
  assert.equal(row.live_status, "up");
  row = lc.nextState(row, false);
  assert.equal(row.live_status, "down");
});

test("one success resets the count and sets 'up'", () => {
  const row = lc.nextState({ live_status: "down", live_fail_count: 7 }, true, new Date("2026-10-16T00:00:00Z"));
  assert.deepEqual(row, { live_status: "up", live_fail_count: 0, live_checked_at: "2026-10-16T00:00:00.000Z" });
});

test("live_checked_at is always updated", () => {
  const now = new Date("2026-10-16T06:00:00Z");
  assert.equal(lc.nextState({ live_fail_count: 0 }, false, now).live_checked_at, now.toISOString());
  assert.equal(lc.nextState({ live_fail_count: 0 }, true, now).live_checked_at, now.toISOString());
});

test("run(): saves every row, keeps concurrency small, logs only the host", async () => {
  const rows = Array.from({ length: 12 }, (_, i) => ({
    id: `id-${i}`,
    demo_url: `https://host${i}.example/secret-path?token=abc${i}`,
    live_status: null,
    live_fail_count: 0,
  }));
  let active = 0;
  let peak = 0;
  const saved = [];
  const logs = [];
  await lc.run({
    fetchRows: async () => rows,
    updateRow: async (row, patch) => saved.push([row.id, patch]),
    check: async (url) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      return { ok: true, reason: "http_200", status: 200, host: new URL(url).hostname };
    },
    log: (line) => logs.push(line),
  });
  assert.equal(saved.length, 12);
  assert.ok(peak <= lc.CONCURRENCY, `peak concurrency ${peak}`);
  const all = logs.join("\n");
  assert.ok(!all.includes("token"), "query string must not be logged");
  assert.ok(!all.includes("secret-path"), "path must not be logged");
  assert.ok(all.includes("host3.example"));
});

test("run limits: at most 5 at once and 100 per run", () => {
  assert.equal(lc.CONCURRENCY, 5);
  assert.equal(lc.MAX_LISTINGS_PER_RUN, 100);
});
