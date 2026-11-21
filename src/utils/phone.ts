/**
 * Converts Eastern Arabic-Indic numerals (٠-٩) and Persian numerals (۰-۹) to standard Western Arabic numerals (0-9).
 */
export function normalizeDigits(input: string): string {
  if (!input) return "";
  const arabicIndic = ["٠", "١", "٢", "٣", "٤", "٥", "٦", "٧", "٨", "٩"];
  const easternArabic = ["۰", "۱", "۲", "۳", "۴", "۵", "۶", "۷", "۸", "۹"];

  let res = input;
  for (let i = 0; i < 10; i++) {
    res = res.replaceAll(arabicIndic[i], i.toString());
    res = res.replaceAll(easternArabic[i], i.toString());
  }
  return res;
}

/**
 * Normalizes Iraqi phone numbers into local 11-digit format starting with 07: "07XXXXXXXXX".
 * Handles formats like:
 * - 07XXXXXXXXX (11 digits)
 * - 7XXXXXXXXX (10 digits -> adds 0)
 * - +9647XXXXXXXXX or 009647XXXXXXXXX or 9647XXXXXXXXX -> 07XXXXXXXXX
 */
export function normalizeIraqiPhone(rawPhone: string): {
  isValid: boolean;
  normalized: string;
  international: string;
} {
  if (!rawPhone) {
    return { isValid: false, normalized: "", international: "" };
  }

  // Convert Arabic-Indic digits to Latin
  let cleaned = normalizeDigits(rawPhone);

  // Remove everything except numbers and plus
  cleaned = cleaned.replace(/[^0-9+]/g, "");

  // Remove leading plus
  if (cleaned.startsWith("+")) {
    cleaned = cleaned.substring(1);
  }

  // Handle 00964 prefix
  if (cleaned.startsWith("00964")) {
    cleaned = cleaned.substring(5);
  } else if (cleaned.startsWith("964")) {
    cleaned = cleaned.substring(3);
  }

  // If now starting with 7 and 10 digits long, prefix with 0
  if (cleaned.startsWith("7") && cleaned.length === 10) {
    cleaned = "0" + cleaned;
  }

  // Iraqi mobile numbers are 11 digits starting with 07 (e.g. 077, 078, 075, 079)
  const isIraqiFormat = /^07[3-9]\d{8}$/.test(cleaned);

  if (!isIraqiFormat) {
    return {
      isValid: false,
      normalized: cleaned,
      international: ""
    };
  }

  // International format for Meta CAPI: 9647XXXXXXXXX (no +)
  const international = "964" + cleaned.substring(1);

  return {
    isValid: true,
    normalized: cleaned,
    international
  };
}
