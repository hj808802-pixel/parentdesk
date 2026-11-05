// Country packs: the defaults that change how a notice is read (date order, currency,
// time zone, when the school year starts) and the name of the knowledge note the
// extractor gets (knowledge/countries/<pack>.md). The UI never branches on country.

export type DateOrder = "MDY" | "DMY" | "YMD";

export type Country = {
  code: string; // ISO 3166-1 alpha-2, "XX" for "other"
  name: string; // English name; the dictionaries translate the label
  dateOrder: DateOrder;
  currency: string; // ISO 4217
  timezone: string; // a sensible default; the family can change it
  weekStart: 0 | 1; // 0 Sunday, 1 Monday
  schoolYearStart: number; // month 1-12 when the school year usually begins
  pack: string | null; // knowledge note file name, null = generic only
};

export const COUNTRIES: Country[] = [
  { code: "US", name: "United States", dateOrder: "MDY", currency: "USD", timezone: "America/New_York", weekStart: 0, schoolYearStart: 8, pack: "us" },
  { code: "CA", name: "Canada", dateOrder: "MDY", currency: "CAD", timezone: "America/Toronto", weekStart: 0, schoolYearStart: 9, pack: "ca" },
  { code: "GB", name: "United Kingdom", dateOrder: "DMY", currency: "GBP", timezone: "Europe/London", weekStart: 1, schoolYearStart: 9, pack: "gb" },
  { code: "IE", name: "Ireland", dateOrder: "DMY", currency: "EUR", timezone: "Europe/Dublin", weekStart: 1, schoolYearStart: 9, pack: "gb" },
  { code: "AU", name: "Australia", dateOrder: "DMY", currency: "AUD", timezone: "Australia/Sydney", weekStart: 1, schoolYearStart: 1, pack: "au" },
  { code: "NZ", name: "New Zealand", dateOrder: "DMY", currency: "NZD", timezone: "Pacific/Auckland", weekStart: 1, schoolYearStart: 2, pack: "au" },
  { code: "KR", name: "South Korea", dateOrder: "YMD", currency: "KRW", timezone: "Asia/Seoul", weekStart: 0, schoolYearStart: 3, pack: "kr" },
  { code: "JP", name: "Japan", dateOrder: "YMD", currency: "JPY", timezone: "Asia/Tokyo", weekStart: 0, schoolYearStart: 4, pack: "jp" },
  { code: "CN", name: "China", dateOrder: "YMD", currency: "CNY", timezone: "Asia/Shanghai", weekStart: 1, schoolYearStart: 9, pack: "cn" },
  { code: "TW", name: "Taiwan", dateOrder: "YMD", currency: "TWD", timezone: "Asia/Taipei", weekStart: 1, schoolYearStart: 9, pack: "tw" },
  { code: "HK", name: "Hong Kong", dateOrder: "DMY", currency: "HKD", timezone: "Asia/Hong_Kong", weekStart: 1, schoolYearStart: 9, pack: "hk" },
  { code: "SG", name: "Singapore", dateOrder: "DMY", currency: "SGD", timezone: "Asia/Singapore", weekStart: 1, schoolYearStart: 1, pack: "sg" },
  { code: "PH", name: "Philippines", dateOrder: "MDY", currency: "PHP", timezone: "Asia/Manila", weekStart: 0, schoolYearStart: 8, pack: "ph" },
  { code: "VN", name: "Vietnam", dateOrder: "DMY", currency: "VND", timezone: "Asia/Ho_Chi_Minh", weekStart: 1, schoolYearStart: 9, pack: "vn" },
  { code: "IN", name: "India", dateOrder: "DMY", currency: "INR", timezone: "Asia/Kolkata", weekStart: 1, schoolYearStart: 4, pack: "in" },
  { code: "ID", name: "Indonesia", dateOrder: "DMY", currency: "IDR", timezone: "Asia/Jakarta", weekStart: 1, schoolYearStart: 7, pack: "id" },
  { code: "TH", name: "Thailand", dateOrder: "DMY", currency: "THB", timezone: "Asia/Bangkok", weekStart: 1, schoolYearStart: 5, pack: null },
  { code: "MY", name: "Malaysia", dateOrder: "DMY", currency: "MYR", timezone: "Asia/Kuala_Lumpur", weekStart: 1, schoolYearStart: 3, pack: null },
  { code: "AE", name: "United Arab Emirates", dateOrder: "DMY", currency: "AED", timezone: "Asia/Dubai", weekStart: 1, schoolYearStart: 9, pack: "ae" },
  { code: "DE", name: "Germany", dateOrder: "DMY", currency: "EUR", timezone: "Europe/Berlin", weekStart: 1, schoolYearStart: 8, pack: "de" },
  { code: "AT", name: "Austria", dateOrder: "DMY", currency: "EUR", timezone: "Europe/Vienna", weekStart: 1, schoolYearStart: 9, pack: "de" },
  { code: "CH", name: "Switzerland", dateOrder: "DMY", currency: "CHF", timezone: "Europe/Zurich", weekStart: 1, schoolYearStart: 8, pack: "de" },
  { code: "FR", name: "France", dateOrder: "DMY", currency: "EUR", timezone: "Europe/Paris", weekStart: 1, schoolYearStart: 9, pack: "fr" },
  { code: "BE", name: "Belgium", dateOrder: "DMY", currency: "EUR", timezone: "Europe/Brussels", weekStart: 1, schoolYearStart: 9, pack: "fr" },
  { code: "ES", name: "Spain", dateOrder: "DMY", currency: "EUR", timezone: "Europe/Madrid", weekStart: 1, schoolYearStart: 9, pack: "es" },
  { code: "IT", name: "Italy", dateOrder: "DMY", currency: "EUR", timezone: "Europe/Rome", weekStart: 1, schoolYearStart: 9, pack: "it" },
  { code: "NL", name: "Netherlands", dateOrder: "DMY", currency: "EUR", timezone: "Europe/Amsterdam", weekStart: 1, schoolYearStart: 8, pack: "nl" },
  { code: "PT", name: "Portugal", dateOrder: "DMY", currency: "EUR", timezone: "Europe/Lisbon", weekStart: 1, schoolYearStart: 9, pack: null },
  { code: "PL", name: "Poland", dateOrder: "DMY", currency: "PLN", timezone: "Europe/Warsaw", weekStart: 1, schoolYearStart: 9, pack: null },
  { code: "SE", name: "Sweden", dateOrder: "YMD", currency: "SEK", timezone: "Europe/Stockholm", weekStart: 1, schoolYearStart: 8, pack: "se" },
  { code: "TR", name: "Türkiye", dateOrder: "DMY", currency: "TRY", timezone: "Europe/Istanbul", weekStart: 1, schoolYearStart: 9, pack: "tr" },
  { code: "MX", name: "Mexico", dateOrder: "DMY", currency: "MXN", timezone: "America/Mexico_City", weekStart: 0, schoolYearStart: 8, pack: "mx" },
  { code: "BR", name: "Brazil", dateOrder: "DMY", currency: "BRL", timezone: "America/Sao_Paulo", weekStart: 0, schoolYearStart: 2, pack: "br" },
  { code: "AR", name: "Argentina", dateOrder: "DMY", currency: "ARS", timezone: "America/Argentina/Buenos_Aires", weekStart: 1, schoolYearStart: 3, pack: null },
  { code: "CL", name: "Chile", dateOrder: "DMY", currency: "CLP", timezone: "America/Santiago", weekStart: 1, schoolYearStart: 3, pack: null },
  { code: "CO", name: "Colombia", dateOrder: "DMY", currency: "COP", timezone: "America/Bogota", weekStart: 0, schoolYearStart: 1, pack: null },
  { code: "ZA", name: "South Africa", dateOrder: "DMY", currency: "ZAR", timezone: "Africa/Johannesburg", weekStart: 1, schoolYearStart: 1, pack: null },
  { code: "NG", name: "Nigeria", dateOrder: "DMY", currency: "NGN", timezone: "Africa/Lagos", weekStart: 1, schoolYearStart: 9, pack: null },
  { code: "KE", name: "Kenya", dateOrder: "DMY", currency: "KES", timezone: "Africa/Nairobi", weekStart: 1, schoolYearStart: 1, pack: null },
  { code: "XX", name: "Other", dateOrder: "DMY", currency: "USD", timezone: "UTC", weekStart: 1, schoolYearStart: 9, pack: null },
];

