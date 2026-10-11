/**
 * An area's name for city admins: "Dhaka North City Corporation" → "Dhaka North". City admins are labelled by
 * the area they look after, not as City Corporation staff. Same as area_label() in the database (0045).
 */
export const areaLabel = (name: string) => name.replace(/\s*city\s+corporation\s*$/i, '').trim() || name
