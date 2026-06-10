/**
 * SourceClient registry (spec §5, §7). One place the ingest scheduler (Phase 4)
 * and any CLI gets the configured clients from. Keys come from env; clients are
 * cheap to construct without keys — only LIVE `fetchSince` needs them, so
 * `enabledSourceClients()` filters to the ones that can actually poll.
 */
import type { SourceClient } from "@/lib/interfaces";
import type { Source } from "@/lib/types";
import { env } from "@/lib/env";
import { CongressClient } from "@/sources/congress";
import { FederalRegisterClient } from "@/sources/federalRegister";
import { OpenStatesClient } from "@/sources/openStates";

export { CongressClient } from "@/sources/congress";
export { FederalRegisterClient } from "@/sources/federalRegister";
export { OpenStatesClient } from "@/sources/openStates";

/** All configured clients, regardless of whether their key is present. */
export function allSourceClients(): SourceClient[] {
  const e = env();
  return [
    new FederalRegisterClient(), // no key required
    new CongressClient({ apiKey: e.CONGRESS_API_KEY }),
    new OpenStatesClient({ apiKey: e.OPENSTATES_API_KEY }), // CA first
  ];
}

/** Which sources can poll live right now (have any required key). Federal
 *  Register needs none; Congress + Open States need their api.data.gov key. */
export function sourceIsLiveReady(key: Source): boolean {
  const e = env();
  switch (key) {
    case "federal_register":
      return true;
    case "congress":
      return Boolean(e.CONGRESS_API_KEY);
    case "openstates":
      return Boolean(e.OPENSTATES_API_KEY);
    case "regulations_gov":
      return false; // not implemented in Phase 1
    default:
      return false;
  }
}

/** Clients that can actually poll given the current env (used by the scheduler). */
export function enabledSourceClients(): SourceClient[] {
  return allSourceClients().filter((c) => sourceIsLiveReady(c.key));
}
