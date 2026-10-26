const cache = new Map();
const EMPTY = { country: "", region: "", city: "", lat: null, lon: null };
export function coordinates(lat, lon) {
  if (lat == null || lon == null || lat === "" || lon === "") return null;
  const a = Number(lat), b = Number(lon);
  return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a) <= 90 && Math.abs(b) <= 180 ? { lat: a, lon: b } : null;
}

function isPrivate(ip) {
  return !ip || /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|::1|fc|fd|fe80)/i.test(ip.replace(/^::ffff:/, ""));
}

// Descobre país/região/cidade pelo IP. Usa ip-api.com (gratuito para uso não comercial)
// ou outro serviço via GEOIP_URL, ex.: https://ipapi.co/{ip}/json/
export async function lookupGeo(rawIp) {
  const ip = (rawIp || "").replace(/^::ffff:/, "");
  if (isPrivate(ip)) return { country: "Rede local", region: "", city: "" };
  const cached = cache.get(ip);
  if (cached && cached.until > Date.now()) return cached.geo;
  try {
    const tpl = process.env.GEOIP_URL || "http://ip-api.com/json/{ip}?fields=status,country,regionName,city,lat,lon";
    const res = await fetch(tpl.replace("{ip}", encodeURIComponent(ip)), { signal: AbortSignal.timeout(3000) });
    if (!res.ok) throw new Error("Geolocalização indisponível");
    const j = await res.json();
    if (j.status === "fail" || j.error) throw new Error("IP sem localização");
    const point = coordinates(j.lat ?? j.latitude, j.lon ?? j.longitude);
    const geo = {
      country: j.country || j.country_name || "",
      region: j.regionName || j.region || "",
      city: j.city || "",
      lat: point?.lat ?? null,
      lon: point?.lon ?? null,
    };
    cache.set(ip, { geo, until: Date.now() + (point ? 24 * 3600_000 : 60_000) });
    return geo;
  } catch {
    return { ...EMPTY };
  }
}
