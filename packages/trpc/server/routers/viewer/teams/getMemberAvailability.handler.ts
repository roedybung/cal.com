import { getUserAvailability } from "@calcom/core/getUserAvailability";
import { enrichUserWithDwdCredentialsWithoutOrgId } from "@calcom/lib/domainWideDelegation/server";
import { isTeamMember } from "@calcom/lib/server/queries/teams";
import { MembershipRepository } from "@calcom/lib/server/repository/membership";
import type { TrpcSessionUser } from "@calcom/trpc/server/trpc";

import { TRPCError } from "@trpc/server";

import type { TGetMemberAvailabilityInputSchema } from "./getMemberAvailability.schema";

type GetMemberAvailabilityOptions = {
  ctx: {
    user: NonNullable<TrpcSessionUser>;
  };
  input: TGetMemberAvailabilityInputSchema;
};

export const getMemberAvailabilityHandler = async ({ ctx, input }: GetMemberAvailabilityOptions) => {
  const team = await isTeamMember(ctx.user?.id, input.teamId);
  if (!team) throw new TRPCError({ code: "UNAUTHORIZED" });

  // verify member is in team
  const members = await MembershipRepository.findByTeamIdForAvailability({ teamId: input.teamId });

  const member = members?.find((m) => m.userId === input.memberId);
  if (!member) throw new TRPCError({ code: "NOT_FOUND", message: "Member not found" });
  if (!member.user.username)
    throw new TRPCError({ code: "BAD_REQUEST", message: "Member doesn't have a username" });
  const username = member.user.username;
  const user = await enrichUserWithDwdCredentialsWithoutOrgId({
    user: member.user,
  });

  // get availability for this member
  return await getUserAvailability(
    {
      username: username,
      dateFrom: input.dateFrom,
      dateTo: input.dateTo,
      returnDateOverrides: true,
      bypassBusyCalendarTimes: false,
    },
    { user, busyTimesFromLimitsBookings: [] }
  );
};

export default getMemberAvailabilityHandler;
