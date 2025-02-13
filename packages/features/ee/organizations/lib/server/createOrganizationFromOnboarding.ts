import { z } from "zod";

import { sendOrganizationCreationEmail } from "@calcom/emails/email-manager";
import { getOrgFullOrigin } from "@calcom/features/ee/organizations/lib/orgDomains";
import {
  assertCanCreateOrg,
  findUserToBeOrgOwner,
  setupDomain,
} from "@calcom/features/ee/organizations/lib/server/orgCreationUtils";
import { DEFAULT_SCHEDULE } from "@calcom/lib/availability";
import { getAvailabilityFromSchedule } from "@calcom/lib/availability";
import logger from "@calcom/lib/logger";
import { safeStringify } from "@calcom/lib/safeStringify";
import { getTranslation } from "@calcom/lib/server/i18n";
import { OrganizationRepository } from "@calcom/lib/server/repository/organization";
import { OrganizationOnboardingRepository } from "@calcom/lib/server/repository/organizationOnboarding";
import { prisma } from "@calcom/prisma";
import type { Team, User } from "@calcom/prisma/client";
import type { OrganizationOnboarding } from "@calcom/prisma/client";
import { MembershipRole, CreationSource } from "@calcom/prisma/enums";
import { createTeamsHandler } from "@calcom/trpc/server/routers/viewer/organizations/createTeams.handler";
import { inviteMembersWithNoInviterPermissionCheck } from "@calcom/trpc/server/routers/viewer/teams/inviteMember/inviteMember.handler";

const log = logger.getSubLogger({ prefix: ["createOrganizationFromOnboarding"] });
// Types for organization data
type OrganizationData = {
  id: number | null;
  name: string;
  slug: string;
  isOrganizationConfigured: boolean;
  isOrganizationAdminReviewed: boolean;
  autoAcceptEmail: string;
  seats: number | null;
  pricePerSeat: number | null;
  isPlatform: boolean;
  logoUrl: string | null;
  bio: string | null;
  billingPeriod?: "MONTHLY" | "ANNUALLY";
  paymentSubscriptionId: string;
};

type TeamData = {
  id: number;
  name: string;
  isBeingMigrated: boolean;
  slug: string;
};

type InvitedMember = {
  email: string;
  name?: string;
};

async function createOrganizationWithOwner({
  owner,
  organizationOnboardingId,
  orgData,
}: {
  organizationOnboardingId: number;
  owner: NonNullable<Awaited<ReturnType<typeof findUserToBeOrgOwner>>>;
  orgData: OrganizationData;
}) {
  const orgOwnerTranslation = await getTranslation(owner.locale || "en", "common");
  let organization = orgData.id
    ? await OrganizationRepository.findById({ id: orgData.id })
    : await OrganizationRepository.findBySlug({ slug: orgData.slug });

  if (organization) {
    log.debug(
      `Reusing existing organization:`,
      safeStringify({
        slug: orgData.slug,
        id: organization.id,
      })
    );
    return { organization };
  }

  const { slugConflictType } = await assertCanCreateOrg({
    slug: orgData.slug,
    isPlatform: orgData.isPlatform,
    orgOwner: owner,
    errorOnUserAlreadyPartOfOrg: false,
    // If it would have been restricted, then it would have been done already in intentToCreateOrgHandler
    // This restriction doesn't apply for admin as we would have validated it already in intentToCreateOrgHandler, we just relax it here as we don't know who created the organization.
    // TODO: If needed, we could start tracking if the onboarding is being done by instance Admin and relax it then only.
    restrictBasedOnMinimumPublishedTeams: false,
  });

  // In this case we create the organization with slug=null. Let the teams migrate and then the conflict would go away.
  const canSetSlug = slugConflictType === "teamUserIsMemberOfExists" ? false : true;

  log.debug(
    `Creating organization for owner ${owner.email} with slug/requestedSlug ${
      canSetSlug ? orgData.slug : "null"
    } and canSetSlug=${canSetSlug}`
  );

  try {
    const nonOrgUsername = owner.username || "";
    const orgCreationResult = await OrganizationRepository.createWithExistingUserAsOwner({
      orgData: {
        ...orgData,
        ...(canSetSlug ? { slug: orgData.slug } : { slug: null }),
      },
      owner: {
        id: owner.id,
        email: owner.email,
        nonOrgUsername,
      },
    });
    organization = orgCreationResult.organization;
    const ownerProfile = orgCreationResult.ownerProfile;

    // Send organization creation email
    if (!orgData.isPlatform) {
      await sendOrganizationCreationEmail({
        language: orgOwnerTranslation,
        from: `${organization.name}'s admin`,
        to: owner.email,
        ownerNewUsername: ownerProfile.username,
        ownerOldUsername: nonOrgUsername,
        orgDomain: getOrgFullOrigin(orgData.slug, { protocol: false }),
        orgName: organization.name,
        prevLink: `${getOrgFullOrigin("", { protocol: true })}/${owner.username || ""}`,
        newLink: `${getOrgFullOrigin(orgData.slug, { protocol: true })}/${ownerProfile.username}`,
      });
    }

    // Set up default availability
    const availability = getAvailabilityFromSchedule(DEFAULT_SCHEDULE);
    await prisma.availability.createMany({
      data: availability.map((schedule) => ({
        days: schedule.days,
        startTime: schedule.startTime,
        endTime: schedule.endTime,
        userId: owner.id,
      })),
    });
  } catch (error) {
    // Catch and log so that redactError doesn't redact the log message
    log.error(
      `RecoverableError: Error creating organization for owner ${owner.email}.`,
      safeStringify(error)
    );
    throw error;
  }

  // Connect the organization onboarding to the organization so that for further attempts after a failed update, we can use the organizationId itself from the onboarding.
  await OrganizationOnboardingRepository.setOrganizationId({
    id: organizationOnboardingId,
    organizationId: organization.id,
  });

  return { organization };
}

