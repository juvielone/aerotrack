import { airlinePrefix } from './airlines';

/** Map silhouette families. Drawn by the web app; one icon per family. */
export type IconClass = 'narrow' | 'wide' | 'heavy4' | 'turboprop' | 'bizjet' | 'light' | 'helicopter' | 'glider' | 'fighter';

export interface IconInput {
  /** ICAO type designator, e.g. "A21N", "B77W", "DH8D". */
  type: string | null;
  /** ADS-B emitter category, e.g. "A3", "A7". */
  category: string | null;
  dbFlags: number;
  callsign: string | null;
}

/** Relative icon size per family, so a 777 reads bigger than a Cessna. */
export const ICON_SCALE: Record<IconClass, number> = {
  heavy4: 1.25,
  wide: 1.15,
  narrow: 1,
  turboprop: 0.9,
  fighter: 0.85,
  bizjet: 0.8,
  helicopter: 0.75,
  light: 0.7,
  glider: 0.7,
};

// Type designators, checked in this order (first match wins). Common types in Australian airspace; prefixes cover families.
const TYPE_RULES: [IconClass, RegExp][] = [
  ['heavy4', /^(A38\d|A34\d|B74\d|B74[A-Z]|C17|C5M?|A124|IL76|B52)$/],
  ['wide', /^(A30[06B]|A310|A33\d|A35[0-9K]|B76\d|B77\d|B77[LW]|B78[789X]|MD11|DC10|L101)$/],
  ['narrow', /^(A1[89]N|A2[01]N|A31[89]|A32\d|BCS[13]|B71\d|B73\d|B3[789X]M|B75\d|E1[79]\d|E7[05]\w?|E29[05]|CRJ\w|F70|F100|MD8\d|MD90|B46\d|RJ\d\d)$/],
  ['turboprop', /^(DH8\w|AT4\d|AT7\d|ATP|SF34|SB20|B190|BE20|B350|BE9L|C130|C208|DHC6|JS3[12]|JS41|D328|F50|E120|PC12|SW4|L410|M28|C295|C27J)$/],
  ['bizjet', /^(C25\w|C5[0-6]\w|C68\w|C700|C750|LJ\d\d|GLF\w|GL[57]T|GLEX|G280|CL3[05]|CL6\d|F2TH|F900|FA[78]X|E5[05]P|H25B|PRM1|HDJT)$/],
  ['helicopter', /^(R22|R44|R66|EC\d\d|AS\d\d|A1[0-6]9|A139|AW\d+|B06|B407|B412|B429|S76|S92|H60|H47|H1\d\d|BK17|NH90|UH1)$/],
  ['glider', /^GLID$/],
  ['fighter', /^(F1[4-8]|F22|F35|EUFI|HAWK|SU\d\d|MG\d\d)$/],
  ['light', /^(C1[5-9]\d|C2[01]\d|PA\w+|P28\w|SR2\d|BE3\d|BE5\d|BE76|DA[24]\w|M20\w|AC\d\d|P68|GA8|TB\d+|RV\d+|J3)$/],
];

/** Fallback by ADS-B emitter category when the type is unknown. */
const CATEGORY: Record<string, IconClass> = {
  A1: 'light',
  A2: 'bizjet',
  A3: 'narrow',
  A4: 'narrow',
  A5: 'wide',
  A6: 'fighter',
  A7: 'helicopter',
  B1: 'glider',
};

/** Which silhouette to draw: by type designator, then ADS-B category, then callsign. */
export function iconClass(a: IconInput): IconClass {
  const type = a.type?.trim().toUpperCase();
  if (type) for (const [cls, re] of TYPE_RULES) if (re.test(type)) return cls;
  const byCategory = a.category ? CATEGORY[a.category] : undefined;
  if (byCategory) return byCategory;
  return airlinePrefix(a.callsign) ? 'narrow' : 'light';
}
