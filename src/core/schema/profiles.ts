import type { AdaptationProfile, AdaptationConstraints } from "./script-schema";

/**
 * Default adaptation_constraints per profile (spec §8). short_drama is the v1 default
 * and showcase preset; the others are sane starting points the author can override.
 */
const PROFILE_DEFAULTS: Record<AdaptationProfile, AdaptationConstraints> = {
  short_drama: {
    structure_unit: "episode",
    episode_count: 3,
    target_duration_seconds_per_episode: 120,
    opening_hook_required: true,
    cliffhanger_required: true,
    fidelity_level: "balanced",
  },
  film: {
    structure_unit: "act",
    episode_count: 3,
    target_duration_seconds_per_episode: 1800,
    opening_hook_required: false,
    cliffhanger_required: false,
    fidelity_level: "balanced",
  },
  series: {
    structure_unit: "episode",
    episode_count: 6,
    target_duration_seconds_per_episode: 1500,
    opening_hook_required: true,
    cliffhanger_required: false,
    fidelity_level: "balanced",
  },
  custom: {
    structure_unit: "episode",
    episode_count: 3,
    target_duration_seconds_per_episode: 120,
    opening_hook_required: false,
    cliffhanger_required: false,
    fidelity_level: "balanced",
  },
};

/** Return a fresh copy of the default constraints for a profile. */
export function getProfileConstraints(profile: AdaptationProfile): AdaptationConstraints {
  return { ...PROFILE_DEFAULTS[profile] };
}