export const DEFAULT_COUNTRY = "US";

export function countryOf(code: string | null | undefined): Country {
  return COUNTRIES.find((c) => c.code === (code ?? "").toUpperCase()) ?? COUNTRIES.find((c) => c.code === DEFAULT_COUNTRY)!;
}

export function isCountry(code: unknown): code is string {
  return typeof code === "string" && COUNTRIES.some((c) => c.code === code);
}

// A first guess for a new family from the UI language, until they pick a country.
export function guessCountry(locale: string | null | undefined, timezone?: string | null): string {
  if (timezone) {
    const byTz = COUNTRIES.find((c) => c.timezone === timezone);
    if (byTz) return byTz.code;
    if (timezone.startsWith("America/")) return locale === "es" ? "MX" : locale === "fr" ? "CA" : locale === "pt" ? "BR" : "US";
    if (timezone.startsWith("Europe/")) {
      if (locale === "de") return "DE";
      if (locale === "fr") return "FR";
      if (locale === "es") return "ES";
      if (locale === "it") return "IT";
      if (locale === "pt") return "PT";
      return "GB";
    }
    if (timezone.startsWith("Australia/")) return "AU";
    if (timezone.startsWith("Asia/")) {
      if (locale === "ko") return "KR";
      if (locale === "ja") return "JP";
      if (locale === "zh") return "CN";
      if (locale === "vi") return "VN";
    }
  }
  switch (locale) {
    case "ko":
      return "KR";
    case "ja":
      return "JP";
    case "zh":
      return "CN";
    case "de":
      return "DE";
    case "fr":
      return "FR";
    case "es":
      return "ES";
    case "pt":
      return "BR";
    case "it":
      return "IT";
    case "vi":
      return "VN";
    default:
      return DEFAULT_COUNTRY;
  }
}

