import { ONIX } from "./onix";
import { CompanyProfile } from "./types"

let profilesMap: Map<string, CompanyProfile> | null = null;

export function init() {
  profilesMap = new Map();

  profilesMap.set(ONIX.key, ONIX);
}

export function getProfile(key: string) {
  if (!profilesMap) {
    throw new Error('Company profiles map is not initialized')
  }

  return profilesMap.get(key);
};
