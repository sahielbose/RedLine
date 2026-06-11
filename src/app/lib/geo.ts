/**
 * State geo helpers for the threat map. us-atlas (states-10m) ids are 2-digit
 * FIPS strings; we map those to USPS postal codes so the map can look up a
 * state's threat shading (keyed by postal, e.g. "ca") from the board data.
 */
export const FIPS_TO_POSTAL: Record<string, string> = {
  "01": "al", "02": "ak", "04": "az", "05": "ar", "06": "ca", "08": "co",
  "09": "ct", "10": "de", "11": "dc", "12": "fl", "13": "ga", "15": "hi",
  "16": "id", "17": "il", "18": "in", "19": "ia", "20": "ks", "21": "ky",
  "22": "la", "23": "me", "24": "md", "25": "ma", "26": "mi", "27": "mn",
  "28": "ms", "29": "mo", "30": "mt", "31": "ne", "32": "nv", "33": "nh",
  "34": "nj", "35": "nm", "36": "ny", "37": "nc", "38": "nd", "39": "oh",
  "40": "ok", "41": "or", "42": "pa", "44": "ri", "45": "sc", "46": "sd",
  "47": "tn", "48": "tx", "49": "ut", "50": "vt", "51": "va", "53": "wa",
  "54": "wv", "55": "wi", "56": "wy",
};

export const POSTAL_TO_NAME: Record<string, string> = {
  al: "Alabama", ak: "Alaska", az: "Arizona", ar: "Arkansas", ca: "California",
  co: "Colorado", ct: "Connecticut", de: "Delaware", dc: "District of Columbia",
  fl: "Florida", ga: "Georgia", hi: "Hawaii", id: "Idaho", il: "Illinois",
  in: "Indiana", ia: "Iowa", ks: "Kansas", ky: "Kentucky", la: "Louisiana",
  me: "Maine", md: "Maryland", ma: "Massachusetts", mi: "Michigan", mn: "Minnesota",
  ms: "Mississippi", mo: "Missouri", mt: "Montana", ne: "Nebraska", nv: "Nevada",
  nh: "New Hampshire", nj: "New Jersey", nm: "New Mexico", ny: "New York",
  nc: "North Carolina", nd: "North Dakota", oh: "Ohio", ok: "Oklahoma",
  or: "Oregon", pa: "Pennsylvania", ri: "Rhode Island", sc: "South Carolina",
  sd: "South Dakota", tn: "Tennessee", tx: "Texas", ut: "Utah", vt: "Vermont",
  va: "Virginia", wa: "Washington", wv: "West Virginia", wi: "Wisconsin", wy: "Wyoming",
};

/** Extract the postal code from a jurisdiction string ('us-ca' → 'ca'); null for federal 'us'. */
export function jurisdictionToPostal(jurisdiction: string): string | null {
  const m = /^us-([a-z]{2})$/i.exec(jurisdiction);
  return m ? m[1].toLowerCase() : null;
}
