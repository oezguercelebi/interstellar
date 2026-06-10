// L1 pure tests for the deterministic hex→HSL plan-step plumbing (NativeWind
// kit). The paletteTriplets block emitted by formatPlan must be copy-paste
// correct: exact known conversions, lossless-enough round-trips, malformed-hex
// fallbacks, and slot-for-slot agreement with the seeded theme/tokens.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseHexToHsl,
  hexToHslTriplet,
  deriveTriplets,
  formatPaletteTriplets,
  TRIPLET_SLOTS,
  type PlanPalette,
} from "../convex/lib/palette.ts";
import { STARTER_FILES_NATIVEWIND } from "../convex/agents/starterKitNativewind.ts";

const LIGHT: PlanPalette = {
  mode: "light",
  background: "#FFFFFF",
  surface: "#F8F8FA",
  textPrimary: "#0A0A0F",
  accent: "#3D5AFE",
};

const DARK: PlanPalette = {
  mode: "dark",
  background: "#0B1120",
  surface: "#151B2E",
  textPrimary: "#F1F5F9",
  accent: "#38BDF8",
};

test("hexToHslTriplet: exact known conversions", () => {
  assert.equal(hexToHslTriplet("#FFFFFF"), "0 0% 100%");
  assert.equal(hexToHslTriplet("#000000"), "0 0% 0%");
  assert.equal(hexToHslTriplet("#FF0000"), "0 100% 50%");
  assert.equal(hexToHslTriplet("#00FF00"), "120 100% 50%");
  assert.equal(hexToHslTriplet("#0000FF"), "240 100% 50%");
  // The seeded primary: tokens.ts pins "231 99% 62%" for #3D5AFE.
  assert.equal(hexToHslTriplet("#3D5AFE"), "231 99% 62%");
});

test("hexToHslTriplet: shorthand, case, optional #, alpha forms", () => {
  assert.equal(hexToHslTriplet("#f00"), "0 100% 50%");
  assert.equal(hexToHslTriplet("3d5afe"), hexToHslTriplet("#3D5AFE"));
  assert.equal(hexToHslTriplet("#3D5AFEFF"), hexToHslTriplet("#3D5AFE")); // alpha byte dropped
  assert.equal(hexToHslTriplet("#f00f"), hexToHslTriplet("#f00")); // alpha nibble dropped
});

test("hexToHslTriplet: round-trips known colors within rounding tolerance", () => {
  // Triplets round h to 1° and s/l to 1%, so allow a small per-channel delta.
  const hslToRgb = (h: number, s: number, l: number): [number, number, number] => {
    const sn = s / 100;
    const ln = l / 100;
    const k = (n: number) => (n + h / 30) % 12;
    const a = sn * Math.min(ln, 1 - ln);
    const f = (n: number) => ln - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
  };
  for (const hex of ["#3D5AFE", "#1E293B", "#F8FAFC", "#34C759", "#FFB020"]) {
    const m = /^#(..)(..)(..)$/.exec(hex)!;
    const want = [m[1], m[2], m[3]].map((d) => parseInt(d, 16));
    const t = /^(\d+) (\d+)% (\d+)%$/.exec(hexToHslTriplet(hex))!;
    const got = hslToRgb(Number(t[1]), Number(t[2]), Number(t[3]));
    for (let i = 0; i < 3; i++) {
      assert.ok(
        Math.abs(got[i] - want[i]) <= 6,
        `${hex} round-trip channel ${i}: got ${got[i]}, want ~${want[i]}`,
      );
    }
  }
});

test("parseHexToHsl: malformed input returns null; hexToHslTriplet throws", () => {
  for (const bad of ["", "not-a-color", "#12345", "#1234567", "rgb(0,0,0)", "#ggg"]) {
    assert.equal(parseHexToHsl(bad), null, `expected null for ${JSON.stringify(bad)}`);
  }
  assert.throws(() => hexToHslTriplet("tomato"));
});

