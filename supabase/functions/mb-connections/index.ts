// =====================================================================
// mb-connections: fills the connected-crate cache (docs/20_CONNECTED.md)
//
// POST { name: "A Tribe Called Quest" }  (signed-in users only)
//   → { status, artist, items }  — the same shape artist_connections()
//     (migration 023) returns, so the client treats both alike.
//
// The only place Miziki talks to MusicBrainz. Phones never do: they read
// the shared cache through artist_connections(), and call this only when
// that comes back 'missing' or 'stale'. What MusicBrainz receives: the
// artist name being looked up, and this function's User-Agent. Nothing
// about the user who asked.
//
// Off until Ken turns it on: with the MB_ENABLED secret unset (or anything
// but "true") every call returns { status: "disabled" } without touching
// MusicBrainz or the database. MB_CONTACT (an email or URL) goes in the
// User-Agent, which MusicBrainz requires of every client.
// =====================================================================
import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  normName, pickArtist, relatedFrom, urlsFrom, connectionRows,
} from "../_shared/mb-connections.js";

const MB = "https://musicbrainz.org/ws/2";
const FRESH_MS = 30 * 24 * 60 * 60 * 1000;
// MusicBrainz asks for no more than one request per second per client.
const GAP_MS = 1100;
const RELATED_CAP = 4;
const PER_ARTIST_CAP = 4;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let lastCall = 0;
async function mb(path: string, ua: string) {
  const wait = lastCall + GAP_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastCall = Date.now();
  const res = await fetch(MB + path + (path.includes("?") ? "&" : "?") + "fmt=json", {
    headers: { "User-Agent": ua, Accept: "application/json" },
  });
  if (res.status === 503) throw new Error("musicbrainz busy");
  if (!res.ok) throw new Error("musicbrainz " + res.status);
  return await res.json();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  if (Deno.env.get("MB_ENABLED") !== "true") return json({ status: "disabled", artist: null, items: [] });
  const contact = Deno.env.get("MB_CONTACT") || "";
  if (!contact) return json({ status: "disabled", artist: null, items: [] });
  const ua = `Miziki/1.0 ( ${contact} )`;

  const url = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  // Signed-in users only — a signed-out reader still sees whatever's
  // cached, but can't make the server spend MusicBrainz calls.
  const auth = req.headers.get("Authorization") || "";
  const asUser = createClient(url, anonKey, { global: { headers: { Authorization: auth } } });
  const { data: who } = await asUser.auth.getUser();
  if (!who || !who.user) return json({ error: "sign in required" }, 401);

  let name = "";
  try { name = String((await req.json()).name || "").slice(0, 200); } catch (_e) { /* bad body */ }
  const key = normName(name);
  if (!key) return json({ error: "name required" }, 400);

  const db = createClient(url, serviceKey, { auth: { persistSession: false } });

  // Someone else may have filled it a moment ago.
  const { data: cached } = await db.from("mb_artists").select("fetched_at").eq("name_norm", key).maybeSingle();
  if (cached && Date.now() - Date.parse(cached.fetched_at) < FRESH_MS) {
    const { data } = await db.rpc("artist_connections", { p_name_norm: key });
    return json(data);
  }

  try {
    const search = await mb(`/artist?query=${encodeURIComponent('artist:"' + name.replace(/"/g, "") + '"')}&limit=5`, ua);
    const hit = pickArtist(search, name);
    if (!hit) {
      await db.from("mb_artists").upsert({ name_norm: key, mbid: null, name: null, urls: [], fetched_at: new Date().toISOString() });
      return json({ status: "nomatch", artist: null, items: [] });
    }

    const main = await mb(`/artist/${hit.mbid}?inc=artist-rels+url-rels`, ua);
    const related = relatedFrom(main, RELATED_CAP);
    const rows = [];
    for (const via of related) {
      const viaLookup = await mb(`/artist/${via.mbid}?inc=release-groups+url-rels`, ua);
      rows.push(...connectionRows(hit.mbid, via, viaLookup, PER_ARTIST_CAP));
    }

    // Replace this artist's whole connection set, then stamp the artist row.
    const del = await db.from("artist_connections").delete().eq("artist_mbid", hit.mbid);
    if (del.error) throw del.error;
    if (rows.length) {
      const ins = await db.from("artist_connections").upsert(rows);
      if (ins.error) throw ins.error;
    }
    const up = await db.from("mb_artists").upsert({
      name_norm: key, mbid: hit.mbid, name: hit.name, urls: urlsFrom(main), fetched_at: new Date().toISOString(),
    });
    if (up.error) throw up.error;

    const { data } = await db.rpc("artist_connections", { p_name_norm: key });
    return json(data);
  } catch (e) {
    // MusicBrainz down or throttling: the client keeps whatever it had.
    // The detail goes to the function's own logs only, never back to the
    // caller (CodeQL: information exposure through an error message).
    console.error("mb-connections failed for", key, e);
    return json({ status: "error", artist: null, items: [] }, 502);
  }
});
