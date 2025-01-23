import logger from "@calcom/lib/logger";
import type { SelectedCalendar } from "@calcom/prisma/client";
import type { CredentialPayload } from "@calcom/types/Credential";

import { getOrderedListOfLuckyUsers } from "../server/getLuckyUser";

export const errorCodes = {
  MAX_LEAD_THRESHOLD_FALSY: "Max lead threshold should be null or > 1, not 0.",
} as const;

type BaseUser = {
  id: number;
  email: string;
  credentials: CredentialPayload[];
  userLevelSelectedCalendars: SelectedCalendar[];
} & Record<string, unknown>;

type BaseHost<User extends BaseUser> = {
  isFixed: boolean;
  createdAt: Date;
  priority?: number | null;
  weight?: number | null;
  weightAdjustment?: number | null;
  user: User;
};

type PerUserData = Awaited<ReturnType<typeof getOrderedListOfLuckyUsers>>["perUserData"];
type WeightedPerUserData = Omit<PerUserData, "weights" | "calibrations" | "bookingShortfalls"> & {
  weights: NonNullable<PerUserData["weights"]>;
  calibrations: NonNullable<PerUserData["calibrations"]>;
  bookingShortfalls: NonNullable<PerUserData["bookingShortfalls"]>;
};

const log = logger.getSubLogger({ name: "filterHostsByLeadThreshold" });

function filterHostsByLeadThresholdWithWeights(perUserData: WeightedPerUserData, maxLeadThreshold: number) {
  const filteredUserIds: number[] = [];
  // Calculate the total weight of all hosts
  const totalWeight = Object.values(perUserData.weights).reduce((sum, weight) => sum + weight, 0);

  for (const userIdStr in perUserData.bookingsCount) {
    const shortfall = perUserData.bookingShortfalls[userIdStr];
    const weight = perUserData.weights[userIdStr];
    const weightPercentage = weight / totalWeight;
    const allowedLead = maxLeadThreshold * weightPercentage;

    // negative shortfall means the host should receive negative bookings
    // this means they are overbooked and should be filtered out if
    // if they exceed the allowed lead
    if (-shortfall > allowedLead) {
      log.debug(
        `Host ${userIdStr} has been filtered out because the amount of bookings made him exceed the thresholds. Shortfall: ${shortfall}, AllowedLead: ${allowedLead}, Weight: ${weight}`
      );
    } else {
      filteredUserIds.push(parseInt(userIdStr, 10));
    }
  }

  return filteredUserIds;
}

function filterHostsByLeadThresholdWithoutWeights(perUserData: PerUserData, maxLeadThreshold: number) {
  const filteredUserIds: number[] = [];

  const bookingsArray = Object.values(perUserData.bookingsCount);
  const minBookings = Math.min(...bookingsArray);
  const maxBookings = Math.max(...bookingsArray);

  for (const userIdStr in perUserData.bookingsCount) {
    const bookingsCount = perUserData.bookingsCount[userIdStr];
    if (bookingsCount <= minBookings + maxLeadThreshold) {
      filteredUserIds.push(parseInt(userIdStr, 10));
      log.debug(
        `Host Allowed ${userIdStr} has been filtered out because the given data made them exceed the thresholds. BookingsCount: ${bookingsCount}, MinBookings: ${minBookings}, MaxBookings: ${maxBookings}, MaxLeadThreshold: ${maxLeadThreshold}`
      );
    } else {
      log.debug(
        `Host ${userIdStr} has been filtered out because the given data made them exceed the thresholds. BookingsCount: ${bookingsCount}, MinBookings: ${minBookings}, MaxBookings: ${maxBookings}, MaxLeadThreshold: ${maxLeadThreshold}`
      );
    }
  }

  return filteredUserIds;
}

/*
 * Filter the hosts by lead threshold, disqualifying hosts that have exceeded the maximum
 *
 * NOTE: This function cleans up the leadOffset value so can't be used afterwards.
 *
 * @throws errorCodes.MAX_LEAD_THRESHOLD_FALSY
 */
export const filterHostsByLeadThreshold = async <T extends BaseHost<BaseUser>>({
  hosts,
  maxLeadThreshold,
  eventType,
}: {
  hosts: T[];
  maxLeadThreshold: number | null;
  eventType: {
    id: number;
    isRRWeightsEnabled: boolean;
    team: {
      parentId?: number | null;
    } | null;
  };
}) => {
  if (maxLeadThreshold === null) {
    return hosts; // don't apply filter.
  }
  const orderedLuckyUsers = await getOrderedListOfLuckyUsers({
    availableUsers: [
      {
        ...hosts[0].user,
        weight: hosts[0].weight ?? null,
        priority: hosts[0].priority ?? null,
      },
      ...hosts.slice(1).map((host) => ({
        ...host.user,
        weight: host.weight ?? null,
        priority: host.priority ?? null,
      })),
    ],
    eventType,
    allRRHosts: hosts,
    routingFormResponse: null,
  });

  const perUserData = orderedLuckyUsers["perUserData"];

  let filteredUserIds: number[];
  if (eventType.isRRWeightsEnabled) {
    // Check if any of the required data is null
    if (
      perUserData.calibrations === null ||
      perUserData.weights === null ||
      perUserData.bookingShortfalls === null
    ) {
      throw new Error("Calibrations, weights, or booking shortfalls are null");
    }
    filteredUserIds = filterHostsByLeadThresholdWithWeights(
      {
        bookingsCount: perUserData.bookingsCount,
        bookingShortfalls: perUserData.bookingShortfalls,
        calibrations: perUserData.calibrations,
        weights: perUserData.weights,
      },
      maxLeadThreshold
    );
  } else {
    filteredUserIds = filterHostsByLeadThresholdWithoutWeights(perUserData, maxLeadThreshold);
  }

  const filteredHosts = hosts.filter((host) => filteredUserIds.includes(host.user.id));
  return filteredHosts;
};
