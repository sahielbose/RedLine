/**
 * / — the marketing site (parchment + etching hero, compare, how-it-works,
 * open-source, CTA). Server component: the hero mini-app's map is the REAL
 * board for the importer profile, computed through the actual engine.
 */
import { computeBoardForProfile } from "@/app/lib/board";
import { DEMO_PROFILES } from "@/app/lib/demo-data";
import { homeStates } from "@/app/lib/ui";
import { SiteView } from "@/app/components/SiteView";

export default async function Page() {
  // The importer lights the map nicely (de minimis is Critical for it).
  const heroProfile = DEMO_PROFILES.find((p) => p.id === "ecom-goods") ?? DEMO_PROFILES[0];
  const heroBoard = await computeBoardForProfile(heroProfile);
  return <SiteView heroBoard={heroBoard} heroHome={homeStates(heroProfile.jurisdictions)} />;
}