async function createOrMoveTeamsToOrganization(teams: TeamData[], owner: User, organizationId: number) {
  if (teams.length === 0) return;

  const teamsToCreate = teams.filter((team) => !team.isBeingMigrated).map((team) => team.name);
  const teamsToMove = teams
    .filter((team) => team.isBeingMigrated)
    .map((team) => ({
      id: team.id,
      newSlug: team.slug,
      shouldMove: true,
    }));

  log.debug(
    `Creating ${teamsToCreate} teams and moving ${teamsToMove.map(
      (team) => team.newSlug
    )} teams for organization ${organizationId}`
  );

  await createTeamsHandler({
    ctx: {
      user: {
        ...owner,
        organizationId,
      },
    },
    input: {
      teamNames: teamsToCreate,
      orgId: organizationId,
      moveTeams: teamsToMove,
      creationSource: CreationSource.WEBAPP,
    },
  });

  log.debug(
    `Created ${teamsToCreate.length} teams and moved ${teamsToMove.length} teams for organization ${organizationId}`
  );
}

async function inviteMembers(invitedMembers: InvitedMember[], organization: Team) {
  if (invitedMembers.length === 0) return;

  log.debug(`Inviting ${invitedMembers.length} members to organization ${organization.id}`);
  await inviteMembersWithNoInviterPermissionCheck({
    inviterName: null,
    teamId: organization.id,
    language: "en",
    creationSource: CreationSource.WEBAPP,
    orgSlug: organization.slug || null,
    invitations: invitedMembers.map((member) => ({
      usernameOrEmail: member.email,
      role: MembershipRole.MEMBER,
    })),
  });
}

/**
 * This function is used by stripe webhook, so it should expect to be called multiple times till the entire flow completes without any error.
 * So, it should be idempotent.
 */
export const createOrganizationFromOnboarding = async ({
  organizationOnboarding,
  paymentSubscriptionId,
}: {
  organizationOnboarding: Pick<
    OrganizationOnboarding,
    | "id"
    | "organizationId"
    | "name"
    | "slug"
    | "orgOwnerEmail"
    | "seats"
    | "pricePerSeat"
    | "billingPeriod"
    | "invitedMembers"
    | "teams"
    | "isPlatform"
    | "logo"
    | "bio"
  >;
  paymentSubscriptionId: string;
}) => {
  const owner = await findUserToBeOrgOwner(organizationOnboarding.orgOwnerEmail);
  if (!owner) {
    throw new Error(`Owner not found with email: ${organizationOnboarding.orgOwnerEmail}`);
  }
  const orgOwnerTranslation = await getTranslation(owner.locale || "en", "common");

  // Important: Setup Domain first before creating the organization as Vercel/Cloudflare might not allow the domain to be created and that could cause organization booking pages to not actually work
  await setupDomain({
    slug: organizationOnboarding.slug,
    isPlatform: organizationOnboarding.isPlatform,
    orgOwnerEmail: organizationOnboarding.orgOwnerEmail,
    orgOwnerTranslation,
  });

  const { organization } = await createOrganizationWithOwner({
    orgData: {
      id: organizationOnboarding.organizationId,
      name: organizationOnboarding.name,
      slug: organizationOnboarding.slug,
      isOrganizationConfigured: true,
      isOrganizationAdminReviewed: true,
      autoAcceptEmail: organizationOnboarding.orgOwnerEmail.split("@")[1],
      seats: organizationOnboarding.seats,
      pricePerSeat: organizationOnboarding.pricePerSeat,
      isPlatform: false,
      billingPeriod: organizationOnboarding.billingPeriod,
      logoUrl: organizationOnboarding.logo,
      bio: organizationOnboarding.bio,
      paymentSubscriptionId,
    },
    organizationOnboardingId: organizationOnboarding.id,
    owner,
  });

  const invitedMembers = z
    .array(z.object({ email: z.string().email(), name: z.string().optional() }))
    .parse(organizationOnboarding.invitedMembers);

  const teams = z
    .array(
      z.object({
        id: z.number(),
        name: z.string(),
        isBeingMigrated: z.boolean(),
        slug: z.string(),
      })
    )
    .parse(organizationOnboarding.teams);

  await inviteMembers(invitedMembers, organization);

  await createOrMoveTeamsToOrganization(teams, owner, organization.id);
  // We have moved the teams through `createOrMoveTeamsToOrganization`, so we if need to set the slug, this is the best time to do it.
  if (!organization.slug) {
    await OrganizationRepository.setSlug({
      id: organization.id,
      slug: organizationOnboarding.slug,
    });
  }

  return { organization, owner };
};
