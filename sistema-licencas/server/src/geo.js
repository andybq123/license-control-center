const cache = new Map();

function isPrivate(ip) {
  return !ip || /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|::1|fc|fd|fe80)/i.test(ip.replace(/^::ffff:/, ""));
}

// Descobre país/região/cidade pelo IP. Usa ip-api.com (gratuito para uso não comercial)
// ou outro serviço via GEOIP_URL, ex.: https://ipapi.co/{ip}/json/
export async function lookupGeo(rawIp) {
  const ip = (rawIp || "").replace(/^::ffff:/, "");
  if (isPrivate(ip)) return { country: "Rede local", region: "", city: "" };
  if (cache.has(ip)) return cache.get(ip);
  try {
    const tpl = process.env.GEOIP_URL || "http://ip-api.com/json/{ip}?fields=status,country,regionName,city";
    const res = await fetch(tpl.replace("{ip}", ip), { signal: AbortSignal.timeout(3000) });
    const j = await res.json();
    const geo = {
      country: j.country || j.country_name || "",
      region: j.regionName || j.region || "",
      city: j.city || "",
    };
    cache.set(ip, geo);
    return geo;
  } catch {
    return { country: "", region: "", city: "" };
  }
}
