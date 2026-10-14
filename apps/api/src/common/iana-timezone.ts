import { registerDecorator, type ValidationOptions } from "class-validator";

/**
 * The regions the IANA time zone database files its zones under. "Asia/Kolkata" is
 * accepted; "IST", "+05:30" and "US/Eastern" are not, although the runtime would take
 * all three. An abbreviation is ambiguous (IST is also Israel's and Ireland's), a fixed
 * offset ignores daylight saving, and the old US/... names are compatibility links.
 */
const IANA_AREAS = [
  "Africa",
  "America",
  "Antarctica",
  "Arctic",
  "Asia",
  "Atlantic",
  "Australia",
  "Europe",
  "Indian",
  "Pacific",
  "Etc",
];

/** Area, then one or two capitalised parts: "Asia/Kolkata", "America/Argentina/Salta". */
const IANA_NAME = new RegExp(`^(?:${IANA_AREAS.join("|")})(?:/[A-Z][A-Za-z0-9_+-]*){1,2}$`);

let supported: Set<string> | undefined;

/** The runtime's zone list, read once. */
function supportedZones(): Set<string> {
  supported ??= new Set(Intl.supportedValuesOf("timeZone"));
  return supported;
}

/**
 * Whether `value` names a real IANA time zone, such as "Asia/Kolkata" or "UTC".
 *
 * Checking membership of Intl.supportedValuesOf('timeZone') alone does not work. ICU
 * lists each zone under its oldest name, so Node's list holds "Asia/Calcutta" and not
 * "Asia/Kolkata", which is the name everyone uses and the default throughout this app.
 * So a value is accepted when it has the shape of an IANA name and the runtime resolves
 * it to a zone on that list. That accepts current names and their older aliases, and
 * refuses invented ones ("Mars/Base") and lower-case variants that only work because
 * ICU happens to be lenient about case.
 *
 * The browser builds its timezone picker from the same ICU data, so whatever the picker
 * offers passes here.
 */
export function isIanaTimezone(value: unknown): value is string {
  if (typeof value !== "string") return false;
  if (value === "UTC") return true;
  if (!IANA_NAME.test(value)) return false;

  try {
    const resolved = new Intl.DateTimeFormat("en-US", { timeZone: value }).resolvedOptions()
      .timeZone;
    return resolved === "UTC" || supportedZones().has(resolved);
  } catch {
    // RangeError: the runtime does not know the zone.
    return false;
  }
}

/** class-validator decorator for isIanaTimezone. */
export function IsIanaTimezone(validationOptions?: ValidationOptions): PropertyDecorator {
  return (object, propertyName) =>
    registerDecorator({
      name: "isIanaTimezone",
      target: object.constructor,
      propertyName: propertyName as string,
      options: {
        message: ({ property }) =>
          `${property} must be an IANA timezone, such as Asia/Kolkata or Europe/London.`,
        ...validationOptions,
      },
      validator: { validate: (value: unknown) => isIanaTimezone(value) },
    });
}