// A curated list for the time-zone selector; the browser's own zone is added on the client
// when it is missing from this list.
export const TIMEZONES = [
  "Pacific/Honolulu",
  "America/Anchorage",
  "America/Los_Angeles",
  "America/Denver",
  "America/Phoenix",
  "America/Chicago",
  "America/New_York",
  "America/Toronto",
  "America/Vancouver",
  "America/Mexico_City",
  "America/Bogota",
  "America/Lima",
  "America/Santiago",
  "America/Argentina/Buenos_Aires",
  "America/Sao_Paulo",
  "Atlantic/Reykjavik",
  "Europe/London",
  "Europe/Dublin",
  "Europe/Lisbon",
  "Europe/Madrid",
  "Europe/Paris",
  "Europe/Brussels",
  "Europe/Amsterdam",
  "Europe/Berlin",
  "Europe/Zurich",
  "Europe/Vienna",
  "Europe/Rome",
  "Europe/Stockholm",
  "Europe/Warsaw",
  "Europe/Athens",
  "Europe/Istanbul",
  "Europe/Kyiv",
  "Europe/Moscow",
  "Africa/Lagos",
  "Africa/Johannesburg",
  "Africa/Nairobi",
  "Asia/Dubai",
  "Asia/Karachi",
  "Asia/Kolkata",
  "Asia/Dhaka",
  "Asia/Bangkok",
  "Asia/Ho_Chi_Minh",
  "Asia/Jakarta",
  "Asia/Singapore",
  "Asia/Kuala_Lumpur",
  "Asia/Manila",
  "Asia/Hong_Kong",
  "Asia/Taipei",
  "Asia/Shanghai",
  "Asia/Seoul",
  "Asia/Tokyo",
  "Australia/Perth",
  "Australia/Adelaide",
  "Australia/Brisbane",
  "Australia/Sydney",
  "Australia/Melbourne",
  "Pacific/Auckland",
  "UTC",
];

export function isTimezone(tz: unknown): tz is string {
  if (typeof tz !== "string" || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}