test("deriveTriplets: direct conversions + structural identities (light)", () => {
  const t = deriveTriplets(LIGHT);
  assert.equal(t.background, hexToHslTriplet(LIGHT.background));
  assert.equal(t.foreground, hexToHslTriplet(LIGHT.textPrimary));
  assert.equal(t.card, hexToHslTriplet(LIGHT.surface));
  assert.equal(t.primary, hexToHslTriplet(LIGHT.accent));
  assert.equal(t["card-foreground"], t.foreground);
  assert.equal(t["secondary-foreground"], t.foreground);
  assert.equal(t.muted, t.secondary);
  assert.equal(t.input, t.border);
  assert.equal(t.ring, t.primary);
  // #3D5AFE has L=62 → white foreground on primary.
  assert.equal(t["primary-foreground"], "0 0% 100%");
  // Fixed semantic slots.
  assert.equal(t.destructive, "0 84% 60%");
  assert.equal(t["destructive-foreground"], "0 0% 100%");
  assert.equal(t.success, "142 71% 45%");
  assert.equal(t.warning, "38 92% 50%");
  // Light-mode lightness levels for the derived neutrals.
  assert.match(t.secondary, /% 96%$/);
  assert.match(t.border, /% 90%$/);
  assert.match(t.accent, /% 95%$/);
});

test("deriveTriplets: dark mode flips the derived lightness levels", () => {
  const t = deriveTriplets(DARK);
  assert.match(t.secondary, /% 16%$/);
  assert.match(t.border, /% 24%$/);
  assert.match(t.accent, /% 22%$/);
  assert.match(t["muted-foreground"], /% 64%$/);
  assert.match(t["accent-foreground"], /% 90%$/);
  // #38BDF8 has L≈60 ≤ 62 → still white on primary.
  assert.equal(t["primary-foreground"], "0 0% 100%");
});

test("deriveTriplets: malformed hex falls back per-slot to the seeded defaults", () => {
  const t = deriveTriplets({ ...LIGHT, accent: "bright blue" });
  assert.equal(t.primary, "231 99% 62%"); // seeded tokens.ts default
  // Other slots keep using their own (valid) inputs.
  assert.equal(t.background, hexToHslTriplet(LIGHT.background));
});

test("deriveTriplets: deterministic", () => {
  assert.deepEqual(deriveTriplets(LIGHT), deriveTriplets(LIGHT));
  assert.deepEqual(deriveTriplets(DARK), deriveTriplets(DARK));
});

test("formatPaletteTriplets: emits every slot, in order, as quoted triplets", () => {
  const block = formatPaletteTriplets(LIGHT);
  assert.ok(block.startsWith("paletteTriplets:"), "block must start with paletteTriplets:");
  const lines = block.split("\n").slice(1);
  assert.equal(lines.length, TRIPLET_SLOTS.length);
  TRIPLET_SLOTS.forEach((slot, i) => {
    assert.match(
      lines[i],
      new RegExp(`^  ${slot}: "\\d+ \\d+% \\d+%"$`),
      `line ${i} must be the ${slot} triplet`,
    );
  });
});

test("TRIPLET_SLOTS matches the seeded theme/tokens.ts `c` map slot-for-slot", () => {
  const tokens = STARTER_FILES_NATIVEWIND.find((f) => f.path === "theme/tokens.ts");
  assert.ok(tokens, "nativewind kit must seed theme/tokens.ts");
  const body = tokens!.contents;
  const cMap = /const c = \{([\s\S]*?)\} as const;/.exec(body);
  assert.ok(cMap, "tokens.ts must keep the `const c = { … } as const` shape");
  const seededSlots = [...cMap![1].matchAll(/(?:^|[{,\s])"?([\w-]+)"?:\s*"/g)].map((m) => m[1]);
  assert.deepEqual(
    [...seededSlots].sort(),
    [...TRIPLET_SLOTS].sort(),
    "plan-step triplet slots and seeded tokens.ts slots must agree exactly",
  );
});
